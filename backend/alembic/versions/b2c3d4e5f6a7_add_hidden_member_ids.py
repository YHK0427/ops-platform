"""add hidden_member_ids to eval_rounds

Revision ID: b2c3d4e5f6a7
Revises: f1a2c3d4e5f6
Create Date: 2026-06-05

결과 공개 시에도 특정 멤버(당일 결석자 등) 결과를 숨기기 위한 멤버 id 배열.
additive-only: nullable 컬럼 추가. 기존 데이터 무손실.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b2c3d4e5f6a7"
down_revision = "f1a2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "eval_rounds",
        sa.Column("hidden_member_ids", postgresql.ARRAY(sa.Integer()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("eval_rounds", "hidden_member_ids")
