"""scoring: 등수 가중치를 퍼센트(합 100)로 표기 통일

Revision ID: d5b8e0a3126c
Revises: c04e7b219f85
Create Date: 2026-07-14 14:50:00.000000

집계 엔진은 rank_points를 **상대 비율로만** 쓰기 때문에(합계로 나눠 정규화),
값을 퍼센트로 바꿔도 결과는 완전히 동일하다. 운영자가 "20점 중 2점"처럼
절대 점수를 입력하며 헷갈리던 걸 없애려는 표기 변경이다.

- 기본값: 1위 50% / 2위 30% / 3위 20%
- 기존 행: 비율을 유지한 채 합계가 100이 되도록 환산 (의미 변화 없음)
"""
from typing import Sequence, Union

import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd5b8e0a3126c'
down_revision: Union[str, None] = 'c04e7b219f85'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_DEFAULT = '\'[{"rank": 1, "points": 50}, {"rank": 2, "points": 30}, {"rank": 3, "points": 20}]\''
OLD_DEFAULT = '\'[{"rank": 1, "points": 2}, {"rank": 2, "points": 1.3}, {"rank": 3, "points": 0.7}]\''


def upgrade() -> None:
    op.execute(f"ALTER TABLE scoring_rounds ALTER COLUMN rank_points SET DEFAULT {NEW_DEFAULT}::jsonb")

    # 기존 행을 합계 100 기준으로 환산 (비율 동일 → 집계 결과 불변)
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, rank_points FROM scoring_rounds")).fetchall()
    for rid, pts in rows:
        if not pts:
            continue
        items = pts if isinstance(pts, list) else json.loads(pts)
        total = sum(float(p.get("points", 0)) for p in items)
        if total <= 0:
            continue
        rescaled = [
            {"rank": int(p["rank"]), "points": round(float(p.get("points", 0)) / total * 100, 2)}
            for p in items
        ]
        conn.execute(
            sa.text("UPDATE scoring_rounds SET rank_points = :pts WHERE id = :id"),
            {"pts": json.dumps(rescaled, ensure_ascii=False), "id": rid},
        )


def downgrade() -> None:
    op.execute(f"ALTER TABLE scoring_rounds ALTER COLUMN rank_points SET DEFAULT {OLD_DEFAULT}::jsonb")
