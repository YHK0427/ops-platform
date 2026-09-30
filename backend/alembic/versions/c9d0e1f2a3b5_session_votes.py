"""오프·오피 투표

Revision ID: c9d0e1f2a3b5
Revises: b8c9d0e1f2a4
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "c9d0e1f2a3b5"
down_revision = "b8c9d0e1f2a4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "session_votes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_num", sa.Integer, nullable=True),
        sa.Column("round", sa.Integer, nullable=False, server_default="1"),
        sa.Column("parent_id", sa.Integer, sa.ForeignKey("session_votes.id", ondelete="CASCADE"), nullable=True),
        sa.Column("candidates", JSONB, nullable=False),
        sa.Column("is_open", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("result", JSONB, nullable=True),
        sa.Column("opened_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.Column("closed_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_session_votes_session_id", "session_votes", ["session_id"])
    op.create_index("ix_session_votes_parent_id", "session_votes", ["parent_id"])
    op.create_table(
        "session_vote_ballots",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("vote_id", sa.Integer, sa.ForeignKey("session_votes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("voter_member_id", sa.Integer, sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category", sa.String(3), nullable=False),
        sa.Column("candidate_member_id", sa.Integer, sa.ForeignKey("members.id", ondelete="CASCADE"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("vote_id", "voter_member_id", "category", name="uq_session_vote_ballot"),
        sa.CheckConstraint("category IN ('OFF','OPI')", name="ck_session_vote_ballot_category"),
    )
    op.create_index("ix_session_vote_ballots_vote_id", "session_vote_ballots", ["vote_id"])


def downgrade():
    op.drop_table("session_vote_ballots")
    op.drop_table("session_votes")
