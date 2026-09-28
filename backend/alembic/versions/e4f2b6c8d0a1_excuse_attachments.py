"""excuse_attachments

Revision ID: e4f2b6c8d0a1
Revises: d3e1a5b7c9f2
"""
import sqlalchemy as sa
from alembic import op

revision = "e4f2b6c8d0a1"
down_revision = "d3e1a5b7c9f2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "excuse_attachments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("submission_id", sa.Integer, sa.ForeignKey("excuse_submissions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stored_name", sa.String(64), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_excuse_attachments_submission_id", "excuse_attachments", ["submission_id"])


def downgrade():
    op.drop_table("excuse_attachments")
