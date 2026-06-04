"""후기 발표 성장 리포트 데모 준비 (로컬 전용).

- 기존 실제 라운드(후기 → 초기)를 연결해, 기존 기수 전원이 초기↔후기 비교 리포트로 보이게 한다.
- 데모용으로 '김유피' 멤버 1명만 추가(로그인 아이디도 '김유피'), 점수는 랜덤.
- 로컬 DB의 모든 멤버+운영진 비밀번호를 univpt33으로 통일.
- 과거에 만들었던 다른 가짜 데모 멤버/라운드는 정리한다.

!!! 로컬 전용 !!! deploy/운영 DB에서 절대 실행 금지.
실행:
  docker exec -e ALLOW_DEMO_SEED=1 -e PYTHONPATH=/app -w /app ops-platform-backend-1 \
      python scripts/seed_demo_final_report.py
환경변수(선택): INITIAL_ROUND_ID(기본 1), FINAL_ROUND_ID(기본 7)
"""
import asyncio
import os
import random
from datetime import datetime, timezone

import bcrypt
from sqlalchemy import delete, select, text

from app.database import AsyncSessionLocal
from app.constants.eval_questions import EVAL_QUESTIONS
from app.models import (
    EvalAssignment,
    EvalResponse,
    EvalRound,
    GenerationAccount,
    Member,
    User,
)

if os.getenv("ALLOW_DEMO_SEED") != "1":
    raise SystemExit("거부됨: 로컬 전용 스크립트입니다. ALLOW_DEMO_SEED=1 로 실행하세요. (deploy 금지)")

PASSWORD = "univpt33"
KIMUPI_NAME = "김유피"
KIMUPI_USERNAME = "김유피"
INITIAL_ROUND_ID = int(os.getenv("INITIAL_ROUND_ID", "1"))
FINAL_ROUND_ID = int(os.getenv("FINAL_ROUND_ID", "7"))
# 과거에 만들었던 가짜 데모 계정(김유피 제외) — 정리 대상
OLD_DEMO_USERNAMES = ["jang", "leeha", "kimth", "kimyh", "kimupi"]


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def rand_scores() -> dict[str, int]:
    """문항별 랜덤 점수(2~5) 딕셔너리."""
    return {q["key"]: random.randint(2, 5) for q in EVAL_QUESTIONS}


async def add_responses(db, round_id, member_id, eval_type, evaluator_user_id, scores, reflection=None):
    a = EvalAssignment(
        round_id=round_id,
        evaluator_user_id=evaluator_user_id,
        presenter_member_id=member_id,
        eval_type=eval_type,
        submitted_at=datetime.now(timezone.utc),
        growth_reflection=reflection,
    )
    db.add(a)
    await db.flush()
    for q in EVAL_QUESTIONS:
        db.add(EvalResponse(assignment_id=a.id, question_key=q["key"], score=scores[q["key"]]))


async def main():
    async with AsyncSessionLocal() as db:
        pw_hash = hash_pw(PASSWORD)

        # 0) 과거 가짜 데모 라운드 정리 ([데모] 타이틀)
        demo_round_ids = (await db.execute(
            select(EvalRound.id).where(EvalRound.title.like("[데모]%"))
        )).scalars().all()
        if demo_round_ids:
            aids = (await db.execute(
                select(EvalAssignment.id).where(EvalAssignment.round_id.in_(demo_round_ids))
            )).scalars().all()
            if aids:
                await db.execute(delete(EvalResponse).where(EvalResponse.assignment_id.in_(aids)))
                await db.execute(delete(EvalAssignment).where(EvalAssignment.id.in_(aids)))
            await db.execute(delete(EvalRound).where(EvalRound.id.in_(demo_round_ids)))

        # 0-1) 과거 가짜 데모 멤버(김유피 제외) 정리
        old_accts = (await db.execute(
            select(GenerationAccount).where(GenerationAccount.username.in_(["jang", "leeha", "kimth", "kimyh"]))
        )).scalars().all()
        for acct in old_accts:
            m = await db.get(Member, acct.member_id)
            if m is not None:
                # 멤버 삭제(generation_accounts는 ondelete CASCADE)
                await db.execute(delete(Member).where(Member.id == m.id))
        # demo_eval 평가자 계정 제거
        await db.execute(delete(User).where(User.username == "demo_eval"))

        # 1) 라운드 확인 + 연결 (후기 → 초기)
        initial = await db.get(EvalRound, INITIAL_ROUND_ID)
        final = await db.get(EvalRound, FINAL_ROUND_ID)
        if initial is None or final is None:
            raise SystemExit(f"라운드 없음: initial={INITIAL_ROUND_ID} final={FINAL_ROUND_ID}")
        final.compare_to_round_id = initial.id
        final.results_open = True  # 데모 확인용

        # 2) 평가자(청중) — 기존 admin 유저 재사용
        evaluator = (await db.execute(select(User).where(User.username == "admin"))).scalar_one_or_none()
        if evaluator is None:
            evaluator = (await db.execute(select(User).limit(1))).scalar_one()

        # 3) 김유피 멤버 + 계정 (아이디도 '김유피')
        acct = (await db.execute(
            select(GenerationAccount).where(GenerationAccount.username == KIMUPI_USERNAME)
        )).scalar_one_or_none()
        if acct is None:
            # 과거 'kimupi' 계정이 있으면 그 멤버 재사용 후 아이디만 교체
            legacy = (await db.execute(
                select(GenerationAccount).where(GenerationAccount.username == "kimupi")
            )).scalar_one_or_none()
            if legacy is not None:
                legacy.username = KIMUPI_USERNAME
                acct = legacy
                member = await db.get(Member, acct.member_id)
            else:
                member = Member(name=KIMUPI_NAME, tags=["demo"], is_active=True)
                db.add(member)
                await db.flush()
                acct = GenerationAccount(
                    member_id=member.id, username=KIMUPI_USERNAME,
                    password_hash=pw_hash, is_active=True,
                )
                db.add(acct)
        else:
            member = await db.get(Member, acct.member_id)
        acct.password_hash = pw_hash
        await db.flush()

        # 4) 김유피 기존 응답 정리 후, 초기/후기 랜덤 점수로 재생성
        for rid in (initial.id, final.id):
            aids = (await db.execute(
                select(EvalAssignment.id).where(
                    EvalAssignment.round_id == rid,
                    EvalAssignment.presenter_member_id == member.id,
                )
            )).scalars().all()
            if aids:
                await db.execute(delete(EvalResponse).where(EvalResponse.assignment_id.in_(aids)))
                await db.execute(delete(EvalAssignment).where(EvalAssignment.id.in_(aids)))

        await add_responses(db, initial.id, member.id, "SELF", None, rand_scores())
        await add_responses(db, initial.id, member.id, "AUDIENCE", evaluator.id, rand_scores())
        await add_responses(db, final.id, member.id, "SELF", None, rand_scores(),
                            reflection="유니브피티 6번의 발표를 거치며, 무대 위에서 청중과 호흡하는 여유가 생긴 게 가장 큰 성장입니다. 준비 과정의 고민들이 결국 저를 단단하게 만들었어요.")
        await add_responses(db, final.id, member.id, "AUDIENCE", evaluator.id, rand_scores())

        # 5) 로컬 DB 전체 비번 통일 (멤버 + 운영진)
        await db.execute(text("UPDATE users SET password_hash = :h"), {"h": pw_hash})
        await db.execute(text("UPDATE generation_accounts SET password_hash = :h"), {"h": pw_hash})

        await db.commit()

        print(f"[OK] 후기 라운드 {final.id} → 초기 {initial.id} 연결 (results_open=True)")
        print(f"[OK] 김유피 멤버 id={member.id}, 로그인 아이디='{KIMUPI_USERNAME}' (랜덤 점수)")
        print(f"[OK] 비밀번호 통일 → '{PASSWORD}' (모든 users + generation_accounts)")
        print("    기존 기수 전원은 후기 라운드 결과에서 초기↔후기 비교로 표시됩니다.")


if __name__ == "__main__":
    asyncio.run(main())
