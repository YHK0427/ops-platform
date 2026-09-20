"""서버 상태 1분 스냅샷 (그래프용)

Revision ID: a1b8e4f2c703
Revises: f3a7d1c5e829
Create Date: 2026-09-20 21:40:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b8e4f2c703'
down_revision: Union[str, None] = 'f3a7d1c5e829'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "infra_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("cpu_load_1m", sa.Numeric(6, 2), nullable=True),
        sa.Column("memory_used_percent", sa.Numeric(5, 1), nullable=True),
        sa.Column("disk_used_percent", sa.Numeric(5, 1), nullable=True),
        sa.Column("db_size_mb", sa.Numeric(12, 1), nullable=True),
        sa.Column("db_connections", sa.Integer(), nullable=True),
        sa.Column("db_latency_ms", sa.Numeric(8, 1), nullable=True),
        sa.Column("redis_used_mb", sa.Numeric(10, 1), nullable=True),
        sa.Column("queue_depth", sa.Integer(), nullable=True),
        sa.Column("worker_alive", sa.Boolean(), nullable=True),
        sa.Column("requests", sa.Integer(), nullable=True),
        sa.Column("errors", sa.Integer(), nullable=True),
        sa.Column("p95_ms", sa.Integer(), nullable=True),
    )
    op.create_index("ix_infra_snapshots_created_at", "infra_snapshots", ["created_at"])


def downgrade() -> None:
    op.drop_table("infra_snapshots")
