"""attendance.is_recognized

Revision ID: a7b8c9d0e1f3
Revises: f6a3c7d9e1b2
"""
import sqlalchemy as sa
from alembic import op

revision = "a7b8c9d0e1f3"
down_revision = "f6a3c7d9e1b2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("attendance", sa.Column("is_recognized", sa.Boolean, nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column("attendance", "is_recognized")
