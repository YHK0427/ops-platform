"""add_group_num_to_attendance

Revision ID: 489add7af901
Revises: c9a1e7f2d301
Create Date: 2026-03-25 17:12:53.125389

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '489add7af901'
down_revision: Union[str, None] = 'c9a1e7f2d301'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('attendance', sa.Column('group_num', sa.Integer(), nullable=True))
    op.create_check_constraint(
        'ck_attendance_group_num',
        'attendance',
        'group_num IN (1, 2) OR group_num IS NULL',
    )


def downgrade() -> None:
    op.drop_constraint('ck_attendance_group_num', 'attendance', type_='check')
    op.drop_column('attendance', 'group_num')
