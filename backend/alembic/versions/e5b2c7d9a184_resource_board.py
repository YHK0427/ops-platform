"""자료실 분리 (announcements.kind) + 수정 시 읽음 초기화 기준

Revision ID: e5b2c7d9a184
Revises: d4f1a8c6e207
Create Date: 2026-09-20 17:45:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5b2c7d9a184'
down_revision: Union[str, None] = 'd4f1a8c6e207'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("announcements", sa.Column("kind", sa.String(length=10), nullable=False, server_default="notice"))
    op.create_index("ix_announcements_kind", "announcements", ["kind"])
    op.create_check_constraint("ck_announcement_kind", "announcements", "kind IN ('notice','resource')")

    op.add_column("announcements", sa.Column("content_updated_at", sa.TIMESTAMP(timezone=True),
                                             nullable=True, server_default=sa.text("now()")))
    # 기존 글은 마지막 수정 시각을 본문 수정 시각으로 본다(없으면 작성 시각)
    op.execute("UPDATE announcements SET content_updated_at = COALESCE(updated_at, created_at)")

    op.add_column("announcement_reads", sa.Column("last_read_at", sa.TIMESTAMP(timezone=True), nullable=True))
    # 기존 열람 기록은 처음 연 시각을 마지막 열람으로 본다
    op.execute("UPDATE announcement_reads SET last_read_at = read_at")
    op.alter_column("announcement_reads", "last_read_at", server_default=sa.text("now()"))


def downgrade() -> None:
    op.drop_column("announcement_reads", "last_read_at")
    op.drop_column("announcements", "content_updated_at")
    op.drop_constraint("ck_announcement_kind", "announcements", type_="check")
    op.drop_index("ix_announcements_kind", table_name="announcements")
    op.drop_column("announcements", "kind")
