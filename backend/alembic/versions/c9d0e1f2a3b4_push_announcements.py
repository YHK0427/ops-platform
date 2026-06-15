"""web push subscriptions + announcements

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-15 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c9d0e1f2a3b4'
down_revision: Union[str, None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=200), nullable=False),
        sa.Column("auth", sa.String(length=100), nullable=False),
        sa.Column("ua", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["cohort_id"], ["cohorts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
        sa.CheckConstraint("user_id IS NOT NULL OR member_id IS NOT NULL", name="ck_push_sub_user_or_member"),
    )
    op.create_index("ix_push_subscriptions_member", "push_subscriptions", ["member_id"])
    op.create_index("ix_push_subscriptions_cohort", "push_subscriptions", ["cohort_id"])

    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cohort_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("target", sa.String(length=20), server_default="members", nullable=False),
        sa.Column("target_member_ids", postgresql.ARRAY(sa.Integer()), nullable=True),
        sa.Column("created_by", sa.String(length=50), nullable=True),
        sa.Column("pushed", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["cohort_id"], ["cohorts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("target IN ('members','staff','all','select')", name="ck_announcement_target"),
    )
    op.create_index("ix_announcements_cohort", "announcements", ["cohort_id"])


def downgrade() -> None:
    op.drop_index("ix_announcements_cohort", table_name="announcements")
    op.drop_table("announcements")
    op.drop_index("ix_push_subscriptions_cohort", table_name="push_subscriptions")
    op.drop_index("ix_push_subscriptions_member", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
