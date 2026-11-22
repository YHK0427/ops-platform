"""dev_feedback: 첨부 이미지

Revision ID: c8d2e3f4a5b6
Revises: b7c1d2e3f4a5
Create Date: 2026-11-22

개발자 호출 요청·답글에 스크린샷을 붙일 수 있게 한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c8d2e3f4a5b6'
down_revision: Union[str, None] = 'b7c1d2e3f4a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dev_feedback_images',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('feedback_id', sa.Integer(), sa.ForeignKey('dev_feedback.id', ondelete='CASCADE'), nullable=False),
        sa.Column('reply_id', sa.Integer(), sa.ForeignKey('dev_feedback_replies.id', ondelete='CASCADE'), nullable=True),
        sa.Column('uploader_username', sa.String(50), nullable=False),
        sa.Column('stored_name', sa.String(64), nullable=False),
        sa.Column('content_type', sa.String(100), nullable=False),
        sa.Column('size', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_dev_feedback_images_feedback_id', 'dev_feedback_images', ['feedback_id'])


def downgrade() -> None:
    op.drop_index('ix_dev_feedback_images_feedback_id', 'dev_feedback_images')
    op.drop_table('dev_feedback_images')
