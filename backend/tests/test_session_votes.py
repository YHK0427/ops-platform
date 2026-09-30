"""오프·오피 투표 — 집계와 정산 대기 상점 교체."""
from types import SimpleNamespace

from app.models import Session
from app.routers.session_votes import _stage, _tally, _unstage


def _b(voter, cat, cand):
    return SimpleNamespace(voter_member_id=voter, category=cat, candidate_member_id=cand)


def test_tally_counts_only_current_voters_and_candidates():
    vote = SimpleNamespace(candidates={"OFF": [1, 2], "OPI": [1, 2]})
    ballots = [_b(3, "OFF", 1), _b(4, "OFF", 1), _b(5, "OFF", 2), _b(9, "OFF", 2), _b(3, "OPI", 7)]
    # 9 는 결석 처리돼 투표권이 없고, 7 은 후보가 아니다
    assert _tally(vote, ballots, {3, 4, 5}) == {"OFF": {1: 2, 2: 1}, "OPI": {1: 0, 2: 0}}


def test_runoff_has_only_tied_category():
    vote = SimpleNamespace(candidates={"OFF": [1, 2]})
    assert list(_tally(vote, [], set())) == ["OFF"]


def test_stage_and_unstage_keep_manual_merits():
    s = Session(config={"staged_merits": [{"member_id": 5, "score_delta": 1, "reason": "수동"}]})
    _stage(s, 10, "OFF", [1])
    _stage(s, 11, "OPI", [1, 2])
    assert [m["reason"] for m in s.config["staged_merits"]] == ["수동", "오프/오피 선정 (오프)", "오프/오피 선정 (오피)", "오프/오피 선정 (오피)"]
    _unstage(s, {11})
    assert [(m["member_id"], m.get("vote_id")) for m in s.config["staged_merits"]] == [(5, None), (1, 10)]
