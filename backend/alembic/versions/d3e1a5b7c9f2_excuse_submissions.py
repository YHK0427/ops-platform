"""excuse_submissions

Revision ID: d3e1a5b7c9f2
Revises: c2d9f4a71b0e
"""
import sqlalchemy as sa
from alembic import op

revision = "d3e1a5b7c9f2"
down_revision = "c2d9f4a71b0e"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "excuse_submissions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("cohort_id", sa.Integer, sa.ForeignKey("cohorts.id"), nullable=False),
        sa.Column("member_id", sa.Integer, sa.ForeignKey("members.id"), nullable=False),
        sa.Column("target_date", sa.Date, nullable=False),
        sa.Column("excuse_type", sa.String(10), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("reason_kind", sa.String(20), nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("review", sa.String(20)),
        sa.Column("reviewed_by", sa.String(100)),
        sa.Column("reviewed_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("member_id", "target_date", name="uq_excuse_member_date"),
        sa.CheckConstraint("excuse_type IN ('PRE','POST')", name="ck_excuse_sub_type"),
        sa.CheckConstraint("category IN ('ABSENT','LATE','EARLY_LEAVE')", name="ck_excuse_sub_category"),
        sa.CheckConstraint("reason_kind IN ('NORMAL','RECOGNIZED')", name="ck_excuse_sub_reason_kind"),
        sa.CheckConstraint("review IN ('PENDING','APPROVED','REJECTED') OR review IS NULL", name="ck_excuse_sub_review"),
    )
    op.create_index("ix_excuse_submissions_cohort_id", "excuse_submissions", ["cohort_id"])
    op.create_index("ix_excuse_submissions_member_id", "excuse_submissions", ["member_id"])
    op.create_index("ix_excuse_submissions_session_id", "excuse_submissions", ["session_id"])


def downgrade():
    op.drop_table("excuse_submissions")
