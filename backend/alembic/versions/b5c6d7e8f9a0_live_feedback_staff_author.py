"""live feedback staff author (author_user_id, alias user_id, member_id nullable)

Revision ID: b5c6d7e8f9a0
Revises: a4b5c6d7e8f9
Create Date: 2026-06-17 06:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b5c6d7e8f9a0'
down_revision: Union[str, None] = 'a4b5c6d7e8f9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 글 작성자: 운영진(author_user_id) 추가 + member_id nullable
    op.alter_column("live_feedback_posts", "author_member_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("live_feedback_posts", sa.Column("author_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_lf_post_author_user", "live_feedback_posts", "users",
                          ["author_user_id"], ["id"], ondelete="CASCADE")

    # 익명 별칭: 운영진(user_id) 추가 + member_id nullable + 부분 unique 인덱스로 전환
    op.alter_column("live_feedback_anon_aliases", "member_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("live_feedback_anon_aliases", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_lf_alias_user", "live_feedback_anon_aliases", "users",
                          ["user_id"], ["id"], ondelete="CASCADE")
    op.drop_constraint("uq_live_feedback_alias_member", "live_feedback_anon_aliases", type_="unique")
    op.create_index("uq_lf_alias_member", "live_feedback_anon_aliases", ["board_id", "member_id"],
                    unique=True, postgresql_where=sa.text("member_id IS NOT NULL"))
    op.create_index("uq_lf_alias_user", "live_feedback_anon_aliases", ["board_id", "user_id"],
                    unique=True, postgresql_where=sa.text("user_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("uq_lf_alias_user", table_name="live_feedback_anon_aliases")
    op.drop_index("uq_lf_alias_member", table_name="live_feedback_anon_aliases")
    op.create_unique_constraint("uq_live_feedback_alias_member", "live_feedback_anon_aliases", ["board_id", "member_id"])
    op.drop_constraint("fk_lf_alias_user", "live_feedback_anon_aliases", type_="foreignkey")
    op.drop_column("live_feedback_anon_aliases", "user_id")
    op.alter_column("live_feedback_anon_aliases", "member_id", existing_type=sa.Integer(), nullable=False)

    op.drop_constraint("fk_lf_post_author_user", "live_feedback_posts", type_="foreignkey")
    op.drop_column("live_feedback_posts", "author_user_id")
    op.alter_column("live_feedback_posts", "author_member_id", existing_type=sa.Integer(), nullable=False)
