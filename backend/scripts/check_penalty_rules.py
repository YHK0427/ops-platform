"""벌점 규칙 설정 · 출결 미처리 마감 막기 · 연속 출석 표시 self-check — 떠 있는 backend 에 실제 HTTP 로 붙는다 (dev DB).
바꾼 규칙·출결은 끝에 되돌린다. 마감은 실제로 하지 않는다(409 경로만 HTTP, 나머지는 롤백 트랜잭션).

    MSYS_NO_PATHCONV=1 docker exec -e PYTHONPATH=/app -w /app opsbundle-backend-1 python scripts/check_penalty_rules.py
"""
import asyncio
import io
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt
from openpyxl import load_workbook
from sqlalchemy import select, text

import app.logging_config  # noqa: F401 — logger.audit
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Cohort, Member, Session as SessionModel, User
from app.services.penalty_engine import attendance_penalty, check_milestone_fines, ppt_email_penalty
from app.services.penalty_rules import DEFAULT_RULES, PenaltyRules, rules_signature

API = "http://localhost:8000/api/v1"
passed = 0

# 이 기능 전 하드코딩돼 있던 표 — 기본 규칙이 예전과 똑같이 계산하는지 회귀 확인
OLD_MATRIX = {
    ("LATE_UNDER10", "PRE"): (-1, -2000), ("LATE_UNDER10", "POST"): (-1, -3000), ("LATE_UNDER10", None): (-1, -4000),
    ("LATE_OVER10", "PRE"): (-2, -2000), ("LATE_OVER10", "POST"): (-2, -3000), ("LATE_OVER10", None): (-2, -4000),
    ("EARLY_LEAVE", "PRE"): (-2, -2000), ("EARLY_LEAVE", "POST"): (-2, -3000), ("EARLY_LEAVE", None): (-2, -4000),
    ("ABSENT", "PRE"): (-4, -4000), ("ABSENT", "POST"): (-4, -6000), ("ABSENT", None): (-4, -8000),
    ("EXCUSED", None): (0, 0), ("PRESENT", None): (0, 0), ("PENDING", None): (0, 0),
}


def ok(name):
    global passed
    passed += 1
    print(f"  PASS {name}")


def token(u: User):
    return jwt.encode({"sub": u.username, "uid": u.id, "role": u.role, "cohort_id": u.cohort_id,
                       "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                      settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def sql(q, **kw):
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(q), kw)
        await db.commit()
        return r


def unit_checks():
    for (st, ex), want in OLD_MATRIX.items():
        assert attendance_penalty(st, ex, False, DEFAULT_RULES) == want, (st, ex)
    assert attendance_penalty("LATE_UNDER10", "PRE", True, DEFAULT_RULES) == (0, 0)
    assert attendance_penalty("ABSENT", "PRE", True, DEFAULT_RULES) == (-4, -4000)  # 결석은 인정 면제 없음
    assert ppt_email_penalty("LATE") == (-1, -1000) and ppt_email_penalty("MISSING") == (-2, -3000) and ppt_email_penalty("PASS") == (0, 0)
    ok("기본 규칙 = 예전 하드코딩 표와 같은 금액 (출결 15칸·인정 면제·PPT)")
    from pydantic import ValidationError
    from app.schemas.ledger import PenaltyRequest
    PenaltyRequest(member_id=1, score_delta=0, deposit_delta=-1000, description="차감만")
    PenaltyRequest(member_id=1, score_delta=-1, description="벌점만")
    for bad in ({"score_delta": 0, "deposit_delta": 0}, {"score_delta": 1}, {"score_delta": -1, "deposit_delta": 500}):
        try:
            PenaltyRequest(member_id=1, description="x", **bad)
            raise AssertionError(f"통과하면 안 됨: {bad}")
        except ValidationError:
            pass
    ok("수동 벌점: 0점·차감만(규칙에서 점수 0인 항목) 허용, 둘 다 0·양수는 거부")
    th = lambda b, a, r=DEFAULT_RULES: [m["threshold"] for m in check_milestone_fines(b, a, r)]  # noqa: E731
    assert th(-8, -12) == [-10] and th(-9, -31) == [-10, -20, -30] and th(-10, -12) == [] and th(-55, -61) == [-60]
    r5 = PenaltyRules(milestone_every=5, milestone_fine=3000)
    assert th(-4, -11, r5) == [-5, -10] and check_milestone_fines(-4, -6, r5)[0]["deposit_delta"] == -3000
    assert check_milestone_fines(-8, -30, PenaltyRules(milestone_fine=0)) == []
    ok("누적벌점 벌금: 넘은 구간마다 1번, 이미 지난 구간 X, 간격·금액 규칙대로, 금액 0이면 없음, -50 넘어도 계속")
    try:
        PenaltyRules(warn_from=20, eviction_limit=14)
        raise AssertionError("검증 통과됨")
    except ValueError:
        pass
    ok("경고 시작 > 퇴출 기준은 거부")


async def main():
    unit_checks()
    async with AsyncSessionLocal() as db:
        users = {u.username: u for u in (await db.execute(select(User).where(User.is_active))).scalars().all()}
        cid = 1
        co = await db.get(Cohort, cid)
        orig_rules = co.penalty_rules
        co.penalty_rules = None  # 기본값에서 시작 (끝에 원복)
        await db.commit()

        def pick(role, dept):
            return next(u for u in users.values() if u.role == role and u.department == dept and u.cohort_id == cid)
        admin = next(u for u in users.values() if u.role == "admin")
        chongmu, haksul, gihoek, hoejang = pick("manager", "총무부"), pick("manager", "학술부"), pick("manager", "기획부"), pick("manager", "회장단")
        viewer_haksul = pick("viewer", "학술부")
        s_settle = (await db.execute(select(SessionModel).where(SessionModel.cohort_id == cid, SessionModel.status == "SETTLEMENT"))).scalars().first()
        s_post = (await db.execute(select(SessionModel).where(SessionModel.cohort_id == cid, SessionModel.status == "POST", SessionModel.type == "TEAM"))).scalars().first()

    H = lambda u: {"Authorization": f"Bearer {token(u)}", **({"X-Cohort-Id": str(cid)} if u.cohort_id is None else {})}  # noqa: E731
    async with httpx.AsyncClient(base_url=API, timeout=30) as c:
        try:
            # ── 조회·권한
            r = (await c.get("/penalty-rules", headers=H(gihoek))).json()
            assert r["rules"] == DEFAULT_RULES.model_dump() and r["is_default"] and r["defaults"] == r["rules"]
            assert r["rules"]["eviction_limit"] == 14, "요청 #11: 퇴출 기준 14"
            ok("조회: 기본값(퇴출 기준 14 = -15부터 퇴출)")
            for u, want in ((admin, True), (chongmu, True), (haksul, True), (gihoek, False), (hoejang, False), (viewer_haksul, False)):
                got = (await c.get("/penalty-rules", headers=H(u))).json()["can_edit"]
                assert got is want, (u.username, u.role, u.department, got)
            ok("수정 권한: admin·총무부·학술부(manager)만 / 기획부·회장단·학술부 viewer 는 X")
            sig = r["signature"]
            body = {"rules": {**DEFAULT_RULES.model_dump(), "eviction_limit": 20}, "base_signature": sig}
            for u in (gihoek, viewer_haksul):
                assert (await c.put("/penalty-rules", headers=H(u), json=body)).status_code == 403
            ok("권한 없는 사람 저장 → 403")
            bad = {"rules": {**DEFAULT_RULES.model_dump(), "warn_from": 30}, "base_signature": sig}
            assert (await c.put("/penalty-rules", headers=H(haksul), json=bad)).status_code == 422
            neg = {"rules": {**DEFAULT_RULES.model_dump(), "homework_missing": {"score": -1, "deposit": 1000}}, "base_signature": sig}
            assert (await c.put("/penalty-rules", headers=H(haksul), json=neg)).status_code == 422
            ok("잘못된 값(경고>퇴출, 음수) → 422")
            assert (await c.put("/penalty-rules", headers=H(haksul), json={**body, "base_signature": "stale"})).status_code == 409
            ok("그사이 바뀐 규칙에 저장 → 409")

            # ── 저장 → 정산·표시에 반영
            new = DEFAULT_RULES.model_dump()
            new["ABSENT"]["NONE"] = {"score": 5, "deposit": 9000}
            new.update(eviction_limit=20, warn_from=10, streak_count=3, streak_score=3, low_deposit=12000)
            r = await c.put("/penalty-rules", headers=H(chongmu), json={"rules": new, "base_signature": sig})
            assert r.status_code == 200, r.text
            got = (await c.get("/penalty-rules", headers=H(gihoek))).json()
            assert got["rules"] == new and not got["is_default"] and got["signature"] != sig
            new_sig = got["signature"]
            ok("총무부 저장 → 모두에게 같은 값, 서명 바뀜")

            pv = (await c.get(f"/sessions/{s_settle.id}/settlement-preview", headers=H(gihoek))).json()
            assert pv["rules_signature"] == new_sig
            absent = [p for p in pv["penalties"] if p["type"] == "ATTENDANCE" and p["description"].startswith("결석 (사유서없음)")]
            assert absent and all(p["score_delta"] == -5 and p["deposit_delta"] == -9000 for p in absent), absent
            ok("정산 미리보기: 바뀐 결석 금액(-5점/-9,000원) + 규칙 서명")
            assert all("3주 연속 출석 달성" in m["description"] and m["score_delta"] == 3 for m in pv["merits"] if m["source"] == "streak")
            ok(f"정산 미리보기: 연속출석 상점이 규칙 횟수·점수로 ({sum(m['source'] == 'streak' for m in pv['merits'])}건)")

            from app.services.finalize import RulesChangedError, finalize_session
            async with AsyncSessionLocal() as db:
                try:
                    await finalize_session(s_settle.id, db, [], [], None, sig)  # 옛 서명
                    raise AssertionError("옛 규칙 서명으로 마감이 통과됨")
                except RulesChangedError:
                    pass
                await db.rollback()
            ok("미리보기 뒤 규칙이 바뀌었으면 마감 거부 (RulesChangedError → 409)")

            st = (await c.get("/members/attendance-streaks", headers=H(gihoek))).json()
            from app.services.streak_checker import current_streaks
            async with AsyncSessionLocal() as db:
                runs = await current_streaks(db, cid)
            assert st["streak_count"] == 3 and {int(k): v["run"] for k, v in st["members"].items()} == runs
            assert all(v["to_next"] == max(1, (v["granted"] + 1) * 3 - v["run"]) for v in st["members"].values())
            ok(f"멤버 연속 출석: 횟수 = 계산값, 상점까지 남은 횟수는 규칙(3회) 기준 (최대 {max(runs.values(), default=0)}회)")

            from app.services.excel_export import generate_excel_bytes
            async with AsyncSessionLocal() as db:
                res = await generate_excel_bytes(db, cid)
            wb = load_workbook(io.BytesIO(res.stream.getvalue()))
            cells = {str(cell.value) for ws in wb.worksheets for row in ws.iter_rows(max_row=12) for cell in row if cell.value}
            assert any(v.startswith("3회 연속") and "(3)" in v for v in cells), [v for v in cells if "연속" in v]
            ok("엑셀: 연속출석 열 제목이 규칙(3회·3점)으로, 내보내기 오류 없음")

            # 연속 출석 시나리오 (롤백 트랜잭션): 한 멤버를 마감된 세션 전부 + 이번 세션 출석으로
            from app.services.streak_checker import check_attendance_streaks
            r3 = PenaltyRules(streak_count=3, streak_score=3)
            async with AsyncSessionLocal() as db:
                fin = (await db.execute(text("select id from sessions where cohort_id=:c and status='FINALIZED'"), {"c": cid})).scalars().all()
                x = (await db.execute(text("select a.member_id from attendance a join members m on m.id=a.member_id "
                                           "where a.session_id=:s and m.is_active limit 1"), {"s": s_settle.id})).scalar()
                await db.execute(text("update attendance set status='PRESENT' where member_id=:m and session_id = any(:ids)"),
                                 {"m": x, "ids": list(fin) + [s_settle.id]})
                await db.execute(text("delete from ledger where member_id=:m and description like '%연속 출석 달성%'"), {"m": x})
                assert (await current_streaks(db, cid))[x] == len(fin)
                mine = [i for i in (await check_attendance_streaks(db, s_settle.id, r3))["merit_items"] if i["member_id"] == x]
                assert len(mine) == (len(fin) + 1) // 3 and all(i["score_delta"] == 3 and i["description"].startswith("3주 연속 출석 달성 (") for i in mine), mine
                # 예전 문구("4주 …")로 이미 받은 상점도 '받은 것'으로 센다 — 같은 구간 두 번 지급 X
                first_fin = (await db.execute(text("select id from sessions where id = any(:ids) order by date desc limit 1"), {"ids": list(fin)})).scalar()
                await db.execute(text("insert into ledger (member_id, session_id, type, amount_krw, score_delta, deposit_after, description) "
                                      "values (:m, :s, 'MERIT', 0, 2, 0, '4주 연속 출석 달성 (옛 문구)')"), {"m": x, "s": first_fin})
                again = [i for i in (await check_attendance_streaks(db, s_settle.id, r3))["merit_items"] if i["member_id"] == x]
                assert len(again) == len(mine) - 1, (len(again), len(mine))
                from app.services.streak_checker import current_streak_state
                assert (await current_streak_state(db, cid))[x] == (len(fin), 1)  # 배지의 '받은 수'도 같은 기준
                zero = await check_attendance_streaks(db, s_settle.id, PenaltyRules(streak_score=0))
                assert zero["merit_items"] == []
                await db.execute(text("update attendance set status='PENDING' where member_id=:m and session_id=:s"), {"m": x, "s": first_fin})
                assert (await current_streaks(db, cid))[x] == 0
                await db.rollback()
            ok(f"연속 출석: 마감 {len(fin)}회 출석 → 표시 {len(fin)}회, 상점 {len(mine)}건(3회마다 +3), 옛 '4주' 상점도 받은 걸로 셈, 상점 0점이면 없음, 미처리에서 끊김")

            # ── 출결 미처리 → 마감 막기
            mem = (await sql("select a.member_id, m.name, a.status from attendance a join members m on m.id=a.member_id "
                             "where a.session_id=:s and m.is_active and a.status='PENDING' limit 1", s=s_post.id)).one()
            pv = (await c.get(f"/sessions/{s_post.id}/settlement-preview", headers=H(gihoek))).json()
            assert mem.name in pv["unprocessed_attendance"], pv["unprocessed_attendance"][:5]
            r = await c.post(f"/sessions/{s_post.id}/finalize", headers=H(chongmu), json={"overrides": [], "skip_merit_indices": []})
            assert r.status_code == 409 and "출결 미처리" in r.json()["detail"], r.text
            still = (await sql("select status from sessions where id=:s", s=s_post.id)).scalar()
            assert still == "POST"
            ok(f"미처리 출결 있으면: 미리보기에 명단 + 마감 API 409 (세션 상태 그대로 {still})")
            from app.services.finalize import unprocessed_attendance
            async with AsyncSessionLocal() as db:
                sess = await db.get(SessionModel, s_settle.id)
                before = await unprocessed_attendance(db, sess)
                victim = (await db.execute(text("select a.member_id, m.name from attendance a join members m on m.id=a.member_id "
                                                "where a.session_id=:s and m.is_active and a.status='PRESENT' limit 1"), {"s": s_settle.id})).one()
                await db.execute(text("delete from attendance where session_id=:s and member_id=:m"), {"s": s_settle.id, "m": victim.member_id})
                after = await unprocessed_attendance(db, sess)
                await db.execute(text("insert into attendance (session_id, member_id, status) values (:s, :m, 'PENDING')"), {"s": s_settle.id, "m": victim.member_id})
                assert victim.name in await unprocessed_attendance(db, sess)
                # 팀이 있는 세션: 출석 탭이 팀 명단으로만 그려지므로 팀에 없는 사람은 막지 않음
                other = (await db.execute(text("select a.member_id from attendance a join members m on m.id=a.member_id "
                                               "where a.session_id=:s and m.is_active and a.member_id<>:v limit 1"),
                                          {"s": s_settle.id, "v": victim.member_id})).scalar()
                tid = (await db.execute(text("insert into teams (session_id, name) values (:s, 'QA팀') returning id"), {"s": s_settle.id})).scalar()
                await db.execute(text("insert into team_members (team_id, member_id) values (:t, :m)"), {"t": tid, "m": other})
                no_team = await unprocessed_attendance(db, sess)
                await db.execute(text("insert into team_members (team_id, member_id) values (:t, :m)"), {"t": tid, "m": victim.member_id})
                in_team = await unprocessed_attendance(db, sess)
                await db.execute(text("update members set is_active=false where id=:m"), {"m": victim.member_id})
                inactive = await unprocessed_attendance(db, sess)
                await db.rollback()
            assert victim.name not in before and victim.name not in after and victim.name not in inactive
            assert victim.name not in no_team and victim.name in in_team
            ok("출결 행 없는 멤버·팀 세션에서 팀에 없는 멤버(출석 탭에 안 나와 고칠 수 없음)는 막지 않음, 미처리 행은 막음, 비활성 제외")

            # ── 기본값으로 되돌리면 NULL
            r = await c.put("/penalty-rules", headers=H(admin), json={"rules": DEFAULT_RULES.model_dump(), "base_signature": new_sig})
            assert r.status_code == 200 and r.json()["is_default"]
            assert (await sql("select penalty_rules is null from cohorts where id=:c", c=cid)).scalar() is True  # JSON null 아님
            ok("기본값으로 저장 → DB 는 NULL (기본값이 바뀌면 따라감)")
            assert rules_signature(DEFAULT_RULES) == sig
        finally:
            async with AsyncSessionLocal() as db:
                co = await db.get(Cohort, cid)
                co.penalty_rules = orig_rules
                await db.commit()
            print(f"정리: 규칙 원복({'기본값' if orig_rules is None else '이전 값'})")
    print(f"ALL PASS ({passed})")


asyncio.run(main())
