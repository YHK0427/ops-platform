"""scoring rounds: view restriction + sheet notices + multi-club audience mode

Revision ID: e5f7a9c1d3b4
Revises: d2e4f6a8b0c1
Create Date: 2026-07-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e5f7a9c1d3b4"
down_revision = "d2e4f6a8b0c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scoring_rounds", sa.Column("rank_form_notice", sa.Text(), nullable=True))
    op.add_column("scoring_rounds", sa.Column("feedback_form_notice", sa.Text(), nullable=True))
    op.add_column("scoring_rounds", sa.Column("restricted_departments", postgresql.JSONB(), nullable=True))
    op.add_column("scoring_rounds", sa.Column("restricted_exception_usernames", postgresql.JSONB(), nullable=True))
    op.add_column(
        "scoring_rounds",
        sa.Column("multi_club_mode", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("scoring_rounds", sa.Column("external_group_labels", postgresql.JSONB(), nullable=True))
    op.add_column("scoring_rounds", sa.Column("group_blocked_targets", postgresql.JSONB(), nullable=True))
    op.add_column(
        "scoring_rounds",
        sa.Column("internal_audience_weight", sa.Numeric(6, 2), nullable=False, server_default="50"),
    )
    op.add_column(
        "scoring_rounds",
        sa.Column("external_audience_weight", sa.Numeric(6, 2), nullable=False, server_default="50"),
    )


def downgrade() -> None:
    op.drop_column("scoring_rounds", "external_audience_weight")
    op.drop_column("scoring_rounds", "internal_audience_weight")
    op.drop_column("scoring_rounds", "group_blocked_targets")
    op.drop_column("scoring_rounds", "external_group_labels")
    op.drop_column("scoring_rounds", "multi_club_mode")
    op.drop_column("scoring_rounds", "restricted_exception_usernames")
    op.drop_column("scoring_rounds", "restricted_departments")
    op.drop_column("scoring_rounds", "feedback_form_notice")
    op.drop_column("scoring_rounds", "rank_form_notice")
