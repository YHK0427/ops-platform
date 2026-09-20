"""팀빌딩 보드 생성자 기록 (created_by)

Revision ID: b7c4e9a1f2d3
Revises: a9f3e7b2c1d8
Create Date: 2026-09-20 15:12:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c4e9a1f2d3'
down_revision: Union[str, None] = 'a9f3e7b2c1d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("team_building_boards", sa.Column("created_by", sa.String(length=100), nullable=True))
    op.add_column("team_building_boards", sa.Column("created_by_username", sa.String(length=50), nullable=True))
    # 이미 만들어진 보드는 감사 로그에 INSERT 기록이 있으면 거기서 생성자를 복원한다.
    # (감사 훅 도입 이전에 만들어진 보드는 채울 근거가 없으므로 NULL로 남는다)
    op.execute("""
        UPDATE team_building_boards b
        SET created_by = a.actor_label,
            created_by_username = a.actor_username
        FROM (
            SELECT DISTINCT ON (row_id) row_id, actor_label, actor_username
            FROM audit_logs
            WHERE table_name = 'team_building_boards' AND operation = 'INSERT'
            ORDER BY row_id, created_at
        ) a
        WHERE a.row_id = b.id::text AND b.created_by IS NULL
    """)


def downgrade() -> None:
    op.drop_column("team_building_boards", "created_by_username")
    op.drop_column("team_building_boards", "created_by")
