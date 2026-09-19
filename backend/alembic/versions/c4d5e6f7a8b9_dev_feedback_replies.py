"""dev_feedback_replies: 개발자 답변 여러 개 달 수 있게 분리

Revision ID: c4d5e6f7a8b9
Revises: a8d2d12d276d
Create Date: 2026-09-19

기존 dev_feedback.reply/replied_at(단일 답변)을 별도 테이블로 분리 —
진행상황 업데이트처럼 답변을 여러 번 남길 수 있어야 해서.
기존 단일 답변은 새 테이블로 데이터 이관 후 컬럼 삭제.
"""
from alembic import op
import sqlalchemy as sa

revision = "c4d5e6f7a8b9"
down_revision = "a8d2d12d276d"
branch_labels = None
depends_on = None

DEVELOPER_USERNAME = "adminyhk"


def upgrade() -> None:
    op.create_table(
        "dev_feedback_replies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("feedback_id", sa.Integer(), sa.ForeignKey("dev_feedback.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_username", sa.String(length=50), nullable=False),
        sa.Column("reply", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_dev_feedback_replies_feedback_id", "dev_feedback_replies", ["feedback_id"])

    # 기존 단일 답변 이관
    conn = op.get_bind()
    conn.execute(sa.text(
        """
        INSERT INTO dev_feedback_replies (feedback_id, author_username, reply, created_at)
        SELECT id, :dev_user, reply, COALESCE(replied_at, created_at)
        FROM dev_feedback WHERE reply IS NOT NULL
        """
    ), {"dev_user": DEVELOPER_USERNAME})

    op.drop_column("dev_feedback", "reply")
    op.drop_column("dev_feedback", "replied_at")


def downgrade() -> None:
    op.add_column("dev_feedback", sa.Column("reply", sa.Text(), nullable=True))
    op.add_column("dev_feedback", sa.Column("replied_at", sa.TIMESTAMP(timezone=True), nullable=True))

    conn = op.get_bind()
    conn.execute(sa.text(
        """
        UPDATE dev_feedback d
        SET reply = latest.reply, replied_at = latest.created_at
        FROM (
            SELECT DISTINCT ON (feedback_id) feedback_id, reply, created_at
            FROM dev_feedback_replies
            ORDER BY feedback_id, created_at DESC
        ) latest
        WHERE d.id = latest.feedback_id
        """
    ))

    op.drop_index("ix_dev_feedback_replies_feedback_id", table_name="dev_feedback_replies")
    op.drop_table("dev_feedback_replies")
