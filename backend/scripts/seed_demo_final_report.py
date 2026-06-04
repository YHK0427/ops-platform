"""후기 발표 성장 리포트 데모 시드 (로컬 전용).

가상 멤버(김유피 + 운영진 이름)와 초기/후기 라운드·응답을 생성해
초기↔후기 비교 리포트를 실제 플랫폼에서 로그인해 확인할 수 있게 한다.
또한 로컬 DB의 모든 멤버+운영진 비밀번호를 univpt33으로 통일한다.

!!! 로컬 전용 !!! deploy/운영 DB에서 절대 실행 금지.
실행:  docker exec -e ALLOW_DEMO_SEED=1 ops-platform-backend-1 python scripts/seed_demo_final_report.py
"""
import asyncio
import os

import bcrypt
from sqlalchemy import delete, select

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

# ── 안전 가드 ──────────────────────────────────────────────────────────────
if os.getenv("ALLOW_DEMO_SEED") != "1":
    raise SystemExit(
        "거부됨: 로컬 전용 스크립트입니다. ALLOW_DEMO_SEED=1 로 실행하세요. (deploy 금지)"
    )

PASSWORD = "univpt33"
INITIAL_TITLE = "[데모] 초기 평가"
FINAL_TITLE = "[데모] 후기 평가"

# 도메인별 (SELF, AUDIENCE) 점수. 모든 도메인의 3문항에 동일 점수 적용.
# 키: 도메인. 값: 점수(1~5).
# 멤버별 초기/후기 설계 — 전환 유형 + 단계/유형 다양화
DEMO = [
    {
        "username": "kimupi", "name": "김유피",
        # 성장형(A→B) + 균형형→강점집중형(SPEECH 강점, SPEECH 최대 성장 👑)
        "initial": {"self": {"PLANNING": 3, "DESIGN": 3, "SPEECH": 3},
                    "aud":  {"PLANNING": 4, "DESIGN": 4, "SPEECH": 4}},
        "final":   {"self": {"PLANNING": 4, "DESIGN": 4, "SPEECH": 5},
                    "aud":  {"PLANNING": 4, "DESIGN": 4, "SPEECH": 5}},
        "reflection": "처음엔 슬라이드만 보고 읽기 바빴는데, 6번의 발표를 거치며 청중과 눈을 맞추고 호흡을 조절하는 게 자연스러워졌어요. 특히 스피치에서 제 강점을 발견한 게 가장 큰 성장입니다.",
    },
    {
        "username": "jang", "name": "장영진",
        # 발전형(A→A): 두 라운드 모두 자기<청중, 균형형 유지하며 전반 성장
        "initial": {"self": {"PLANNING": 2, "DESIGN": 2, "SPEECH": 2},
                    "aud":  {"PLANNING": 3, "DESIGN": 3, "SPEECH": 3}},
        "final":   {"self": {"PLANNING": 3, "DESIGN": 3, "SPEECH": 3},
                    "aud":  {"PLANNING": 4, "DESIGN": 4, "SPEECH": 4}},
        "reflection": "스스로에게 엄격한 편이라 점수를 늘 낮게 줬지만, 매 발표마다 조금씩 나아지는 게 느껴졌습니다. 꾸준함이 가장 큰 무기라는 걸 배웠어요.",
    },
    {
        "username": "leeha", "name": "이현아",
        # 성찰형(C→B) + 균형형→보완점 명확형(SPEECH 보완)
        "initial": {"self": {"PLANNING": 4, "DESIGN": 4, "SPEECH": 4},
                    "aud":  {"PLANNING": 3, "DESIGN": 3, "SPEECH": 3}},
        "final":   {"self": {"PLANNING": 4, "DESIGN": 4, "SPEECH": 2},
                    "aud":  {"PLANNING": 4, "DESIGN": 4, "SPEECH": 2}},
        "reflection": "초반엔 자신감이 앞섰는데, 피드백을 받으며 제 발표를 더 객관적으로 보게 됐어요. 스피치는 아직 보완할 점이 보이지만 방향이 명확해져서 좋습니다.",
    },
    {
        "username": "kimth", "name": "김태형",
        # 추진형(C→C): 두 라운드 모두 자기>청중, 전반 성장
        "initial": {"self": {"PLANNING": 4, "DESIGN": 4, "SPEECH": 4},
                    "aud":  {"PLANNING": 3, "DESIGN": 3, "SPEECH": 3}},
        "final":   {"self": {"PLANNING": 5, "DESIGN": 5, "SPEECH": 5},
                    "aud":  {"PLANNING": 4, "DESIGN": 4, "SPEECH": 4}},
        "reflection": "무대에 서는 게 즐거웠습니다. 자신감 있게 밀어붙이는 게 제 스타일인데, 이제는 청중 반응도 같이 살피려고 합니다.",
    },
    {
        "username": "kimyh", "name": "김영헌",
        # 안정형(B→B): 자기≈청중 유지, 안정화→전달 최적화로 큰 폭 성장
        "initial": {"self": {"PLANNING": 2, "DESIGN": 2, "SPEECH": 2},
                    "aud":  {"PLANNING": 2, "DESIGN": 2, "SPEECH": 2}},
        "final":   {"self": {"PLANNING": 5, "DESIGN": 5, "SPEECH": 5},
                    "aud":  {"PLANNING": 5, "DESIGN": 5, "SPEECH": 5}},
        "reflection": "불편함을 찾아 고치는 과정의 반복이었어요. 처음엔 막막했지만 구조를 잡고 연습량을 쌓으니 전혀 다른 발표가 됐습니다. 가장 크게 성장한 건 '준비하는 습관'입니다.",
    },
]

DEMO_EVAL_USERNAME = "demo_eval"


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def domain_of(qkey: str) -> str:
    for q in EVAL_QUESTIONS:
        if q["key"] == qkey:
            return q["domain"]
    raise KeyError(qkey)


async def get_or_create_round(db, title, round_type, compare_to_round_id=None):
    r = (await db.execute(select(EvalRound).where(EvalRound.title == title))).scalar_one_or_none()
    if r is None:
        r = EvalRound(title=title, round_type=round_type, is_open=False, results_open=True)
        db.add(r)
        await db.flush()
    r.round_type = round_type
    r.is_open = False
    r.results_open = True
    if compare_to_round_id is not None:
        r.compare_to_round_id = compare_to_round_id
    return r


async def make_responses(db, round_id, member_id, eval_type, evaluator_user_id, scores_by_domain, reflection=None):
    from datetime import datetime, timezone

    assignment = EvalAssignment(
        round_id=round_id,
        evaluator_user_id=evaluator_user_id,
        presenter_member_id=member_id,
        eval_type=eval_type,
        submitted_at=datetime.now(timezone.utc),
        growth_reflection=reflection,
    )
    db.add(assignment)
    await db.flush()
    for q in EVAL_QUESTIONS:
        db.add(EvalResponse(
            assignment_id=assignment.id,
            question_key=q["key"],
            score=scores_by_domain[q["domain"]],
        ))


async def main():
    async with AsyncSessionLocal() as db:
        pw_hash = hash_pw(PASSWORD)

        # 데모 평가자(운영진) 계정
        evaluator = (await db.execute(
            select(User).where(User.username == DEMO_EVAL_USERNAME)
        )).scalar_one_or_none()
        if evaluator is None:
            evaluator = User(
                username=DEMO_EVAL_USERNAME, password_hash=pw_hash,
                display_name="데모 평가자", role="viewer", is_active=True,
            )
            db.add(evaluator)
            await db.flush()

        # 데모 멤버 + 기수 계정
        members = {}
        for d in DEMO:
            acct = (await db.execute(
                select(GenerationAccount).where(GenerationAccount.username == d["username"])
            )).scalar_one_or_none()
            if acct is None:
                m = Member(name=d["name"], tags=["demo"], is_active=True)
                db.add(m)
                await db.flush()
                acct = GenerationAccount(
                    member_id=m.id, username=d["username"],
                    password_hash=pw_hash, is_active=True,
                )
                db.add(acct)
                await db.flush()
            else:
                m = await db.get(Member, acct.member_id)
            members[d["username"]] = m

        # 라운드 (초기 → 후기, compare_to 연결)
        initial = await get_or_create_round(db, INITIAL_TITLE, "INITIAL")
        await db.flush()
        final = await get_or_create_round(db, FINAL_TITLE, "FINAL", compare_to_round_id=initial.id)
        await db.flush()

        # 기존 데모 배정/응답 정리 (idempotent)
        for r in (initial, final):
            ids = (await db.execute(
                select(EvalAssignment.id).where(EvalAssignment.round_id == r.id)
            )).scalars().all()
            if ids:
                await db.execute(delete(EvalResponse).where(EvalResponse.assignment_id.in_(ids)))
                await db.execute(delete(EvalAssignment).where(EvalAssignment.id.in_(ids)))

        # 응답 생성
        for d in DEMO:
            m = members[d["username"]]
            await make_responses(db, initial.id, m.id, "SELF", None, d["initial"]["self"])
            await make_responses(db, initial.id, m.id, "AUDIENCE", evaluator.id, d["initial"]["aud"])
            await make_responses(db, final.id, m.id, "SELF", None, d["final"]["self"], reflection=d["reflection"])
            await make_responses(db, final.id, m.id, "AUDIENCE", evaluator.id, d["final"]["aud"])

        # 로컬 DB 전체 비번 통일 (멤버 + 운영진)
        all_users = (await db.execute(select(User))).scalars().all()
        for u in all_users:
            u.password_hash = pw_hash
        all_accts = (await db.execute(select(GenerationAccount))).scalars().all()
        for a in all_accts:
            a.password_hash = pw_hash

        await db.commit()

        print(f"[OK] 데모 멤버 {len(DEMO)}명 / 라운드 초기={initial.id} 후기={final.id}(compare→{initial.id})")
        print(f"[OK] 비밀번호 통일: users={len(all_users)} generation_accounts={len(all_accts)} → '{PASSWORD}'")
        print("기수 로그인 계정:", ", ".join(d["username"] for d in DEMO), f"(비번 {PASSWORD})")


if __name__ == "__main__":
    asyncio.run(main())
