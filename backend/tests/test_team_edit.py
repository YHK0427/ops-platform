"""팀 수정(PREP/OPS 재편집) — 팀 행 매칭, 영상 앵커 가드, 보드 슬롯 번호, PPT 제목 팀명 매칭."""
from types import SimpleNamespace as NS

from app.routers.sessions import _match_teams, video_anchor_blocked
from app.routers.team_building import _team_slots
from app.services.crawler_homework import _match_ppt_owners


def _team(tid, name, mids):
    return NS(id=tid, name=name, members=[NS(member_id=m) for m in mids])


def _in(name, mids):
    return NS(name=name, members=[NS(member_id=m) for m in mids])


def _ids(matched):
    return {i: t.id for i, t in matched.items()}


def test_rename_keeps_team_row():
    old = [_team(1, "1조", [1, 2]), _team(2, "2조", [3, 4])]
    assert _ids(_match_teams(old, [_in("리슨업", [1, 2]), _in("2조", [3, 4])])) == {0: 1, 1: 2}


def test_name_swap_follows_members_not_names():
    old = [_team(1, "1조", [1, 2]), _team(2, "2조", [3, 4])]
    assert _ids(_match_teams(old, [_in("2조", [1, 2]), _in("1조", [3, 4])])) == {0: 1, 1: 2}


def test_move_one_person_keeps_both_rows():
    old = [_team(1, "1조", [1, 2, 3]), _team(2, "2조", [4, 5])]
    assert _ids(_match_teams(old, [_in("1조", [1, 2]), _in("2조", [3, 4, 5])])) == {0: 1, 1: 2}


def test_new_team_and_deleted_team():
    old = [_team(1, "1조", [1, 2]), _team(2, "2조", [3, 4])]
    # 3번이 1조로 가고 4번만 남은 팀을 "3조"로 → 4번이 있던 2조 행을 이어받음
    assert _ids(_match_teams(old, [_in("1조", [1, 2, 3]), _in("3조", [4])])) == {0: 1, 1: 2}
    # 2조 전원이 1조로 → 2조 행은 짝 없음(삭제 대상), 새 팀은 새 행
    assert _ids(_match_teams(old, [_in("1조", [1, 2, 3, 4]), _in("5조", [7])])) == {0: 1}
    # 사람이 하나도 안 겹쳐도 같은 이름이면 그 팀 행
    assert _ids(_match_teams(old, [_in("2조", [9])])) == {0: 2}


def test_each_row_used_once():
    old = [_team(1, "1조", [1, 2, 3, 4])]
    m = _ids(_match_teams(old, [_in("1조", [1, 2]), _in("5조", [3, 4])]))
    assert m == {0: 1}


def test_video_anchor_guard():
    old_team_of = {1: 10, 2: 10, 3: 20}
    # 영상 붙은 1번이 팀 10에 그대로 → OK, 다른 사람(2) 이동은 상관없음
    assert video_anchor_blocked({1}, old_team_of, {1: 10, 2: 20, 3: 20}) == []
    # 1번이 다른 팀/미배정/새 팀(None) → 막음
    assert video_anchor_blocked({1}, old_team_of, {1: 20, 2: 10, 3: 20}) == [1]
    assert video_anchor_blocked({1}, old_team_of, {2: 10, 3: 20}) == [1]
    # 원래 팀에 없던 사람의 파일(개인 세션 잔재 등)은 무시
    assert video_anchor_blocked({99}, old_team_of, {}) == []


def test_team_slots_only_n_jo_names():
    teams = [NS(id=1, name="1조"), NS(id=2, name="리슨업 2025"), NS(id=3, name="3 조 BP"), NS(id=4, name="10조")]
    assert _team_slots(teams) == {1: 1, 3: 3, 4: 10, 2: 2}


def test_ppt_team_name_not_matched_inside_bigger_number():
    members = [NS(id=1, name="김가")]
    team_map = {"1조": NS(id=10), "11조": NS(id=11)}
    tm = {10: [1, 2], 11: [3, 4]}
    assert _match_ppt_owners("PPT07주차_11조", members, team_map, tm) == {3, 4}
    assert _match_ppt_owners("PPT07주차_1조", members, team_map, tm) == {1, 2}
    assert _match_ppt_owners("PPT07주차 1조, 11조 김가", members, team_map, tm) == {1, 2, 3, 4}
