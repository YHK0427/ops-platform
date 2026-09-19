"""add_audit_logs: 전체 모델 변경 이력 테이블 (누가 언제 무엇을 insert/update/delete 했는지)

Revision ID: a8d2d12d276d
Revises: b8d1e2f3a4c5
Create Date: 2026-09-19

app/audit_hook.py의 SQLAlchemy after_flush 훅이 이 테이블에 자동 기록한다.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a8d2d12d276d"
down_revision = "b8d1e2f3a4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("actor_label", sa.String(length=120), nullable=False),
        sa.Column("actor_username", sa.String(length=50), nullable=True),
        sa.Column("actor_role", sa.String(length=20), nullable=True),
        sa.Column("cohort_id", sa.Integer(), nullable=True),
        sa.Column("operation", sa.String(length=20), nullable=False),
        sa.Column("table_name", sa.String(length=100), nullable=False),
        sa.Column("row_id", sa.String(length=50), nullable=True),
        sa.Column("owner_member_id", sa.Integer(), nullable=True),
        sa.Column("entity_label", sa.String(length=200), nullable=True),
        sa.Column("changes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("request_path", sa.String(length=200), nullable=True),
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])
    op.create_index("ix_audit_logs_actor_username", "audit_logs", ["actor_username"])
    op.create_index("ix_audit_logs_cohort_id", "audit_logs", ["cohort_id"])
    op.create_index("ix_audit_logs_table_name", "audit_logs", ["table_name"])
    op.create_index("ix_audit_logs_owner_member_id", "audit_logs", ["owner_member_id"])
    op.create_index("ix_audit_logs_table_row", "audit_logs", ["table_name", "row_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_table_row", table_name="audit_logs")
    op.drop_index("ix_audit_logs_owner_member_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_table_name", table_name="audit_logs")
    op.drop_index("ix_audit_logs_cohort_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_username", table_name="audit_logs")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_table("audit_logs")
