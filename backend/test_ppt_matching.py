"""scan_homework_all의 PPT owner 매칭 로직 테스트"""


def _match_ppt_owners(title, members_by_name, team_to_member_ids):
    """프로덕션 _match_ppt_owners와 동일한 알고리즘 (이름→id, 팀→[ids])"""
    owners = set()
    for name, mid in members_by_name.items():
        if name and name in title:
            owners.add(mid)
    for team_name, mids in team_to_member_ids.items():
        if team_name and team_name in title:
            owners.update(mids)
    return owners


def test_ppt_multi_presenter_team_session():
    """팀세션 PPT — 두 발표자 모두 매칭되어야 함"""
    title = "PPT07주차_주제01(욕망)_이서정P, 이수인P"
    members = {"이서정": 11, "이수인": 22, "김다은": 33}
    teams = {}
    owners = _match_ppt_owners(title, members, teams)
    assert owners == {11, 22}, f"expected {{11, 22}}, got {owners}"


def test_ppt_individual_session():
    """개인 세션 PPT — 단일 발표자"""
    title = "PPT05주차_주제02_김다은P"
    members = {"이서정": 11, "이수인": 22, "김다은": 33}
    teams = {}
    owners = _match_ppt_owners(title, members, teams)
    assert owners == {33}, f"expected {{33}}, got {owners}"


def test_ppt_team_name_only():
    """제목에 팀명만 들어간 경우 — 팀 멤버 모두 매칭"""
    title = "PPT16주차_1팀"
    members = {"홍길동": 1, "김철수": 2}
    teams = {"1팀": [1, 2], "2팀": [3, 4]}
    owners = _match_ppt_owners(title, members, teams)
    assert owners == {1, 2}, f"expected {{1, 2}}, got {owners}"


def test_ppt_freeform_team_name():
    """자유 형식 팀명 (예: '짝짜꿍') — 팀명 substring 매칭으로 처리"""
    title = "PPT07주차_짝짜꿍"
    members = {"홍길동": 1, "김철수": 2, "이영희": 3}
    teams = {"짝짜꿍": [1, 2], "공격수": [3]}
    owners = _match_ppt_owners(title, members, teams)
    assert owners == {1, 2}, f"expected {{1, 2}}, got {owners}"


def test_ppt_team_name_and_member_names_union():
    """팀명 + 멤버 이름 둘 다 있으면 union — 중복 제거됨"""
    title = "PPT07주차_짝짜꿍_김다은P, 도민희P"
    members = {"김다은": 11, "도민희": 22, "이슬아": 33}
    teams = {"짝짜꿍": [11, 22]}
    owners = _match_ppt_owners(title, members, teams)
    assert owners == {11, 22}, f"expected {{11, 22}}, got {owners}"


def test_ppt_no_match():
    """매칭 안 되는 경우 — 빈 set 반환 (fallback은 호출자에서 처리)"""
    title = "PPT07주차_미매칭_제목"
    members = {"김다은": 11, "도민희": 22}
    teams = {"짝짜꿍": [11, 22]}
    owners = _match_ppt_owners(title, members, teams)
    assert owners == set(), f"expected empty set, got {owners}"


if __name__ == "__main__":
    test_ppt_multi_presenter_team_session()
    test_ppt_individual_session()
    test_ppt_team_name_only()
    test_ppt_freeform_team_name()
    test_ppt_team_name_and_member_names_union()
    test_ppt_no_match()
    print("OK — all PPT matching tests passed")
