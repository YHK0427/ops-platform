"""scan_feedback_comments의 owner 매칭 로직만 분리 테스트"""


def _match_owners(title: str, members_by_name: dict, team_to_member_ids: dict):
    """프로덕션 코드와 동일한 매칭 알고리즘"""
    sep_idx = title.find("]-")
    variable_part = title[sep_idx + 2:] if sep_idx >= 0 else title

    owner_ids = set()
    for team_name, mids in team_to_member_ids.items():
        if team_name and team_name in variable_part:
            owner_ids.update(mids)
    for name, mid in members_by_name.items():
        if name in variable_part:
            owner_ids.add(mid)
    return owner_ids


def test_team_session_multi_presenter():
    """7주차 짝짜꿍 케이스 — 신념 팀 매칭 + 두 발표자 모두 등록"""
    title = "연합UP 33기 7주차 발표-[짝짜꿍]-주제01 신념(김다은P, 도민희P)"
    members = {"김다은": 11, "도민희": 22, "이슬아": 33}
    teams = {"신념": [11, 22], "짝짜꿍": [99]}
    owners = _match_owners(title, members, teams)
    # prefix 안의 [짝짜꿍]은 매칭 안 되어야 함 → 99 없음
    # 신념 팀의 멤버 11, 22 + 이름 매칭 11, 22 = {11, 22}
    assert owners == {11, 22}, f"expected {{11, 22}}, got {owners}"


def test_individual_session_single_presenter():
    """개인 세션 — '김민지P' 제목에서 김민지만 매치 (김민지수는 제목 substring 아님)"""
    title = "연합UP 33기 6주차 발표-[너의선택은]-김민지P(1분반 1번째)"
    members = {"김민지": 5, "김민지수": 6}
    teams = {}
    owners = _match_owners(title, members, teams)
    assert owners == {5}, f"expected {{5}}, got {owners}"


def test_substring_collision_known_limit():
    """이름이 다른 이름의 substring일 때 — 둘 다 매치 (알려진 한계)"""
    # 제목에 "김민지수P"가 들어가면 "김민지"도 substring 매치
    title = "연합UP 33기 6주차 발표-[너의선택은]-김민지수P(1번째)"
    members = {"김민지": 5, "김민지수": 6}
    teams = {}
    owners = _match_owners(title, members, teams)
    assert owners == {5, 6}, f"expected {{5, 6}}, got {owners}"


def test_session_title_in_prefix_not_matched():
    """[세션제목]은 prefix이므로 매칭 대상 아님"""
    title = "연합UP 33기 7주차 발표-[짝짜꿍]-신념(김다은P)"
    members = {"김다은": 11}
    teams = {"짝짜꿍": [99], "신념": [11, 22]}
    owners = _match_owners(title, members, teams)
    # 짝짜꿍은 prefix 안에 있어서 매칭 안 됨, 신념 팀 + 김다은
    assert owners == {11, 22}, f"expected {{11, 22}}, got {owners}"


def test_no_separator_falls_back_to_full_title():
    """']-'가 없으면 제목 전체로 매칭"""
    title = "수동입력영상-김민지"
    members = {"김민지": 5}
    teams = {}
    owners = _match_owners(title, members, teams)
    assert owners == {5}, f"expected {{5}}, got {owners}"


def test_team_name_only_no_member_names():
    """팀명만 있고 멤버 이름이 제목에 없어도 팀 매칭으로 owner 등록"""
    title = "연합UP 33기 5주차 발표-[팀세션]-1조(1번째)"
    members = {"홍길동": 1, "김철수": 2}
    teams = {"1조": [1, 2], "2조": [3, 4]}
    owners = _match_owners(title, members, teams)
    assert owners == {1, 2}, f"expected {{1, 2}}, got {owners}"


if __name__ == "__main__":
    test_team_session_multi_presenter()
    test_individual_session_single_presenter()
    test_substring_collision_known_limit()
    test_session_title_in_prefix_not_matched()
    test_no_separator_falls_back_to_full_title()
    test_team_name_only_no_member_names()
    print("OK — all matching tests passed")
