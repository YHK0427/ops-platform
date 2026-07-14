"""scoring: 명단 소그룹 + 팀원 이름 + 팀 표시명

Revision ID: c04e7b219f85
Revises: bf3a91c07d24
Create Date: 2026-07-14 14:35:00.000000

- scoring_roster.group_label: 임포트할 때 소그룹을 한 번에 태깅(기수/운영진 등).
  제출자가 그룹을 직접 고르지 않으면 매칭된 명단의 이 값을 물려받는다.
- scoring_targets.member_names: 채점 폼에서 팀원을 보여주기 위한 이름 스냅샷.
- scoring_targets.display_name: 평가 폼에 보이는 팀 이름(원본 팀명과 별도).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c04e7b219f85'
down_revision: Union[str, None] = 'bf3a91c07d24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'scoring_roster',
        sa.Column('group_label', sa.String(length=30), nullable=True),
    )
    op.add_column(
        'scoring_targets',
        sa.Column('member_names', postgresql.ARRAY(sa.String()),
                  server_default=sa.text("'{}'"), nullable=False),
    )
    op.add_column(
        'scoring_targets',
        sa.Column('display_name', sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('scoring_targets', 'display_name')
    op.drop_column('scoring_targets', 'member_names')
    op.drop_column('scoring_roster', 'group_label')
