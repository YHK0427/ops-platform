"""팀빌딩 보드↔세션 연결 흐름 self-check (dev DB, 테스트 데이터는 끝에 정리).

    docker compose exec -T -e PYTHONPATH=/app backend python scripts/check_team_building_link.py
"""
import asyncio
from datetime import date

from sqlalchemy import select

import app.logging_config  # noqa: F401 — logger.audit 등록 (세션 삭제 경로가 씀)
from app.database import AsyncSessionLocal
from app.models import Assignment, Member, Session as SessionModel, Team, TeamBuildingBoard, TeamMember, User
from app.routers.team_building import (
    BoardCreate, BoardUpdate, _board_teams, _team_slots, create_board, delete_board, get_board, get_data, list_boards,
    update_board,
)


async def main():
    assert _board_teams({"num_teams": 2, "assignment": {"m1": 1, "u2": 1, "m3": "pool", "m4": 3, "x5": 1, "m6": True}}) == {
        1: {"members": [1], "staff": [2]},
    }

    async with AsyncSessionLocal() as db:
        sess = (await db.execute(
            # 마감된 세션만 — 연결 후 자동저장이 팀을 건드리면 안 되는 단계
            select(SessionModel).where(SessionModel.type == "TEAM", SessionModel.status == "FINALIZED",
                                       SessionModel.id.in_(select(Team.session_id)))
            .order_by(SessionModel.week_num)
        )).scalars().first()
        cid = sess.cohort_id
        # 이 세션 팀 그대로 보드 assignment 생성 + 운영진 1명을 첫 팀에 배치
        rows = (await db.execute(
            select(Team.id, TeamMember.member_id).join(TeamMember, TeamMember.team_id == Team.id)
            .where(Team.session_id == sess.id).order_by(Team.id)
        )).all()
        tids = sorted({r[0] for r in rows})
        asgn = {f"m{mid}": tids.index(tid) + 1 for tid, mid in rows}
        staff_id = (await db.execute(select(User.id).where(User.cohort_id == cid, User.is_active == True))).scalars().first()
        asgn[f"u{staff_id}"] = 1


        created = []
        try:
            a = await create_board(BoardCreate(name="__check 친바", data={"num_teams": len(tids), "assignment": asgn}), {}, cid, db)
            b = await create_board(BoardCreate(name="__check 리슨업", data={}), {}, cid, db)
            created = [a.id, b.id]

            # 1) 세션 미연결 보드 → 다른 보드의 겹침 기준으로 불러와짐 (운영진 포함)
            d = await get_data("", str(a.id), {}, cid, db)
            src = [p for p in d.past_teams if p.source == "board"]
            assert len(src) == 1 and src[0].board_id == a.id
            assert staff_id in src[0].teams[0].staff
            assert {m.id for t in src[0].teams for m in t.members} == {int(k[1:]) for k in asgn if k[0] == "m"}

            # 2) 세션에 연결 → 보드로는 더 이상 안 나옴 (중복 방지), 목록에 라벨
            await update_board(a.id, BoardUpdate(session_id=sess.id), {}, cid, db)
            d = await get_data("", str(a.id), {}, cid, db)
            assert not [p for p in d.past_teams if p.source == "board"], "연결된 보드가 보드로 또 나옴"
            lst = {x.id: x for x in await list_boards({}, cid, db)}
            assert lst[a.id].session_id == sess.id and lst[a.id].session_label.startswith(f"{sess.week_num}주차")

            # 3) 세션으로 불러오면 보드의 운영진 배치가 해당 세션 팀에 자동 추정
            d = await get_data(str(sess.id), "", {}, cid, db)
            st = [p for p in d.past_teams if p.session_id == sess.id][0]
            assert staff_id in next(t for t in st.teams if t.team_id == tids[0]).staff

            # 4) 같은 세션에 다른 보드 연결 → 기존 연결 해제 (세션 1 ↔ 보드 1)
            await update_board(b.id, BoardUpdate(session_id=sess.id), {}, cid, db)
            lst = {x.id: x for x in await list_boards({}, cid, db)}
            assert lst[a.id].session_id is None and lst[b.id].session_id == sess.id

            # 5) session_id 안 보내면 연결 유지 (자동저장이 연결을 날리지 않음), null 이면 해제
            await update_board(b.id, BoardUpdate(data={"x": 1}), {}, cid, db)
            assert (await db.get(TeamBuildingBoard, b.id)).session_id == sess.id
            await update_board(b.id, BoardUpdate(session_id=None), {}, cid, db)
            assert (await db.get(TeamBuildingBoard, b.id)).session_id is None

            # ── 동기화: 세션 상태별 ──
            assert _team_slots([Team(id=5, name="3조"), Team(id=6, name="A팀"), Team(id=7, name="1조")]) == {5: 3, 7: 1, 6: 2}
            mids = [m for m in (await db.execute(
                select(Member.id).where(Member.cohort_id == cid, Member.is_active == True).order_by(Member.id).limit(6)
            )).scalars()]
            tmp = SessionModel(cohort_id=cid, week_num=99, title="__check sync", date=date(2026, 12, 31), type="TEAM", status="PREP")
            db.add(tmp)
            await db.commit()

            async def members_by_slot():
                teams = (await db.execute(select(Team).where(Team.session_id == tmp.id))).scalars().all()
                slots = _team_slots(list(teams))
                out = {}
                for tid, mid in (await db.execute(
                    select(TeamMember.team_id, TeamMember.member_id).join(Team).where(Team.session_id == tmp.id)
                )).all():
                    out.setdefault(slots[tid], set()).add(mid)
                return out, {slots[t.id]: t.id for t in teams}

            def board(slots):
                return {"num_teams": 3, "assignment": {f"m{m}": s for m, s in zip(mids, slots)}}

            # 6) PREP 연결 보드에서 배치 → 세션 팀 생성 + 팀/개인 과제 생성
            await update_board(a.id, BoardUpdate(session_id=tmp.id), {}, cid, db)
            await update_board(a.id, BoardUpdate(data=board([1, 1, 1, 2, 2, 2])), {}, cid, db)
            got, team_ids = await members_by_slot()
            assert got == {1: set(mids[:3]), 2: set(mids[3:])}, got
            ppt = (await db.execute(select(Assignment).where(Assignment.session_id == tmp.id, Assignment.type == "PPT_EMAIL"))).scalars().all()
            assert len(ppt) == 2
            assert len((await db.execute(select(Assignment.id).where(Assignment.session_id == tmp.id, Assignment.member_id.isnot(None)))).all()) == 6 * 3

            # 7) 한 명만 옮기면 팀 행·제출된 팀 과제 유지
            p1 = next(x for x in ppt if x.team_id == team_ids[1])
            p1.status = "PASS"
            await db.commit()
            await update_board(a.id, BoardUpdate(data=board([1, 1, 2, 2, 2, 2])), {}, cid, db)
            got, team_ids2 = await members_by_slot()
            assert got == {1: set(mids[:2]), 2: set(mids[2:])} and team_ids2 == team_ids
            await db.refresh(p1)
            assert p1.status == "PASS"

            # 8) 비게 된 팀: 대기 과제만 있으면 삭제, 제출 기록 있으면 유지 / 새 번호 팀은 생성
            await update_board(a.id, BoardUpdate(data=board(["pool", "pool", 3, 3, 3, 3])), {}, cid, db)
            got, team_ids3 = await members_by_slot()
            assert got == {3: set(mids[2:])}, got
            assert 1 in team_ids3 and 2 not in team_ids3 and 3 in team_ids3, team_ids3

            # 9) 세션에서 직접 고친 팀 → 보드 읽을 때 반영 (세션 = 기준)
            await db.execute(TeamMember.__table__.update().where(TeamMember.team_id == team_ids3[3], TeamMember.member_id == mids[5]).values(team_id=team_ids3[1]))
            await db.commit()
            bd = await get_board(a.id, {}, cid, db)
            assert bd.data["assignment"][f"m{mids[5]}"] == 1 and bd.data["assignment"][f"m{mids[2]}"] == 3
            assert f"m{mids[0]}" not in bd.data["assignment"] and bd.session_status == "PREP"

            # 9b) 동시 편집: 보드는 옛 상태(mids[5]=3팀)를 들고 있다가 mids[2] 하나만 옮김 → 세션에서 옮긴 mids[5]는 유지
            stale = {"num_teams": 3, "assignment": {f"m{mids[2]}": 3, f"m{mids[3]}": 3, f"m{mids[4]}": 3, f"m{mids[5]}": 3}}
            board_row = await db.get(TeamBuildingBoard, a.id)
            board_row.data = stale
            await db.commit()
            moved = dict(stale["assignment"]); moved[f"m{mids[2]}"] = 2
            await update_board(a.id, BoardUpdate(data={"num_teams": 3, "assignment": moved}), {}, cid, db)
            got, team_ids3 = await members_by_slot()
            assert mids[5] in got[1] and mids[2] in got[2], got

            # 9c) 보드 명단에 없는 기수(비활성 등)는 세션 팀에서 빼지 않음
            only = {"num_teams": 3, "assignment": {f"m{mids[3]}": 1}}
            await update_board(a.id, BoardUpdate(data=only), {}, cid, db)
            got, team_ids3 = await members_by_slot()
            assert mids[4] in got[3] and mids[3] in got[1], got

            # 10) OPS 이후 → 보드 변경이 세션에 안 감
            tmp.status = "OPS"
            await db.commit()
            before, _ = await members_by_slot()
            await update_board(a.id, BoardUpdate(data=board([1, 1, 1, 1, 1, 1])), {}, cid, db)
            after, _ = await members_by_slot()
            assert before == after
            assert (await get_board(a.id, {}, cid, db)).session_status == "OPS"

            # 11) 연결 해제 → 마지막 세션 팀 구성이 보드에 남음 (방금 보낸 [1]*6 아님)
            await update_board(a.id, BoardUpdate(session_id=None), {}, cid, db)
            raw = (await db.get(TeamBuildingBoard, a.id)).data["assignment"]
            assert raw[f"m{mids[5]}"] == 1 and raw[f"m{mids[2]}"] == 2 and raw[f"m{mids[3]}"] == 1 and f"m{mids[0]}" not in raw, raw

            # 12) 세션 삭제 → 연결 해제 + 세션 쪽 마지막 팀 구성이 보드에 남음
            from app.routers.sessions import delete_session
            await update_board(a.id, BoardUpdate(session_id=tmp.id), {}, cid, db)
            await db.execute(TeamMember.__table__.update().where(
                TeamMember.team_id == team_ids3[1], TeamMember.member_id == mids[5]).values(team_id=team_ids3[3]))
            await db.commit()
            await delete_session(tmp.id, db, {}, cid)
            db.expire_all()
            row = await db.get(TeamBuildingBoard, a.id)
            assert row.session_id is None and row.data["assignment"][f"m{mids[5]}"] == 3, row.data
        finally:
            await db.rollback()  # 중간 실패로 트랜잭션이 깨졌어도 정리는 되게
            for bid in created:
                await delete_board(bid, {}, cid, db)
            t = (await db.execute(select(SessionModel).where(SessionModel.cohort_id == cid, SessionModel.week_num == 99))).scalars().first()
            if t:
                await db.execute(Assignment.__table__.delete().where(Assignment.session_id == t.id))
                await db.execute(Team.__table__.delete().where(Team.session_id == t.id))
                await db.delete(t)
                await db.commit()
    print("OK team_building link checks passed")


if __name__ == "__main__":
    asyncio.run(main())
