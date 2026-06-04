"""add compare_to_round_id to eval_rounds

Revision ID: f1a2c3d4e5f6
Revises: e7c1a9f2b3d4
Create Date: 2026-06-04

후기(FINAL) 라운드가 비교 대상으로 삼는 초기(INITIAL) 라운드 참조.
additive-only: nullable 컬럼 + FK 추가만. 기존 데이터 무손실.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "f1a2c3d4e5f6"
down_revision = "e7c1a9f2b3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "eval_rounds",
        sa.Column("compare_to_round_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_eval_rounds_compare_to",
        "eval_rounds",
        "eval_rounds",
        ["compare_to_round_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_eval_rounds_compare_to", "eval_rounds", type_="foreignkey")
    op.drop_column("eval_rounds", "compare_to_round_id")
