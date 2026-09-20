"""개발자 요청 스레드화 — 답글 작성자 표시명

Revision ID: c8e2a5b9d3f1
Revises: b7c4e9a1f2d3
Create Date: 2026-09-20 16:08:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e2a5b9d3f1'
down_revision: Union[str, None] = 'b7c4e9a1f2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "dev_feedback_replies",
        sa.Column("author_display_name", sa.String(length=50), nullable=True),
    )
    # 지금까지는 개발자만 답변할 수 있었으므로 기존 행은 전부 개발자 것이다.
    op.execute("UPDATE dev_feedback_replies SET author_display_name = '개발자' "
               "WHERE author_display_name IS NULL")


def downgrade() -> None:
    op.drop_column("dev_feedback_replies", "author_display_name")
