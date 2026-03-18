"""
DB 초기화 + 실제 멤버 데이터 삽입 (33기)
멤버 + GenerationAccount + 초기 평가 테스트 데이터 생성

실행:
  docker compose exec backend python3 scripts/seed.py
"""
import asyncio
import os
import random
import sys
from datetime import datetime, timezone

import bcrypt

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text
from app.database import AsyncSessionLocal
from app.models import (
    Member, GenerationAccount,
    EvalRound, EvalAssignment, EvalResponse,
)
from app.constants.eval_questions import EVAL_QUESTIONS


QUESTION_KEYS = [q["key"] for q in EVAL_QUESTIONS]


async def truncate_all(db) -> None:
    print("  [1/4] 테이블 초기화 중...")
    tables = [
        "eval_responses", "eval_assignments", "eval_rounds",
        "generation_accounts", "cafe_posts", "treasury_expenses",
        "ledger", "team_history", "assignments", "attendance",
        "team_members", "teams", "sessions", "members", "naver_sessions",
    ]
    for t in tables:
        await db.execute(text(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE"))
    await db.commit()
    print("       완료")


async def create_members(db) -> list[Member]:
    print("  [2/4] 멤버 생성 중 (33기, 31명)...")

    names = [
        "강근엽", "강슬아", "권도윤", "김다은", "김대원",
        "김도현", "김민재", "김지훈", "김태영2", "나혜나",
        "도민희", "모다혜", "신미소", "신혜정", "원동선",
        "우인수", "유영채", "이경준", "이서정", "이수인",
        "이혜린", "장다은", "장한비", "정소현", "정유진",
        "정윤지", "정채원", "조해윤", "허진성", "홍유림",
        "황서정",
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


async def create_generation_accounts(db, members: list[Member]) -> None:
    print("  [3/4] GenerationAccount 생성 중...")
    password_hash = bcrypt.hashpw("univpt33".encode(), bcrypt.gensalt()).decode()

    for m in members:
        acct = GenerationAccount(
            member_id=m.id,
            username=m.name,
            password_hash=password_hash,
        )
        db.add(acct)

    await db.commit()
    print(f"       {len(members)}개 계정 생성 완료")


async def create_initial_eval_data(db, members: list[Member]) -> None:
    print("  [4/4] 초기 평가 테스트 데이터 생성 중...")
    now = datetime.now(timezone.utc)

    # EvalRound
    eval_round = EvalRound(
        session_id=None,
        round_type="INITIAL",
        title="33기 초기 평가",
        is_open=False,
        results_open=True,
    )
    db.add(eval_round)
    await db.flush()  # get eval_round.id

    assignment_count = 0
    response_count = 0

    for m in members:
        for eval_type in ("SELF", "AUDIENCE"):
            assignment = EvalAssignment(
                round_id=eval_round.id,
                evaluator_user_id=None,
                presenter_member_id=m.id,
                eval_type=eval_type,
                submitted_at=now,
            )
            db.add(assignment)
            await db.flush()  # get assignment.id
            assignment_count += 1

            for key in QUESTION_KEYS:
                resp = EvalResponse(
                    assignment_id=assignment.id,
                    question_key=key,
                    score=random.randint(1, 5),
                )
                db.add(resp)
                response_count += 1

    await db.commit()
    print(f"       라운드 1개, 배정 {assignment_count}개, 응답 {response_count}개 생성 완료")


async def main():
    print("=" * 50)
    print("  DB 초기화 및 33기 멤버 시드 데이터 삽입")
    print("=" * 50)

    async with AsyncSessionLocal() as db:
        await truncate_all(db)
        members = await create_members(db)
        await create_generation_accounts(db, members)
        await create_initial_eval_data(db, members)

    print()
    print("완료!")
    print(f"  멤버: {len(members)}명")
    print(f"  로그인: 멤버 이름 + 비밀번호 'univpt33'")
    print("  세션은 UI에서 직접 생성하세요.")


if __name__ == "__main__":
    asyncio.run(main())
