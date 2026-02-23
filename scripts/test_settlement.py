
import asyncio
import json
import httpx
from sqlalchemy import text
from app.database import AsyncSessionLocal
from app.models import Member, Session

BASE_URL = "http://localhost:8000/api/v1"

async def get_admin_token():
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/auth/login",
            json={"username": "admin", "password": "dbvl33rl"}
        )
        try:
            return resp.json()["access_token"]
        except Exception:
            print(f"Login failed: {resp.text}")
            raise

async def setup_test_data():
    """테스트 데이터 설정 (DB 직접 조작)"""
    async with AsyncSessionLocal() as db:
        # 멤버 조회 또는 생성 (role 제거)
        res = await db.execute(text("SELECT id FROM members ORDER BY id LIMIT 2"))
        member_ids = [r[0] for r in res.fetchall()]
        
        if len(member_ids) < 2:
            print("Creating dummy members...")
            for i in range(2 - len(member_ids)):
                await db.execute(text(f"INSERT INTO members (name, is_active, total_plus_score, total_minus_score, current_deposit) VALUES ('TestUser{10+i}', true, 0, 0, 100000)"))
            await db.commit()
            res = await db.execute(text("SELECT id FROM members ORDER BY id DESC LIMIT 2"))
            member_ids = [r[0] for r in res.fetchall()]
            member_ids.sort()

        id1, id2 = member_ids[0], member_ids[1]
        print(f"Using Member IDs: {id1}, {id2}")

        # 멤버 초기화
        await db.execute(text(f"UPDATE members SET total_plus_score=0, total_minus_score=0, current_deposit=100000 WHERE id IN ({id1}, {id2})"))
        
        # 세션 초기화 (ID 1 없으면 생성)
        res = await db.execute(text("SELECT id FROM sessions WHERE id=1"))
        if not res.scalar():
             await db.execute(text("INSERT INTO sessions (id, week_num, title, date, type, status, config) VALUES (1, 1, 'Test Session', '2024-01-01', 'INDIVIDUAL', 'SETTLEMENT', '{{\"has_ppt\": true, \"has_review\": true, \"has_feedback\": true}}')"))
        else:
             await db.execute(text("UPDATE sessions SET status='SETTLEMENT' WHERE id=1"))

        # 기존 데이터 삭제
        await db.execute(text("DELETE FROM attendance WHERE session_id=1"))
        await db.execute(text("DELETE FROM assignments WHERE session_id=1"))
        await db.execute(text("DELETE FROM ledger WHERE session_id=1"))
        await db.execute(text("DELETE FROM team_history WHERE session_id=1"))
        
        # 1. Attendance
        # ID 1: LATE_UNDER10 + PRE (-1, -2000)
        await db.execute(text(
            f"INSERT INTO attendance (session_id, member_id, status, excuse_type) VALUES (1, {id1}, 'LATE_UNDER10', 'PRE')"
        ))
        # ID 2: ABSENT + None (-4, -8000)
        await db.execute(text(
            f"INSERT INTO attendance (session_id, member_id, status, excuse_type) VALUES (1, {id2}, 'ABSENT', NULL)"
        ))

        # 2. Assignments
        # PPT: ID 2 = MISSING (-2, -3000) - PPT Assignment가 존재하면 페널티 적용됨
        await db.execute(text(
            f"INSERT INTO assignments (session_id, member_id, type, status) VALUES (1, {id2}, 'PPT', 'MISSING')"
        ))
        # REVIEW: ID 2 = MISSING (통합 -1, -1000)
        await db.execute(text(
            f"INSERT INTO assignments (session_id, member_id, type, status) VALUES (1, {id2}, 'REVIEW', 'MISSING')"
        ))
        
        await db.commit()
        return id1, id2

async def test_settlement():
    token = await get_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    
    # Setup Data
    id1, id2 = await setup_test_data()
    
    print("=== 1. Settlement Preview ===")
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BASE_URL}/sessions/1/settlement-preview", headers=headers)
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(json.dumps(data, indent=2, ensure_ascii=False))
        
        # 검증 로직
        penalties = data['penalties']
        p1 = [p for p in penalties if p['member_id'] == id1]
        p2 = [p for p in penalties if p['member_id'] == id2]
        
        total_score_1 = sum(p['score_delta'] for p in p1)
        total_deposit_1 = sum(p['deposit_delta'] for p in p1)
        
        total_score_2 = sum(p['score_delta'] for p in p2)
        total_deposit_2 = sum(p['deposit_delta'] for p in p2)
        
        print(f"Member {id1}: Score {total_score_1}, Deposit {total_deposit_1}")  # Expected: -1, -2000
        print(f"Member {id2}: Score {total_score_2}, Deposit {total_deposit_2}")  # Expected: -7, -12000 (-4 for Absent, -2 for PPT, -1 for Review)
        
    print("\n=== 2. Finalize ===")
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{BASE_URL}/sessions/1/finalize", headers=headers, json={"overrides": []})
        print(f"Status: {resp.status_code}")
        print(resp.json())

    print("\n=== 3. DB Verification ===")
    async with AsyncSessionLocal() as db:
        m1 = await db.get(Member, id1)
        m2 = await db.get(Member, id2)
        print(f"Member {id1} Result: Score={m1.total_minus_score}, Deposit={m1.current_deposit}")
        print(f"Member {id2} Result: Score={m2.total_minus_score}, Deposit={m2.current_deposit}")
        
        # Ledger 확인
        res = await db.execute(text(f"SELECT type, amount_krw, description FROM ledger WHERE session_id=1 AND member_id={id2} ORDER BY id"))
        rows = res.fetchall()
        print(f"Member {id2} Ledgers:")
        for r in rows:
            print(r)

    print("\n=== 4. Duplicate Finalize Check (Expect 400) ===")
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{BASE_URL}/sessions/1/finalize", headers=headers, json={"overrides": []})
        print(f"Status: {resp.status_code}")
        print(resp.json())

if __name__ == "__main__":
    asyncio.run(test_settlement())
