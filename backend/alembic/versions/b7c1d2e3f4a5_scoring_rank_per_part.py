"""scoring: 부별 순위 옵션

Revision ID: b7c1d2e3f4a5
Revises: e1f2a3b4c5d6
Create Date: 2026-11-22

RANK 모드에서 청중이 부마다 따로 등수를 고르도록 하는 라운드별 토글.
같은 등수가 부마다 하나씩 생기므로 (참가자, 등수) 유니크 제약을 없애고 앱에서 검사한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b7c1d2e3f4a5'
down_revision: Union[str, None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'scoring_rounds',
        sa.Column('rank_per_part', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.drop_constraint('uq_scoring_rank_slot', 'scoring_ranks', type_='unique')


def downgrade() -> None:
    op.create_unique_constraint('uq_scoring_rank_slot', 'scoring_ranks', ['participant_id', 'rank'])
    op.drop_column('scoring_rounds', 'rank_per_part')
