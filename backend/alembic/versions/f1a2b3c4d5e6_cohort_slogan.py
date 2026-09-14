"""cohorts: per-cohort growth report slogan

Revision ID: f1a2b3c4d5e6
Revises: e5f7a9c1d3b4
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "f1a2b3c4d5e6"
down_revision = "e5f7a9c1d3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cohorts", sa.Column("slogan", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("cohorts", "slogan")
