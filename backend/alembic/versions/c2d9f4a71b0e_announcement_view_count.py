"""공지 순수 조회수

Revision ID: c2d9f4a71b0e
Revises: a1b8e4f2c703
Create Date: 2026-09-21 19:32:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c2d9f4a71b0e'
down_revision: Union[str, None] = 'a1b8e4f2c703'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("announcements",
                  sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"))
    # 이미 읽은 기록이 있는 만큼은 최소한 본 것이므로 그 수로 시작한다.
    # 0 부터 시작하면 예전 공지가 아무도 안 본 것처럼 보인다.
    op.execute("""
        UPDATE announcements a SET view_count = (
            SELECT count(*) FROM announcement_reads r WHERE r.announcement_id = a.id
        )
    """)


def downgrade() -> None:
    op.drop_column("announcements", "view_count")
