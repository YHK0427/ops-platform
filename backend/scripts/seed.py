"""
DB 초기화 + 실제 멤버 데이터 삽입 (32기)
멤버만 생성 — 세션은 UI로 직접 생성

실행:
  docker compose exec backend python3 scripts/seed.py
"""
import asyncio
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text
from app.database import AsyncSessionLocal
from app.models import Member


async def truncate_all(db) -> None:
    print("  [1/2] 테이블 초기화 중...")
    tables = [
        "ledger", "team_history", "assignments", "attendance",
        "team_members", "teams", "sessions", "members", "naver_sessions",
    ]
    for t in tables:
        await db.execute(text(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE"))
    await db.commit()
    print("       완료")


async def create_members(db) -> list[Member]:
    print("  [2/2] 멤버 생성 중 (32기, 23명)...")

    names = [
        "강명서", "권기준", "김민지", "김수아", "김영헌",
        "김유은", "김자현", "김태건", "김태형", "노민영",
        "민시윤", "박유정", "우명주", "윤지은", "이준구",
        "장국진", "장영진", "장유빈", "전윤서", "조윤서",
        "한가은", "호재영", "황재무",
    ]

    members = []
    for name in names:
        m = Member(
            name=name,
            email=None,
            tags=[],
            is_active=True,
            current_deposit=20_000,
            total_plus_score=0,
            total_minus_score=0,
            net_score=0,
        )
        db.add(m)
        members.append(m)

    await db.commit()
    print(f"       {len(members)}명 생성 완료")
    return members


async def main():
    print("=" * 50)
    print("  DB 초기화 및 32기 멤버 시드 데이터 삽입")
    print("=" * 50)

    async with AsyncSessionLocal() as db:
        await truncate_all(db)
        members = await create_members(db)

    print()
    print("완료!")
    print(f"  멤버: {len(members)}명")
    print("  세션은 UI에서 직접 생성하세요.")


if __name__ == "__main__":
    asyncio.run(main())
