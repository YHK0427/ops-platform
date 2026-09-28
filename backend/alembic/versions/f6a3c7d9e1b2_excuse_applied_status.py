"""excuse_submissions.applied_status

Revision ID: f6a3c7d9e1b2
Revises: e4f2b6c8d0a1
"""
import sqlalchemy as sa
from alembic import op

revision = "f6a3c7d9e1b2"
down_revision = "e4f2b6c8d0a1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("excuse_submissions", sa.Column("applied_status", sa.String(20)))


def downgrade():
    op.drop_column("excuse_submissions", "applied_status")
