"""add growth_reflection to eval_assignments

Revision ID: e7c1a9f2b3d4
Revises: d4f12a8e3b07
Create Date: 2026-05-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e7c1a9f2b3d4'
down_revision: Union[str, None] = 'd4f12a8e3b07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'eval_assignments',
        sa.Column('growth_reflection', sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('eval_assignments', 'growth_reflection')
