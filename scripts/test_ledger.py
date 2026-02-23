
import asyncio
import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.config import settings
from app.models import Member, Session, Attendance, Ledger
from datetime import date, timedelta

# DB 설정
engine = create_async_engine(settings.DATABASE_URL)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

BASE_URL = "http://localhost:8000/api/v1"

async def test_ledger_flow():
    # 0. Admin Login
    async with httpx.AsyncClient() as client:
        # Login
        login_res = await client.post(
            f"{BASE_URL}/auth/login",
            json={"username": "admin", "password": "dbvl33rl"},
            headers={"Content-Type": "application/json"}
        )
        token = login_res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
    print("=== Admin Logged In ===")

    async with AsyncSessionLocal() as db:
        # 1. Setup Data
        # Member 1 (Target)
        target_mem = await db.get(Member, 1)
        if not target_mem:
            target_mem = Member(name="LedgerTester", email="test@example.com")
            db.add(target_mem)
            await db.commit()
            await db.refresh(target_mem)
        
        target_id = target_mem.id
        initial_deposit = target_mem.current_deposit
        initial_score = target_mem.total_plus_score
        print(f"Target Member: {target_mem.name} (ID: {target_id}, Deposit: {initial_deposit}, Score: {initial_score})")

    async with httpx.AsyncClient() as client:
        # 2. Transaction (Recharge 10000)
        print("\n=== 2. Transaction (Recharge 10000) ===")
        res = await client.post(
            f"{BASE_URL}/ledger/transaction",
            headers=headers,
            json={
                "member_id": target_id,
                "type": "DEPOSIT_RECHARGE",
                "amount_krw": 10000,
                "description": "Test Recharge"
            }
        )
        print(f"Status: {res.status_code}")
        print(res.json())
        assert res.status_code == 200
        assert res.json()["deposit_after"] == initial_deposit + 10000

        # 3. Merit (Give 2 points)
        print("\n=== 3. Merit (Give 2 points) ===")
        res = await client.post(
            f"{BASE_URL}/ledger/merit",
            headers=headers,
            json={
                "member_ids": [target_id],
                "reason": "Good Job",
                "score_delta": 2
            }
        )
        print(f"Status: {res.status_code}")
        print(res.json())
        assert res.status_code == 200
        assert res.json()[0]["score_delta"] == 2
        assert res.json()[0]["deposit_after"] == initial_deposit + 10000 # 변동 없음

        # 4. Verify Member State
        print("\n=== 4. Verify Member State ===")
        res = await client.get(f"{BASE_URL}/members/{target_id}", headers=headers)
        mem = res.json()
        print(f"Deposit: {mem['current_deposit']} (Exp: {initial_deposit + 10000})")
        print(f"Plus Score: {mem['total_plus_score']} (Exp: {initial_score + 2})")
        assert mem['current_deposit'] == initial_deposit + 10000
        assert mem['total_plus_score'] == initial_score + 2

        # 5. Streak Checker Test
        print("\n=== 5. Streak Checker Setup & Test ===")
        async with AsyncSessionLocal() as db:
            # Create 4 FINALIZED sessions
            session_ids = []
            today = date.today()
            for i in range(4):
                week = 200 + i
                stmt = select(Session).where(Session.week_num == week)
                res = await db.execute(stmt)
                s = res.scalar_one_or_none()
                
                if not s:
                    s = Session(
                        week_num=week,
                        title=f"Streak Sess {i}",
                        date=today - timedelta(weeks=i),
                        type="INDIVIDUAL",
                        status="FINALIZED"
                    )
                    db.add(s)
                    await db.flush()
                else:
                    # 상태 강제 업데이트 (테스트용)
                    s.status = "FINALIZED"
                    s.date = today - timedelta(weeks=i)
                    await db.flush()
                    
                session_ids.append(s.id)
                
                # Check if attendance exists
                # 만약 이미 있다면 update, 없으면 insert
                # 여기선 테스트용으로 그냥 추가 (UniqueConstraint 조심)
                # upsert 로직이 복잡하므로, execute로 처리
                try:
                    att = Attendance(session_id=s.id, member_id=target_id, status="PRESENT")
                    db.add(att)
                    await db.flush()
                except Exception:
                    await db.rollback() 
                    # 이미 있으면 pass (PRESENT로 가정)

            await db.commit()
            print(f"Created 4 Finalized Sessions: {session_ids}")

        # Call API
        res = await client.get(f"{BASE_URL}/members/streak-candidates", headers=headers)
        print(f"Status: {res.status_code}")
        candidates = res.json()
        print(f"Candidates: {[c['name'] for c in candidates]}")
        
        # Check if target is in candidates
        found = any(c['id'] == target_id for c in candidates)
        if found:
            print("[PASS] Target member found in streak candidates")
        else:
            print("[FAIL] Target member NOT found")

if __name__ == "__main__":
    asyncio.run(test_ledger_flow())
