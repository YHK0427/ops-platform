"""eval_round_optional_session_combined

Revision ID: c9a1e7f2d301
Revises: b33f7a8c1e50
Create Date: 2026-03-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9a1e7f2d301'
down_revision: Union[str, None] = 'b33f7a8c1e50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Make session_id nullable
    op.alter_column('eval_rounds', 'session_id',
                     existing_type=sa.Integer(),
                     nullable=True)

    # 2. Drop unique constraint (session_id, round_type)
    op.drop_constraint('uq_eval_round_session_type', 'eval_rounds', type_='unique')

    # 3. Drop old check constraint and add new one with COMBINED
    op.drop_constraint('ck_eval_rounds_type', 'eval_rounds', type_='check')
    op.create_check_constraint(
        'ck_eval_rounds_type',
        'eval_rounds',
        "round_type IN ('INITIAL','FINAL','COMBINED')",
    )


def downgrade() -> None:
    # Reverse: restore old check constraint
    op.drop_constraint('ck_eval_rounds_type', 'eval_rounds', type_='check')
    op.create_check_constraint(
        'ck_eval_rounds_type',
        'eval_rounds',
        "round_type IN ('INITIAL','FINAL')",
    )

    # Restore unique constraint
    op.create_unique_constraint(
        'uq_eval_round_session_type',
        'eval_rounds',
        ['session_id', 'round_type'],
    )

    # Make session_id non-nullable again
    op.alter_column('eval_rounds', 'session_id',
                     existing_type=sa.Integer(),
                     nullable=False)
