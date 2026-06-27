"""Unit tests for the ml-content-worker run-loop, validator gate, and suppression.
No live Dittofeed or LLM fleet needed — fakes are injected."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from ml_content_worker.run import run
from ml_content_worker.suppression import SuppressionList, handle_unsubscribe
from ml_content_worker.validator import Validator
from ml_content_worker.clustering import cluster_users


class FakeFlot:
    """Records how many times the fleet was called (the cost lever under test)."""
    def __init__(self):
        self.calls = 0

    def generate_variants(self, brief, traits, num_variants):
        self.calls += 1
        interest = traits.get("interest", "оборудование")
        return [{
            "subject": f"Персональное предложение по {interest} для вашего бизнеса",
            "body": f"<p>Подобрали {interest} под профиль вашего сегмента.</p>",
        }]


class FakeDF:
    def __init__(self, users, unsubscribed=None):
        self._users = users
        self._unsub = unsubscribed or []
        self.written = {}

    def get_audience(self, segment_id):
        return self._users

    def write_traits(self, uid, traits):
        self.written[uid] = traits

    def list_unsubscribed(self):
        return self._unsub


def make_users():
    users = []
    for interest in ["станки", "насосы", "бетон"]:
        for region in ["Урал", "Москва", "Кубань"]:
            users.append({
                "userId": f"{interest}-{region}",
                "traits": {"interest": interest, "region": region, "email": f"{interest}-{region}@x.ru"},
            })
    users.append({"userId": "opt", "traits": {"interest": "станки", "region": "Урал", "email": "optout@x.ru"}})
    return users


def test_cost_lever_and_apply_to_all_members():
    users = make_users()                       # 10 users (9 + 1 suppressed)
    flot, df = FakeFlot(), FakeDF(users)
    res = run("camp1", "seg1", 1, df=df, flot=flot, max_microsegments=3, fields=["interest", "region"],
              suppression=SuppressionList(["optout@x.ru"]),
              showcase_fn=lambda traits: "<!--SHOWCASE-->")  # stub: no network in tests

    assert res["clusters"] <= 3, res
    assert flot.calls <= 3, f"cost lever broken: {flot.calls} fleet calls (expected <=3, not per-user)"
    assert "opt" not in res["users"], "suppressed user must be excluded"
    assert res["applied"] == len(users) - 1, res     # all non-suppressed got content
    for uid in res["users"]:
        w = df.written[uid]
        assert "gen_subject" in w and "gen_body_html" in w
        assert "<!--SHOWCASE-->" in w["gen_body_html"], "per-profile showcase must be injected"
    print(f"OK cost lever: {flot.calls} fleet calls for {res['applied']} users in {res['clusters']} clusters")


def test_validator_gate():
    v = Validator()
    assert not v.validate_variant("short", "<p>ok</p>")[0]                                   # subject too short
    assert not v.validate_variant("A perfectly fine subject line here now", "<p>oops {{ x</p>")[0]  # unbalanced tags
    assert not v.validate_variant("A perfectly fine subject line here now", "buy spam now")[0]       # banned word? 'spam' not in set; use clickbait
    assert not v.validate_variant("A perfectly fine subject line here now", "this is clickbait")[0]  # banned word
    assert v.validate_variant("A perfectly fine subject line here now", "<p>clean body</p>")[0]      # valid
    print("OK validator gate")


def test_suppression_and_unsubscribe():
    s = SuppressionList(["a@x.ru"])
    assert s.is_suppressed("A@X.RU")                         # case-insensitive
    assert not s.is_suppressed("b@x.ru")
    handle_unsubscribe("b@x.ru", s)
    assert s.is_suppressed("b@x.ru")
    kept = s.filter([{"traits": {"email": "a@x.ru"}}, {"traits": {"email": "c@x.ru"}}])
    assert len(kept) == 1 and kept[0]["traits"]["email"] == "c@x.ru"
    print("OK suppression + unsubscribe")


def test_empty_audience():
    res = run("c", "s", 1, df=FakeDF([]), flot=FakeFlot(), max_microsegments=3)
    assert res == {"clusters": 0, "generated": 0, "applied": 0, "users": []}
    print("OK empty audience")


if __name__ == "__main__":
    test_cost_lever_and_apply_to_all_members()
    test_validator_gate()
    test_suppression_and_unsubscribe()
    test_empty_audience()
    print("\nALL TESTS PASSED")
