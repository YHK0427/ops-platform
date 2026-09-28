"""live feedback: 발표자 수동 조정 + 외부 발표자

Revision ID: b8c9d0e1f2a4
Revises: a7b8c9d0e1f3
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision = "b8c9d0e1f2a4"
down_revision = "a7b8c9d0e1f3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("live_feedback_boards", sa.Column("added_presenters", JSONB, nullable=False, server_default=sa.text("'[]'")))
    op.add_column("live_feedback_boards", sa.Column("removed_member_ids", ARRAY(sa.Integer), nullable=False, server_default=sa.text("'{}'")))
    op.create_table(
        "live_feedback_guests",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("board_id", sa.Integer, sa.ForeignKey("live_feedback_boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("group_num", sa.Integer),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_live_feedback_guests_board_id", "live_feedback_guests", ["board_id"])
    op.alter_column("live_feedback_posts", "presenter_member_id", nullable=True)
    op.add_column("live_feedback_posts", sa.Column(
        "presenter_guest_id", sa.Integer, sa.ForeignKey("live_feedback_guests.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_live_feedback_posts_presenter_guest_id", "live_feedback_posts", ["presenter_guest_id"])
    op.create_check_constraint("ck_live_feedback_post_one_presenter", "live_feedback_posts",
                               "(presenter_member_id IS NULL) <> (presenter_guest_id IS NULL)")


def downgrade():
    op.drop_constraint("ck_live_feedback_post_one_presenter", "live_feedback_posts", type_="check")
    op.execute("DELETE FROM live_feedback_posts WHERE presenter_guest_id IS NOT NULL")
    op.drop_index("ix_live_feedback_posts_presenter_guest_id", "live_feedback_posts")
    op.drop_column("live_feedback_posts", "presenter_guest_id")
    op.alter_column("live_feedback_posts", "presenter_member_id", nullable=False)
    op.drop_index("ix_live_feedback_guests_board_id", "live_feedback_guests")
    op.drop_table("live_feedback_guests")
    op.drop_column("live_feedback_boards", "removed_member_ids")
    op.drop_column("live_feedback_boards", "added_presenters")
