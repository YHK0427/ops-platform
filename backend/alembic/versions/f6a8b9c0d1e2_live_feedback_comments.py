"""live_feedback_comments: 피드백 글 댓글(패들렛 스타일) 테이블 신설

Revision ID: f6a8b9c0d1e2
Revises: e5f6a8b9c0d1
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "f6a8b9c0d1e2"
down_revision = "e5f6a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_feedback_comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("post_id", sa.Integer(), sa.ForeignKey("live_feedback_posts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_member_id", sa.Integer(), sa.ForeignKey("members.id"), nullable=True),
        sa.Column("author_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_anonymous", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_live_feedback_comments_post_id", "live_feedback_comments", ["post_id"])


def downgrade() -> None:
    op.drop_index("ix_live_feedback_comments_post_id", table_name="live_feedback_comments")
    op.drop_table("live_feedback_comments")
