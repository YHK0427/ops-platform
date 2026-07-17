"""scoring: 청중 피드백 필수 옵션 추가

Revision ID: a3d6c2e8f1b7
Revises: f7b2c8d1e9a3
Create Date: 2026-07-17

RANK 모드 청중이 팀별 피드백을 모두 채워야 제출되도록 하는 라운드별 토글.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a3d6c2e8f1b7'
down_revision: Union[str, None] = 'f7b2c8d1e9a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'scoring_rounds',
        sa.Column('require_feedback', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('scoring_rounds', 'require_feedback')
