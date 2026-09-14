"""dev_feedback: 답변 컬럼 추가

Revision ID: e5f6a8b9c0d1
Revises: d4e5f6a8b9c0
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "e5f6a8b9c0d1"
down_revision = "d4e5f6a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dev_feedback", sa.Column("reply", sa.Text(), nullable=True))
    op.add_column("dev_feedback", sa.Column("replied_at", sa.TIMESTAMP(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("dev_feedback", "replied_at")
    op.drop_column("dev_feedback", "reply")
