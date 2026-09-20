"""업데이트 패치노트 + 계정별 확인 시점

Revision ID: d4f1a8c6e207
Revises: c8e2a5b9d3f1
Create Date: 2026-09-20 17:35:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f1a8c6e207'
down_revision: Union[str, None] = 'c8e2a5b9d3f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "patch_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("audience", sa.String(length=10), nullable=False, server_default="all"),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("published_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", sa.String(length=50), nullable=True),
        sa.CheckConstraint("audience IN ('staff','member','all')", name="ck_patch_notes_audience"),
    )
    op.create_index("ix_patch_notes_published_at", "patch_notes", ["published_at"])

    op.add_column("users", sa.Column("patch_seen_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("generation_accounts", sa.Column("patch_seen_at", sa.TIMESTAMP(timezone=True), nullable=True))
    # 기존 계정은 '지금까지는 다 봤다'로 둔다 — 안 그러면 첫 노트 하나에 전원이 과거 글까지 본다
    op.execute("UPDATE users SET patch_seen_at = now()")
    op.execute("UPDATE generation_accounts SET patch_seen_at = now()")


def downgrade() -> None:
    op.drop_column("generation_accounts", "patch_seen_at")
    op.drop_column("users", "patch_seen_at")
    op.drop_index("ix_patch_notes_published_at", table_name="patch_notes")
    op.drop_table("patch_notes")
