"""live feedback configurable categories + post contents jsonb

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-06-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_CATEGORIES = (
    '[{"key":"praise","label":"칭찬","color":"emerald"},'
    '{"key":"improve","label":"발전","color":"amber"}]'
)


def upgrade() -> None:
    # 보드: categories JSONB (기본 칭찬/발전) — 기존 보드도 server_default로 채워짐
    op.add_column(
        'live_feedback_boards',
        sa.Column('categories', sa.dialects.postgresql.JSONB(), nullable=False,
                  server_default=sa.text(f"'{_DEFAULT_CATEGORIES}'::jsonb")),
    )

    # 조퇴자 포함: 블랭킷 boolean → 개별 선택 member_id 배열
    op.add_column(
        'live_feedback_boards',
        sa.Column('early_leave_member_ids', sa.dialects.postgresql.ARRAY(sa.Integer()),
                  nullable=False, server_default=sa.text("'{}'")),
    )
    op.drop_column('live_feedback_boards', 'include_early_leave')

    # 글: praise_content/improve_content → contents JSONB
    op.add_column('live_feedback_posts', sa.Column('contents', sa.dialects.postgresql.JSONB(), nullable=True))
    op.execute(
        """
        UPDATE live_feedback_posts
        SET contents = jsonb_strip_nulls(
            jsonb_build_object('praise', praise_content, 'improve', improve_content)
        )
        """
    )
    # 혹시 둘 다 NULL이던 행이 있으면(이론상 없음) 빈 객체 방지
    op.execute("UPDATE live_feedback_posts SET contents = '{}'::jsonb WHERE contents IS NULL")
    op.alter_column('live_feedback_posts', 'contents', nullable=False)

    op.drop_constraint('ck_live_feedback_post_has_content', 'live_feedback_posts', type_='check')
    op.create_check_constraint(
        'ck_live_feedback_post_has_content', 'live_feedback_posts', "contents <> '{}'::jsonb",
    )
    op.drop_column('live_feedback_posts', 'praise_content')
    op.drop_column('live_feedback_posts', 'improve_content')


def downgrade() -> None:
    op.add_column('live_feedback_posts', sa.Column('praise_content', sa.Text(), nullable=True))
    op.add_column('live_feedback_posts', sa.Column('improve_content', sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE live_feedback_posts
        SET praise_content = contents->>'praise',
            improve_content = contents->>'improve'
        """
    )
    op.drop_constraint('ck_live_feedback_post_has_content', 'live_feedback_posts', type_='check')
    op.create_check_constraint(
        'ck_live_feedback_post_has_content', 'live_feedback_posts',
        "praise_content IS NOT NULL OR improve_content IS NOT NULL",
    )
    op.drop_column('live_feedback_posts', 'contents')
    op.add_column(
        'live_feedback_boards',
        sa.Column('include_early_leave', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.drop_column('live_feedback_boards', 'early_leave_member_ids')
    op.drop_column('live_feedback_boards', 'categories')
