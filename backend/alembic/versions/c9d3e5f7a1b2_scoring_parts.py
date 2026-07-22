"""scoring: 부(파트) 나누기 — 공개 청중 피드백 폼 노출 제어

Revision ID: c9d3e5f7a1b2
Revises: b4e7f1a9c2d6
Create Date: 2026-07-23

- scoring_parts 신규 (라운드별 부)
- scoring_targets.part_id 추가 (팀이 속한 부, NULL=미배정)
- scoring_rounds.active_part_id 추가 (지금 노출할 부, NULL=전체 노출/구버전 호환)
순수 표시용 — 채점·집계 로직은 전혀 건드리지 않는다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c9d3e5f7a1b2'
down_revision: Union[str, None] = 'b4e7f1a9c2d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'scoring_parts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=50), nullable=False),
        sa.Column('order_num', sa.Integer(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scoring_parts_round', 'scoring_parts', ['round_id'])

    op.add_column('scoring_targets', sa.Column('part_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_scoring_targets_part', 'scoring_targets', 'scoring_parts',
        ['part_id'], ['id'], ondelete='SET NULL',
    )

    op.add_column('scoring_rounds', sa.Column('active_part_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_scoring_rounds_active_part', 'scoring_rounds', 'scoring_parts',
        ['active_part_id'], ['id'], ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('fk_scoring_rounds_active_part', 'scoring_rounds', type_='foreignkey')
    op.drop_column('scoring_rounds', 'active_part_id')

    op.drop_constraint('fk_scoring_targets_part', 'scoring_targets', type_='foreignkey')
    op.drop_column('scoring_targets', 'part_id')

    op.drop_index('ix_scoring_parts_round', table_name='scoring_parts')
    op.drop_table('scoring_parts')
