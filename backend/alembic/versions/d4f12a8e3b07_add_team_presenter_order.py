"""add_team_presenter_order

Revision ID: d4f12a8e3b07
Revises: 078854a32784
Create Date: 2026-05-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f12a8e3b07'
down_revision: Union[str, None] = '078854a32784'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('teams', sa.Column('presenter_order', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('teams', 'presenter_order')
