"""cohorts.penalty_rules — 기수별 벌점·상점 규칙 (NULL = 기본값)

Revision ID: e1f2a3b4c5d6
Revises: d9e0f1a2b3c4
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "e1f2a3b4c5d6"
down_revision = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("cohorts", sa.Column("penalty_rules", JSONB, nullable=True))


def downgrade():
    op.drop_column("cohorts", "penalty_rules")
