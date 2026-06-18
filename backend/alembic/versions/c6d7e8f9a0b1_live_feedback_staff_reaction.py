"""live feedback staff reaction (reaction user_id, member_id nullable)

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-06-17 09:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c6d7e8f9a0b1'
down_revision: Union[str, None] = 'b5c6d7e8f9a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("live_feedback_reactions", "member_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("live_feedback_reactions", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_lf_reaction_user", "live_feedback_reactions", "users",
                          ["user_id"], ["id"], ondelete="CASCADE")
    op.drop_constraint("uq_live_feedback_reaction", "live_feedback_reactions", type_="unique")
    op.create_index("uq_lf_reaction_member", "live_feedback_reactions", ["post_id", "member_id", "emoji"],
                    unique=True, postgresql_where=sa.text("member_id IS NOT NULL"))
    op.create_index("uq_lf_reaction_user", "live_feedback_reactions", ["post_id", "user_id", "emoji"],
                    unique=True, postgresql_where=sa.text("user_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("uq_lf_reaction_user", table_name="live_feedback_reactions")
    op.drop_index("uq_lf_reaction_member", table_name="live_feedback_reactions")
    op.create_unique_constraint("uq_live_feedback_reaction", "live_feedback_reactions",
                                ["post_id", "member_id", "emoji"])
    op.drop_constraint("fk_lf_reaction_user", "live_feedback_reactions", type_="foreignkey")
    op.drop_column("live_feedback_reactions", "user_id")
    op.alter_column("live_feedback_reactions", "member_id", existing_type=sa.Integer(), nullable=False)
