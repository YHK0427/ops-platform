"""dev_feedback: 개발자 소통창구 테이블 신설

Revision ID: d4e5f6a8b9c0
Revises: c3d4e5f6a8b9
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "d4e5f6a8b9c0"
down_revision = "c3d4e5f6a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dev_feedback",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cohort_id", sa.Integer(), sa.ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("reporter_username", sa.String(length=50), nullable=False),
        sa.Column("reporter_display_name", sa.String(length=50), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_dev_feedback_cohort_id", "dev_feedback", ["cohort_id"])


def downgrade() -> None:
    op.drop_index("ix_dev_feedback_cohort_id", table_name="dev_feedback")
    op.drop_table("dev_feedback")
