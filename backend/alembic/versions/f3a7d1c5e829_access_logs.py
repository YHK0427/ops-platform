"""접속 기록 (access_logs)

Revision ID: f3a7d1c5e829
Revises: e5b2c7d9a184
Create Date: 2026-09-20 21:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a7d1c5e829'
down_revision: Union[str, None] = 'e5b2c7d9a184'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "access_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("actor_kind", sa.String(length=10), nullable=False, server_default="anon"),
        sa.Column("actor_username", sa.String(length=50), nullable=True),
        sa.Column("actor_label", sa.String(length=120), nullable=True),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("method", sa.String(length=8), nullable=False),
        sa.Column("path", sa.String(length=200), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("ip", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("hits", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_seen_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_access_logs_created_at", "access_logs", ["created_at"])
    op.create_index("ix_access_logs_actor_username", "access_logs", ["actor_username"])
    op.create_index("ix_access_logs_cohort_id", "access_logs", ["cohort_id"])
    op.create_index("ix_access_logs_actor_time", "access_logs", ["actor_username", "created_at"])


def downgrade() -> None:
    op.drop_table("access_logs")
