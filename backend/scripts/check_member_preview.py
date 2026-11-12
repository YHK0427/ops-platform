"""'기수 화면 보기'(운영진이 기수원 포털을 읽기 전용으로 보기) self-check — 떠 있는 backend 에 실제 HTTP (dev DB).
쓰기가 막히는지, 조회만 해도 남는 기록(공지 읽음·조회수·패치노트 확인)이 안 남는지, 접속 기록에 미리보기로 찍히는지.
끝에 이번 검사로 생긴 그 기수원의 접속 기록 줄을 지운다.

    MSYS_NO_PATHCONV=1 docker exec -e PYTHONPATH=/app -w /app opsbundle-backend-1 python scripts/check_member_preview.py
"""
import asyncio
from datetime import datetime, timedelta, timezone

import httpx
from jose import jwt
from sqlalchemy import select, text

import app.logging_config  # noqa: F401 — logger.audit
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import Announcement, GenerationAccount, Member, User

API = "http://localhost:8000/api/v1"
passed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  PASS {name}")


def staff_token(u: User):
    return jwt.encode({"sub": u.username, "uid": u.id, "role": u.role, "cohort_id": u.cohort_id,
                       "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                      settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def scalar(q, **kw):
    async with AsyncSessionLocal() as db:
        return (await db.execute(text(q), kw)).scalar()


async def main():
    async with AsyncSessionLocal() as db:
        cid = 1
        manager = (await db.execute(select(User).where(User.cohort_id == cid, User.role == "manager"))).scalars().first()
        viewer = (await db.execute(select(User).where(User.cohort_id == cid, User.role == "viewer"))).scalars().first()
        m, acc = (await db.execute(
            select(Member, GenerationAccount).join(GenerationAccount, GenerationAccount.member_id == Member.id)
            .where(Member.cohort_id == cid, Member.is_active == True, GenerationAccount.is_active == True)  # noqa: E712
            .order_by(Member.id)
        )).first()
        other = (await db.execute(select(Member).where(Member.cohort_id != cid))).scalars().first()
        ann = (await db.execute(select(Announcement).where(
            Announcement.cohort_id == cid, Announcement.target.in_(("members", "all"))).order_by(Announcement.id.desc()))).scalars().first()
    H = lambda t: {"Authorization": f"Bearer {t}"}  # noqa: E731
    started = datetime.now(timezone.utc)

    async with httpx.AsyncClient(base_url=API, timeout=20) as c:
        # ── 발급: admin·manager 만, 같은 기수만
        r = await c.post(f"/members/{m.id}/preview-token", headers=H(staff_token(manager)))
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        claims = jwt.get_unverified_claims(tok)
        assert claims["preview_by"] == manager.username and claims["member_id"] == m.id and claims["account_type"] == "generation"
        left = claims["exp"] - datetime.now(timezone.utc).timestamp()
        assert 29 * 60 < left <= 30 * 60 + 5, left
        ok(f"manager 발급 → 30분짜리 읽기 전용 토큰 ({m.name}, preview_by={manager.username})")
        if viewer:
            r = await c.post(f"/members/{m.id}/preview-token", headers=H(staff_token(viewer)))
            assert r.status_code == 403, r.text
        if other:
            r = await c.post(f"/members/{other.id}/preview-token", headers=H(staff_token(manager)))
            assert r.status_code == 404, r.text
        ok("viewer 는 403, 다른 기수 멤버는 404")

        # ── 보기는 그대로
        for path in ("/auth/member-me", "/members/my-summary", "/members/my-ledger", "/members/my-attendance"):
            r = await c.get(path, headers=H(tok))
            assert r.status_code == 200, (path, r.status_code, r.text[:200])
        assert (await c.get("/auth/member-me", headers=H(tok))).json()["member_id"] == m.id
        ok("기수 화면 조회(me·요약·장부·출결)는 그 기수원 것으로 200")

        # ── 쓰기는 전부 403 (본문 검사 전에 막힌다)
        for method, path, body in (
            ("POST", "/notifications/subscribe", {"endpoint": "x", "keys": {"p256dh": "x", "auth": "x"}}),
            ("POST", "/auth/member-logout", None),
            ("POST", "/auth/member-change-password", {"current_password": "x", "new_password": "y"}),
            ("DELETE", "/portal/excuses/0", None),
        ):
            r = await c.request(method, path, headers=H(tok), json=body)
            assert r.status_code == 403 and "읽기 전용" in r.text, (method, path, r.status_code, r.text[:200])
        ok("쓰기(푸시 구독·로그아웃·비밀번호·삭제)는 403 '읽기 전용'")

        # ── 조회만 해도 남는 기록이 안 남는다
        if ann:
            reads0 = await scalar("select count(*) from announcement_reads where announcement_id=:a and member_id=:m", a=ann.id, m=m.id)
            last0 = await scalar("select last_read_at from announcement_reads where announcement_id=:a and member_id=:m", a=ann.id, m=m.id)
            views0 = await scalar("select view_count from announcements where id=:a", a=ann.id)
            r = await c.get(f"/notifications/announcements/{ann.id}", headers=H(tok))
            assert r.status_code == 200, r.text[:200]
            assert await scalar("select count(*) from announcement_reads where announcement_id=:a and member_id=:m", a=ann.id, m=m.id) == reads0
            assert await scalar("select last_read_at from announcement_reads where announcement_id=:a and member_id=:m", a=ann.id, m=m.id) == last0
            assert await scalar("select view_count from announcements where id=:a", a=ann.id) == views0
            ok(f"공지 상세를 열어도 읽음·조회수 그대로 (공지 {ann.id}, 조회수 {views0})")
        seen0 = await scalar("select patch_seen_at from generation_accounts where member_id=:m", m=m.id)
        assert (await c.get("/patch-notes/member/unseen", headers=H(tok))).status_code == 200
        assert await scalar("select patch_seen_at from generation_accounts where member_id=:m", m=m.id) == seen0
        ok("패치노트 확인 시각도 그대로")

        # ── 진짜 기수 토큰은 영향 없음 (같은 계정)
        real = jwt.encode({"sub": acc.username, "member_id": m.id, "account_type": "generation", "cohort_id": cid,
                           "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
        r = await c.post("/auth/member-change-password", headers=H(real), json={"current_password": "틀린비번", "new_password": "y" * 8})
        assert r.status_code != 403, r.text  # 비번이 틀려 실패할 뿐, 미리보기 차단은 아님
        ok(f"진짜 기수원 토큰은 쓰기 막힘 없음 (비번 틀림 → {r.status_code})")

        # ── 연 운영진이 비활성되면 남은 시간이 있어도 끊긴다
        async with AsyncSessionLocal() as db:
            await db.execute(text("update users set is_active=false where id=:u"), {"u": manager.id})
            await db.commit()
        try:
            r = await c.get("/auth/member-me", headers=H(tok))
            assert r.status_code == 401, r.status_code
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(text("update users set is_active=true where id=:u"), {"u": manager.id})
                await db.commit()
        assert (await c.get("/auth/member-me", headers=H(tok))).status_code == 200
        ok("연 운영진을 비활성하면 미리보기 즉시 401, 되살리면 다시 200")

    # ── 접속 기록: 그 기수원이 들어온 걸로 안 보이게
    await asyncio.sleep(1.5)
    labels = (await scalar(
        "select string_agg(distinct actor_kind || ':' || actor_label, ' | ') from access_logs "
        "where actor_username=:u and cohort_id=:c and last_seen_at >= :t", u=acc.username, c=cid, t=started))
    assert labels and f"preview:{acc.username}(미리보기: {manager.username})" in labels, labels
    assert "member:" in labels  # 진짜 토큰 요청은 따로 member 로
    ok(f"접속 기록: 미리보기는 preview 로 따로, 본인 접속과 안 섞임 ({labels})")

    async with AsyncSessionLocal() as db:
        n = (await db.execute(text("delete from access_logs where actor_username=:u and cohort_id=:c and last_seen_at >= :t"),
                              {"u": acc.username, "c": cid, "t": started})).rowcount
        await db.commit()
    print(f"정리: 이번 검사로 생긴 접속 기록 {n}줄 삭제")
    print(f"ALL PASS ({passed})")


asyncio.run(main())
