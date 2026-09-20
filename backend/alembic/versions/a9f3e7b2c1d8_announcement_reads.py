"""공지 열람 기록 (announcement_reads)

Revision ID: a9f3e7b2c1d8
Revises: c4d5e6f7a8b9
Create Date: 2026-09-20 14:55:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a9f3e7b2c1d8'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "announcement_reads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("announcement_id", sa.Integer(),
                  sa.ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Integer(),
                  sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=True),
        sa.Column("user_id", sa.Integer(),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    # 한 사람이 같은 공지를 여러 번 열어도 1행만 — 첫 열람 시각이 보존된다
    op.create_index("uq_ann_read_member", "announcement_reads",
                    ["announcement_id", "member_id"], unique=True,
                    postgresql_where=sa.text("member_id IS NOT NULL"))
    op.create_index("uq_ann_read_user", "announcement_reads",
                    ["announcement_id", "user_id"], unique=True,
                    postgresql_where=sa.text("user_id IS NOT NULL"))
    op.create_index("ix_ann_read_ann", "announcement_reads", ["announcement_id"])


def downgrade() -> None:
    op.drop_index("ix_ann_read_ann", table_name="announcement_reads")
    op.drop_index("uq_ann_read_user", table_name="announcement_reads")
    op.drop_index("uq_ann_read_member", table_name="announcement_reads")
    op.drop_table("announcement_reads")
