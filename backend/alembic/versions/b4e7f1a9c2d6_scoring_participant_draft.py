"""scoring: 참가자 자동저장 초안(draft) 컬럼 추가

Revision ID: b4e7f1a9c2d6
Revises: a3d6c2e8f1b7
Create Date: 2026-07-17

청중 피드백 자동저장이 정식 제출로 잡히던 문제 — 초안은 draft 컬럼에만 쌓고,
'제출' 버튼을 눌러야 scoring_scores/ranks/comments·submitted_at에 반영되게 분리한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b4e7f1a9c2d6'
down_revision: Union[str, None] = 'a3d6c2e8f1b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'scoring_participants',
        sa.Column('draft', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('scoring_participants', 'draft')
