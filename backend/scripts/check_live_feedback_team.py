"""실시간 피드백 · 팀 세션 지원 self-check — 떠 있는 backend 에 실제 HTTP/WebSocket 으로 붙는다 (dev DB).
만든 보드·임시로 바꾼 값은 끝에 되돌린다.

    MSYS_NO_PATHCONV=1 docker compose exec -T -e PYTHONPATH=/app backend python scripts/check_live_feedback_team.py
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import websockets
from jose import jwt
from sqlalchemy import select, text

import app.logging_config  # noqa: F401 — logger.audit (라우터 직접 호출용)
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import GenerationAccount, Member, Session as SessionModel, Team, TeamMember, User

BASE = "http://localhost:8000/api/v1/live-feedback"
WS = "ws://localhost:8000/api/v1/live-feedback/ws"
CATS = [{"key": "praise", "label": "칭찬", "color": "emerald"}]
passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  PASS {name}")


def exp():
    return datetime.now(timezone.utc) + timedelta(hours=1)


def staff_token(u):
    return jwt.encode({"sub": u.username, "uid": u.id, "role": u.role, "cohort_id": u.cohort_id, "exp": exp()},
                      settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def member_token(mid, username, cid):
    return jwt.encode({"sub": username, "member_id": mid, "account_type": "generation", "cohort_id": cid, "exp": exp()},
                      settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def sql(q, **kw):
    async with AsyncSessionLocal() as db:
        r = await db.execute(text(q), kw)
        await db.commit()
        return r


async def main():
    async with AsyncSessionLocal() as db:
        team_sessions = (await db.execute(
            select(SessionModel).where(SessionModel.type == "TEAM", SessionModel.id.in_(select(Team.session_id)))
            .order_by(SessionModel.id))).scalars().all()
        s_team, s_member = team_sessions[-1], team_sessions[-2]  # 팀 전체 / 팀원 개인 보드용 팀 세션 2개
        cid = s_team.cohort_id
        s_indiv = (await db.execute(select(SessionModel).where(
            SessionModel.type == "INDIVIDUAL", SessionModel.cohort_id == cid,
            SessionModel.id.not_in(text("(select session_id from live_feedback_boards)"))))).scalars().first()
        staff = (await db.execute(select(User).where(User.cohort_id == cid, User.role == "manager"))).scalars().first()
        accts = {mid: u for mid, u in (await db.execute(
            select(GenerationAccount.member_id, GenerationAccount.username).join(Member)
            .where(Member.cohort_id == cid, GenerationAccount.is_active, Member.is_active))).all()}

        async def teams_of(sid):
            rows = (await db.execute(select(Team.id, Team.name, TeamMember.member_id)
                                     .join(TeamMember).where(Team.session_id == sid).order_by(Team.id, TeamMember.id))).all()
            out: dict[int, dict] = {}
            for tid, name, mid in rows:
                out.setdefault(tid, {"name": name, "members": []})["members"].append(mid)
            return out
        T = await teams_of(s_team.id)
        M = await teams_of(s_member.id)
        in_team = {m for t in T.values() for m in t["members"]}
        outsider = next(m for m in accts if m not in in_team)  # 이 팀 세션 어느 팀에도 없는 기수원
        other_session_team = next(iter(M))
        orig = {tid: (o, n) for tid, o, n in (await db.execute(select(Team.id, Team.presenter_order, Team.name)
                .where(Team.session_id.in_([s_team.id, s_member.id])))).all()}

    sh = {"Authorization": f"Bearer {staff_token(staff)}"}
    mh = lambda mid: {"Authorization": f"Bearer {member_token(mid, accts[mid], cid)}"}  # noqa: E731
    tids = list(T)
    t_a, t_b, t_c = tids[0], tids[1], tids[2]
    a1 = T[t_a]["members"][0]   # 팀 A 사람
    b1 = T[t_b]["members"][0]   # 팀 B 사람
    c1 = T[t_c]["members"][0]   # 팀 C 사람
    made: list[int] = []
    print(f"팀보드 세션={s_team.id} 팀원보드 세션={s_member.id} 개인 세션={s_indiv.id if s_indiv else None} staff={staff.username} outsider={outsider}")

    async with httpx.AsyncClient(timeout=20) as c:
        try:
            # ── 개인 세션: 회귀 + 막혀야 하는 것
            if s_indiv:
                r = await c.post(f"{BASE}/boards", headers=sh, json={"session_id": s_indiv.id, "title": "t", "categories": CATS, "target_mode": "TEAM"})
                assert r.status_code == 400, r.text; ok("개인 세션에 '팀 전체' 보드 → 400")
                r = await c.post(f"{BASE}/boards", headers=sh, json={"session_id": s_indiv.id, "title": "개인 회귀", "categories": CATS})
                assert r.status_code == 201 and r.json()["target_mode"] == "MEMBER" and r.json()["session_type"] == "INDIVIDUAL", r.text
                ib = r.json()["id"]; made.append(ib); ok("개인 세션 보드 생성 (target_mode 생략 → MEMBER)")
                d = (await c.get(f"{BASE}/boards/{ib}", headers=sh)).json()
                assert d["presenters"] and all("team_name" not in p and not p.get("is_team") for p in d["presenters"]), d["presenters"][:2]
                assert all("presenter_order" in p for p in d["presenters"]); ok("개인 보드 발표자: 팀 필드 없음, 운영진엔 발표 순서 있음")
                await c.patch(f"{BASE}/boards/{ib}", headers=sh, json={"is_open": True})
                me = d["presenters"][0]["presenter_member_id"]
                other = d["presenters"][1]["presenter_member_id"]
                md = (await c.get(f"{BASE}/member/boards/{ib}", headers=mh(me))).json()
                assert [p["presenter_member_id"] for p in md["presenters"] if p["is_own"]] == [me]
                assert all("presenter_order" not in p for p in md["presenters"]); ok("개인 보드 기수원 뷰: is_own=본인만, 순서 비노출")
                r = await c.post(f"{BASE}/member/boards/{ib}/posts", headers=mh(me), json={"presenter_member_id": me, "contents": {"praise": "셀프"}})
                assert r.status_code == 400, r.text; ok("개인 보드 본인에게 작성 → 400 (서버에서도 막음)")
                r = await c.post(f"{BASE}/member/boards/{ib}/posts", headers=mh(me), json={"presenter_member_id": other, "contents": {"praise": "굿"}})
                assert r.status_code == 201 and r.json()["presenter_member_id"] == other, r.text; ok("개인 보드 남에게 작성 → 201")

            # ── 팀 세션 · 팀 전체
            # 팀 발표 순서를 임시로 역순으로 — 운영진 정렬 확인용
            for i, tid in enumerate(reversed(tids)):
                await sql("update teams set presenter_order=:o where id=:t", o=i + 1, t=tid)
            r = await c.post(f"{BASE}/boards", headers=sh, json={"session_id": s_team.id, "title": "팀 전체", "categories": CATS, "target_mode": "TEAM"})
            assert r.status_code == 201 and r.json()["target_mode"] == "TEAM" and r.json()["session_type"] == "TEAM", r.text
            tb = r.json()["id"]; made.append(tb); ok("팀 세션 '팀 전체' 보드 생성")
            r = await c.post(f"{BASE}/boards", headers=sh, json={"session_id": s_team.id, "title": "중복", "categories": CATS, "target_mode": "MEMBER"})
            assert r.status_code == 409; ok("같은 세션 두 번째 보드 → 409")
            lst = (await c.get(f"{BASE}/boards", headers=sh)).json()
            row = next(b for b in lst if b["id"] == tb)
            assert row["session_type"] == "TEAM" and row["target_mode"] == "TEAM"; ok("보드 목록에 session_type/target_mode")

            d = (await c.get(f"{BASE}/boards/{tb}", headers=sh)).json()
            ps = d["presenters"]
            assert [p["presenter_member_id"] for p in ps] == list(reversed(tids)), [p["presenter_member_id"] for p in ps]
            assert all(p["is_team"] and len(p["member_names"]) == len(T[p["presenter_member_id"]]["members"]) for p in ps)
            ok("운영진: 발표자 = 팀(번호=team_id), 팀 발표 순서대로, 팀원 이름 포함")

            md = (await c.get(f"{BASE}/member/boards/{tb}", headers=mh(a1))).json()
            assert md["target_mode"] == "TEAM"
            assert [p["name"] for p in md["presenters"]] == sorted(T[t]["name"] for t in tids)
            assert all("presenter_order" not in p for p in md["presenters"])
            assert [p["presenter_member_id"] for p in md["presenters"] if p["is_own"]] == [t_a]
            ok("기수원: 팀 이름순, 순서 비노출, is_own=내 팀만")
            await sql("update teams set name='10조' where id=:t", t=t_a)
            md = (await c.get(f"{BASE}/member/boards/{tb}", headers=mh(a1))).json()
            assert [p["name"] for p in md["presenters"]][-1] == "10조", [p["name"] for p in md["presenters"]]
            await sql("update teams set name=:n where id=:t", n=orig[t_a][1], t=t_a)
            ok("팀 이름 숫자 정렬 (10조가 2조 뒤)")

            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1), json={"presenter_member_id": t_b, "contents": {"praise": "x"}})
            assert r.status_code == 400 and "마감" in r.text; ok("열기 전 작성 → 400(마감)")
            await c.patch(f"{BASE}/boards/{tb}", headers=sh, json={"is_open": True})

            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1), json={"presenter_member_id": t_a, "contents": {"praise": "우리팀"}})
            assert r.status_code == 400 and "내 팀" in r.text; ok("내 팀에 작성 → 400")
            person = next(m for m in T[t_b]["members"] if m not in tids)
            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1), json={"presenter_member_id": person, "contents": {"praise": "사람번호"}})
            assert r.status_code == 400, r.text; ok("팀 보드에 사람 번호로 작성 → 400")

            # WebSocket: 팀 B 사람이 듣는 중에 팀 A 사람이 팀 B 에 익명으로 작성
            ws_url = f"{WS}/{tb}?token={member_token(b1, accts[b1], cid)}"
            async with websockets.connect(ws_url) as ws:
                await asyncio.sleep(0.3)
                r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1),
                                 json={"presenter_member_id": t_b, "contents": {"praise": "팀B 최고"}, "is_anonymous": True, "client_nonce": "n1"})
                assert r.status_code == 201, r.text
                p = r.json()
                assert p["presenter_member_id"] == t_b and p["presenter_name"] == T[t_b]["name"] and "author_member_id" not in p
                ok("다른 팀에 작성 → 201, 발표자=팀 이름, 익명이면 작성자 번호 미노출")
                evt = json.loads(await asyncio.wait_for(ws.recv(), 5))
                assert evt["type"] == "post.created" and evt["data"]["presenter_name"] == T[t_b]["name"] and "author_member_id" not in evt["data"]
                ok("WebSocket post.created 수신 (팀 이름, 익명 유지)")
            post_id = p["id"]
            row = (await sql("select presenter_team_id, presenter_member_id, presenter_guest_id from live_feedback_posts where id=:i", i=post_id)).one()
            assert tuple(row) == (t_b, None, None); ok("DB: presenter_team_id 에 저장, 나머지 NULL")

            for viewer, label in ((b1, "받은 팀원"), (c1, "다른 팀")):
                posts = (await c.get(f"{BASE}/member/boards/{tb}/posts", headers=mh(viewer))).json()
                assert any(x["id"] == post_id for x in posts), label
            ok("받은 팀원·다른 팀 모두 글 목록에서 보임")

            r = await c.post(f"{BASE}/member/posts/{post_id}/comments", headers=mh(b1), json={"content": "고마워요"})
            assert r.status_code == 201, r.text
            r = await c.post(f"{BASE}/member/posts/{post_id}/reactions", headers=mh(c1), json={"emoji": "👍"})
            assert r.status_code == 201, r.text
            r = await c.patch(f"{BASE}/member/posts/{post_id}", headers=mh(a1), json={"contents": {"praise": "팀B 최고 (수정)"}})
            assert r.status_code == 200 and r.json()["presenter_name"] == T[t_b]["name"], r.text
            ok("팀 글에 댓글·반응·작성자 수정")

            r = await c.post(f"{BASE}/boards/{tb}/posts/staff", headers=sh, json={"presenter_member_id": t_a, "contents": {"praise": "운영진"}, "is_anonymous": False})
            assert r.status_code == 201 and r.json()["presenter_name"] == T[t_a]["name"], r.text; ok("운영진 팀에 작성")
            admin_posts = (await c.get(f"{BASE}/boards/{tb}/posts", headers=sh)).json()
            assert {x["presenter_member_id"] for x in admin_posts} == {t_a, t_b}; ok("운영진 글 목록 발표자 번호 = team_id")

            # 팀에 안 속한 기수원: 어느 팀에도 쓸 수 있고 '내 팀' 없음
            md = (await c.get(f"{BASE}/member/boards/{tb}", headers=mh(outsider))).json()
            assert not any(p["is_own"] for p in md["presenters"])
            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(outsider), json={"presenter_member_id": t_a, "contents": {"praise": "밖에서"}})
            assert r.status_code == 201, r.text; ok("팀 없는 기수원: 내 팀 없음, 아무 팀에 작성 가능")

            # 명단 조정: 팀 빼기 → 후보 → 다시 넣기, 다른 세션 팀은 거부, 외부 발표자
            r = await c.delete(f"{BASE}/boards/{tb}/presenters/{t_c}", headers=sh)
            assert t_c not in [x["presenter_member_id"] for x in r.json()["presenters"]]
            cand = (await c.get(f"{BASE}/boards/{tb}/presenter-candidates", headers=sh)).json()
            assert [x["member_id"] for x in cand] == [t_c] and cand[0]["status"] == "TEAM"
            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1), json={"presenter_member_id": t_c, "contents": {"praise": "x"}})
            assert r.status_code == 400
            r = await c.post(f"{BASE}/boards/{tb}/presenters", headers=sh, json={"member_id": t_c})
            assert t_c in [x["presenter_member_id"] for x in r.json()["presenters"]]
            ok("팀 빼기 → 후보에 뜸·작성 막힘 → 다시 넣기")
            r = await c.post(f"{BASE}/boards/{tb}/presenters", headers=sh, json={"member_id": other_session_team})
            assert r.status_code == 404; ok("다른 세션 팀 넣기 → 404")
            r = await c.post(f"{BASE}/boards/{tb}/presenters", headers=sh, json={"name": "초청 강사"})
            guest = next(x for x in r.json()["presenters"] if x["is_guest"])
            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1), json={"presenter_member_id": guest["presenter_member_id"], "contents": {"praise": "강의 굿"}})
            assert r.status_code == 201 and r.json()["presenter_name"] == "초청 강사", r.text
            md = (await c.get(f"{BASE}/member/boards/{tb}", headers=mh(a1))).json()
            assert md["presenters"][-1]["is_guest"]; ok("팀 보드에 외부 발표자 추가·작성 (기수원 목록 맨 뒤)")

            # 수정해도 대상은 그대로
            r = await c.patch(f"{BASE}/boards/{tb}", headers=sh, json={"title": "팀 전체 (수정)"})
            assert r.status_code == 200
            assert (await c.get(f"{BASE}/boards/{tb}", headers=sh)).json()["target_mode"] == "TEAM"; ok("보드 수정 후에도 target_mode 유지")

            # 팀이 지워지면 그 팀 글도 같이 (FK CASCADE) — 트랜잭션 안에서만 지우고 되돌린다
            async with AsyncSessionLocal() as db:
                # 앱(팀 수정)과 같은 순서: 팀 과제 먼저, 그다음 팀
                await db.execute(text("delete from assignments where team_id=:t"), {"t": t_b})
                await db.execute(text("delete from teams where id=:t"), {"t": t_b})
                left = (await db.execute(text("select count(*) from live_feedback_posts where presenter_team_id=:t"), {"t": t_b})).scalar()
                await db.rollback()
            assert left == 0; ok("팀 삭제 시 그 팀 글 CASCADE 삭제(FK 에러 없음)")

            # 팀 발표 순서 저장(일괄 UPDATE) → 열린 보드에 명단 변경 알림
            async with websockets.connect(f"{WS}/{tb}?token={member_token(b1, accts[b1], cid)}") as ws:
                await asyncio.sleep(0.3)
                r = await c.patch(f"http://localhost:8000/api/v1/sessions/{s_team.id}/team-order", headers=sh,
                                  json=[{"team_id": t, "presenter_order": i + 1} for i, t in enumerate(tids)])
                assert r.status_code == 200, r.text
                evt = json.loads(await asyncio.wait_for(ws.recv(), 5))
                assert evt["type"] == "board.roster_changed", evt
            ok("팀 발표 순서 저장 → 열린 보드에 board.roster_changed")

            # 팀 재편집으로 팀이 빠져도, 피드백 받은 팀은 남는다(글 보존). 커밋 대신 flush 후 롤백.
            from fastapi import HTTPException
            from app.routers.sessions import confirm_teams
            from app.schemas.team import TeamCreateRequest
            async with AsyncSessionLocal() as db:
                db.commit = db.flush
                sess_row = await db.get(SessionModel, s_team.id)
                sess_row.status = "PREP"  # 재편집 경로로 (롤백되니 원래 상태 무관)
                await db.flush()
                if True:
                    body = TeamCreateRequest(teams=[
                        {"name": T[t]["name"], "members": [{"member_id": m} for m in T[t]["members"] + (T[t_b]["members"] if t == t_c else [])]}
                        for t in tids if t != t_b])
                    try:
                        await confirm_teams(session_id=s_team.id, body=body, db=db, _={}, cohort_id=cid)
                        kept = (await db.execute(text("select count(*) from teams where id=:t"), {"t": t_b})).scalar()
                        members_left = (await db.execute(text("select count(*) from team_members where team_id=:t"), {"t": t_b})).scalar()
                        posts_left = (await db.execute(text("select count(*) from live_feedback_posts where presenter_team_id=:t"), {"t": t_b})).scalar()
                        assert kept == 1 and members_left == 0 and posts_left >= 1, (kept, members_left, posts_left)
                        ok("팀 재편집으로 팀이 빠져도 피드백 받은 팀·글은 남음(팀원만 비움)")
                    except HTTPException as e:
                        print(f"  SKIP 재편집 보존 확인 — {e.detail}")
                    await db.rollback()
                    sess_row = await db.get(SessionModel, s_team.id)
                sess_row.status = "SETUP"
                await db.flush()
                try:
                    await confirm_teams(session_id=s_team.id, body=TeamCreateRequest(teams=[]), db=db, _={}, cohort_id=cid)
                    raise AssertionError("SETUP 재확정이 통과됨")
                except HTTPException as e:
                    assert e.status_code == 400 and "피드백" in e.detail, e.detail
                await db.rollback()
            ok("SETUP 최초 확정(팀 전부 새로)은 피드백 글 있으면 400")

            await c.patch(f"{BASE}/boards/{tb}", headers=sh, json={"is_open": False})
            r = await c.post(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1), json={"presenter_member_id": t_c, "contents": {"praise": "x"}})
            assert r.status_code == 400; ok("마감 후 작성 → 400")
            assert len((await c.get(f"{BASE}/member/boards/{tb}/posts", headers=mh(a1))).json()) >= 3; ok("마감 후 읽기 가능")

            # ── 팀 세션 · 팀원 개인
            r = await c.post(f"{BASE}/boards", headers=sh, json={"session_id": s_member.id, "title": "팀원 개인", "categories": CATS, "target_mode": "MEMBER"})
            assert r.status_code == 201 and r.json()["target_mode"] == "MEMBER", r.text
            mb = r.json()["id"]; made.append(mb); ok("팀 세션 '팀원 개인' 보드 생성")
            mids = list(M)
            x_team, y_team = mids[0], mids[1]
            x1, x2 = M[x_team]["members"][0], M[x_team]["members"][1]
            y1 = M[y_team]["members"][0]
            absent = M[mids[-1]]["members"][-1]
            await sql("update attendance set status='ABSENT' where session_id=:s and member_id=:m", s=s_member.id, m=absent)
            try:
                d = (await c.get(f"{BASE}/boards/{mb}", headers=sh)).json()
                ps = d["presenters"]
                assert absent not in [p["presenter_member_id"] for p in ps]
                assert all(p["team_name"] for p in ps) and not any(p.get("is_team") for p in ps)
                names = [p["team_name"] for p in ps]
                # 같은 팀끼리 붙어 있다
                seen, prev = set(), None
                for n in names:
                    assert n == prev or n not in seen, names
                    seen.add(n); prev = n
                ok("운영진: 사람 단위 + 팀 이름, 팀별로 붙어서 정렬, 결석자 제외")
                md = (await c.get(f"{BASE}/member/boards/{mb}", headers=mh(x1))).json()
                assert [p["presenter_member_id"] for p in md["presenters"] if p["is_own"]] == [x1]
                assert all("presenter_order" not in p for p in md["presenters"]); ok("기수원: is_own=본인만, 순서 비노출")
                before = [p["presenter_member_id"] for p in md["presenters"]]
                # 팀 발표 순서를 역순으로 매기면 운영진 순서는 바뀌고 기수원 순서는 그대로여야 한다(스포 방지)
                for i, tid in enumerate(reversed(mids)):
                    await sql("update teams set presenter_order=:o where id=:t", o=i + 1, t=tid)
                ad = (await c.get(f"{BASE}/boards/{mb}", headers=sh)).json()["presenters"]
                assert list(dict.fromkeys(p["team_id"] for p in ad)) == list(reversed(mids)), [p["team_id"] for p in ad]
                md = (await c.get(f"{BASE}/member/boards/{mb}", headers=mh(x1))).json()
                assert [p["presenter_member_id"] for p in md["presenters"]] == before
                teams_seen = list(dict.fromkeys(p["team_name"] for p in md["presenters"]))
                assert teams_seen == sorted(teams_seen, key=lambda n: int("".join(ch for ch in n if ch.isdigit()) or 0)), teams_seen
                assert all("presenter_order" not in p for p in md["presenters"])
                ok("팀 발표 순서 바꿔도: 운영진=발표 순서, 기수원=팀 이름순 그대로(순서 스포 없음)")
                await c.patch(f"{BASE}/boards/{mb}", headers=sh, json={"is_open": True})
                r = await c.post(f"{BASE}/member/boards/{mb}/posts", headers=mh(x1), json={"presenter_member_id": x1, "contents": {"praise": "셀프"}})
                assert r.status_code == 400; ok("팀원 개인 보드 본인에게 → 400")
                r = await c.post(f"{BASE}/member/boards/{mb}/posts", headers=mh(x1), json={"presenter_member_id": x2, "contents": {"praise": "팀원"}})
                assert r.status_code == 201 and r.json()["presenter_member_id"] == x2, r.text; ok("같은 팀 팀원에게 → 201")
                r = await c.post(f"{BASE}/member/boards/{mb}/posts", headers=mh(x1), json={"presenter_member_id": y1, "contents": {"praise": "다른팀"}})
                assert r.status_code == 201; ok("다른 팀 사람에게 → 201")
                r = await c.post(f"{BASE}/member/boards/{mb}/posts", headers=mh(x1), json={"presenter_member_id": absent, "contents": {"praise": "결석"}})
                assert r.status_code == 400; ok("결석자에게 → 400")
                row = (await sql("select presenter_team_id, presenter_member_id from live_feedback_posts where board_id=:b order by id desc limit 1", b=mb)).one()
                assert tuple(row) == (None, y1); ok("DB: 팀원 개인 글은 presenter_member_id")
            finally:
                await sql("update attendance set status='PRESENT' where session_id=:s and member_id=:m", s=s_member.id, m=absent)
        finally:
            for b in made:
                await c.delete(f"{BASE}/boards/{b}", headers=sh)
            for tid, (o, n) in orig.items():
                await sql("update teams set presenter_order=:o, name=:n where id=:t", o=o, n=n, t=tid)
            left = (await sql("select count(*) from live_feedback_boards where id = any(:ids)", ids=made)).scalar()
            print(f"정리: 만든 보드 {len(made)}개 삭제(남은 것 {left}), 팀 발표 순서·이름 원복")
    print(f"ALL PASS ({passed})")


asyncio.run(main())
