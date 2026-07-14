"""scoring: 참관위원 소그룹 (운영진/기수/청중 …)

Revision ID: bf3a91c07d24
Revises: ade928d4503a
Create Date: 2026-07-14 14:20:00.000000

집계에는 영향 없음 — 제출현황·결과를 그룹별로 나눠 보기 위한 분류용 필드.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'bf3a91c07d24'
down_revision: Union[str, None] = 'ade928d4503a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OBSERVER_GROUPS_DEFAULT = '\'["운영진", "기수", "청중"]\''


def upgrade() -> None:
    op.add_column(
        'scoring_rounds',
        sa.Column('observer_groups', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text(OBSERVER_GROUPS_DEFAULT), nullable=False),
    )
    op.add_column(
        'scoring_participants',
        sa.Column('group_label', sa.String(length=30), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('scoring_participants', 'group_label')
    op.drop_column('scoring_rounds', 'observer_groups')
