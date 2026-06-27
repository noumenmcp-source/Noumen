"""Deliverability hygiene: a local suppression list of addresses that must NOT be emailed —
fed by hard-bounce / complaint feeds (e.g. SES SNS) or explicit blocklists.

Note (verified live 2026-06-19): Dittofeed has NO bulk "unsubscribed" endpoint. Subscription-based
suppression is per-user (an Email OptOut subscription group) and Dittofeed BROADCASTS HONOR IT
NATIVELY — so unsubscribes don't need this list. Use DittofeedClient.unsubscribe()/is_subscribed()
for subscription state; use SuppressionList for bounce/complaint addresses outside the subscription model."""


class SuppressionList:
    def __init__(self, suppressed=None):
        self._set = {e.lower() for e in (suppressed or []) if e}

    def add(self, email):
        if email:
            self._set.add(email.lower())

    def is_suppressed(self, email):
        return bool(email) and email.lower() in self._set

    def filter(self, users, email_field="email"):
        """Drop users whose email is suppressed. Accepts {'traits': {...}} or flat dicts."""
        kept = []
        for user in users:
            traits = user.get("traits", user) if isinstance(user, dict) else {}
            if not self.is_suppressed(traits.get(email_field, "")):
                kept.append(user)
        return kept

    def __len__(self):
        return len(self._set)


def handle_unsubscribe(email, suppression, client=None):
    """Process an unsubscribe: add to the in-memory suppression list and, if a Dittofeed
    client is provided, persist the opt-out (best-effort). Returns True on success."""
    suppression.add(email)
    if client is not None:
        try:
            client.unsubscribe(email)
        except Exception:  # noqa: BLE001 — persistence failure must not lose the local suppression
            pass
    return suppression.is_suppressed(email)
