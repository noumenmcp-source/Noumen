"""Worker run-loop: pull audience -> drop suppressed -> micro-segment -> ONE LLM generation
per cluster (the cost lever) -> quality gate -> write content traits to every cluster member.

Dependencies are injectable (df/flot/validator/suppression) so the loop is unit-testable
without a live Dittofeed or LLM fleet."""
import os

from .clustering import cluster_users
from .generator import EmailGenerator
from .suppression import SuppressionList
from .validator import Validator

DEFAULT_FIELDS = ["interest", "region", "industry", "company"]


def run(campaign_id, segment_id, variants, *, brief=None, fields=None,
        df=None, flot=None, validator=None, suppression=None, max_microsegments=None,
        showcase_fn=None):
    # Lazy imports so the module loads without httpx/sklearn when only injecting fakes.
    if df is None:
        from .dittofeed_client import DittofeedClient
        df = DittofeedClient()
    if flot is None:
        from .flot_client import FlotClient
        flot = FlotClient()
    validator = validator or Validator()
    if showcase_fn is None:
        from .catalog import build_showcase
        showcase_fn = build_showcase
    fields = fields or DEFAULT_FIELDS
    brief = brief or f"Кампания {campaign_id}"
    max_ms = int(max_microsegments or os.getenv("MAX_MICROSEGMENTS", "20"))

    users = df.get_audience(segment_id)
    # Subscription-based unsubscribes are honored natively by Dittofeed broadcasts; this list
    # is for bounce/complaint addresses fed in by the caller.
    suppression = suppression or SuppressionList()
    users = suppression.filter(users)
    if not users:
        return {"clusters": 0, "generated": 0, "applied": 0, "users": []}

    clusters = cluster_users(users, max_ms, fields)
    generator = EmailGenerator(flot, validator)
    applied, generated = [], 0

    for cluster in clusters:
        valid = generator.generate_and_validate(brief, cluster["representative_traits"], variants)
        if not valid:
            continue
        generated += 1
        chosen = valid[0]  # first valid variant; A/B selection can come later
        # Per-profile catalog showcase appended to the body (real products under the profile).
        try:
            showcase = showcase_fn(cluster["representative_traits"]) or ""
        except Exception:
            showcase = ""
        body_html = chosen["body"] + showcase
        for member in cluster["members"]:
            traits = member.get("traits", member)
            uid = member.get("userId") or member.get("id") or traits.get("userId")
            if not uid:
                continue
            df.write_traits(uid, {
                "gen_subject": chosen["subject"],
                "gen_body_html": body_html,
                "gen_campaign_id": campaign_id,
            })
            applied.append(uid)

    return {"clusters": len(clusters), "generated": generated, "applied": len(applied), "users": applied}
