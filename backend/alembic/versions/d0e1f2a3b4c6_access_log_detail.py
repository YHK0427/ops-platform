"""접속 기록에 에러 사유

Revision ID: d0e1f2a3b4c6
Revises: c9d0e1f2a3b5
"""
import sqlalchemy as sa
from alembic import op

revision = "d0e1f2a3b4c6"
down_revision = "c9d0e1f2a3b5"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("access_logs", sa.Column("detail", sa.String(300), nullable=True))


def downgrade():
    op.drop_column("access_logs", "detail")
