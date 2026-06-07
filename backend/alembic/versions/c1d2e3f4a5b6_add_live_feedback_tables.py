"""add live feedback tables

Revision ID: c1d2e3f4a5b6
Revises: b2c3d4e5f6a7
Create Date: 2026-06-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'live_feedback_boards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=100), nullable=False),
        sa.Column('is_open', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('include_early_leave', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('closed_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', name='uq_live_feedback_board_session'),
    )

    op.create_table(
        'live_feedback_posts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('board_id', sa.Integer(), nullable=False),
        sa.Column('author_member_id', sa.Integer(), nullable=False),
        sa.Column('presenter_member_id', sa.Integer(), nullable=False),
        sa.Column('praise_content', sa.Text(), nullable=True),
        sa.Column('improve_content', sa.Text(), nullable=True),
        sa.Column('is_anonymous', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('is_hidden', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.CheckConstraint('praise_content IS NOT NULL OR improve_content IS NOT NULL', name='ck_live_feedback_post_has_content'),
        sa.ForeignKeyConstraint(['board_id'], ['live_feedback_boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['author_member_id'], ['members.id']),
        sa.ForeignKeyConstraint(['presenter_member_id'], ['members.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_live_feedback_posts_board_presenter', 'live_feedback_posts', ['board_id', 'presenter_member_id'])
    op.create_index('ix_live_feedback_posts_board_created', 'live_feedback_posts', ['board_id', 'created_at'])

    op.create_table(
        'live_feedback_reactions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column('member_id', sa.Integer(), nullable=False),
        sa.Column('emoji', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['post_id'], ['live_feedback_posts.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['members.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'member_id', 'emoji', name='uq_live_feedback_reaction'),
    )
    op.create_index('ix_live_feedback_reactions_post', 'live_feedback_reactions', ['post_id'])

    op.create_table(
        'live_feedback_anon_aliases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('board_id', sa.Integer(), nullable=False),
        sa.Column('member_id', sa.Integer(), nullable=False),
        sa.Column('alias', sa.String(length=40), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['board_id'], ['live_feedback_boards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['members.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('board_id', 'member_id', name='uq_live_feedback_alias_member'),
        sa.UniqueConstraint('board_id', 'alias', name='uq_live_feedback_alias_unique'),
    )


def downgrade() -> None:
    op.drop_table('live_feedback_anon_aliases')
    op.drop_index('ix_live_feedback_reactions_post', table_name='live_feedback_reactions')
    op.drop_table('live_feedback_reactions')
    op.drop_index('ix_live_feedback_posts_board_created', table_name='live_feedback_posts')
    op.drop_index('ix_live_feedback_posts_board_presenter', table_name='live_feedback_posts')
    op.drop_table('live_feedback_posts')
    op.drop_table('live_feedback_boards')
