"""live feedback: 팀 세션 지원 — 보드 대상(팀 전체 / 팀원 개인) + 팀 대상 글

Revision ID: d9e0f1a2b3c4
Revises: 421972411f26
"""
import sqlalchemy as sa
from alembic import op

revision = "d9e0f1a2b3c4"
down_revision = "421972411f26"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("live_feedback_boards", sa.Column(
        "target_mode", sa.String(6), nullable=False, server_default="MEMBER"))
    op.create_check_constraint("ck_live_feedback_board_target_mode", "live_feedback_boards",
                               "target_mode IN ('MEMBER', 'TEAM')")
    op.add_column("live_feedback_posts", sa.Column(
        "presenter_team_id", sa.Integer, sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_live_feedback_posts_presenter_team_id", "live_feedback_posts", ["presenter_team_id"])
    op.drop_constraint("ck_live_feedback_post_one_presenter", "live_feedback_posts", type_="check")
    op.create_check_constraint("ck_live_feedback_post_one_presenter", "live_feedback_posts",
                               "num_nonnulls(presenter_member_id, presenter_guest_id, presenter_team_id) = 1")


def downgrade():
    op.drop_constraint("ck_live_feedback_post_one_presenter", "live_feedback_posts", type_="check")
    op.execute("DELETE FROM live_feedback_posts WHERE presenter_team_id IS NOT NULL")
    op.create_check_constraint("ck_live_feedback_post_one_presenter", "live_feedback_posts",
                               "(presenter_member_id IS NULL) <> (presenter_guest_id IS NULL)")
    op.drop_index("ix_live_feedback_posts_presenter_team_id", "live_feedback_posts")
    op.drop_column("live_feedback_posts", "presenter_team_id")
    op.drop_constraint("ck_live_feedback_board_target_mode", "live_feedback_boards", type_="check")
    op.drop_column("live_feedback_boards", "target_mode")
