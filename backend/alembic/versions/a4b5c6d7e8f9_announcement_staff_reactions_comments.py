"""announcement staff reactions/comments (user_id, member_id nullable)

Revision ID: a4b5c6d7e8f9
Revises: f3a4b5c6d7e8
Create Date: 2026-06-16 06:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4b5c6d7e8f9'
down_revision: Union[str, None] = 'f3a4b5c6d7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 반응: member_id nullable + user_id 추가, 단일 unique → 부분 unique 2개
    op.drop_constraint("uq_announcement_reaction", "announcement_reactions", type_="unique")
    op.alter_column("announcement_reactions", "member_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("announcement_reactions", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_ann_reaction_user", "announcement_reactions", "users",
                          ["user_id"], ["id"], ondelete="CASCADE")
    op.create_index("uq_ann_reaction_member", "announcement_reactions",
                    ["announcement_id", "member_id", "emoji"], unique=True,
                    postgresql_where=sa.text("member_id IS NOT NULL"))
    op.create_index("uq_ann_reaction_user", "announcement_reactions",
                    ["announcement_id", "user_id", "emoji"], unique=True,
                    postgresql_where=sa.text("user_id IS NOT NULL"))

    # 댓글: member_id nullable + user_id 추가
    op.alter_column("announcement_comments", "member_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("announcement_comments", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_ann_comment_user", "announcement_comments", "users",
                          ["user_id"], ["id"], ondelete="CASCADE")


def downgrade() -> None:
    op.drop_constraint("fk_ann_comment_user", "announcement_comments", type_="foreignkey")
    op.drop_column("announcement_comments", "user_id")
    op.alter_column("announcement_comments", "member_id", existing_type=sa.Integer(), nullable=False)

    op.drop_index("uq_ann_reaction_user", table_name="announcement_reactions")
    op.drop_index("uq_ann_reaction_member", table_name="announcement_reactions")
    op.drop_constraint("fk_ann_reaction_user", "announcement_reactions", type_="foreignkey")
    op.drop_column("announcement_reactions", "user_id")
    op.alter_column("announcement_reactions", "member_id", existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint("uq_announcement_reaction", "announcement_reactions",
                                ["announcement_id", "member_id", "emoji"])
