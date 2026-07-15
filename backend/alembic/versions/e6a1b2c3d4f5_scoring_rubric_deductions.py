"""scoring: 계층형 기준(영역/세부항목) + 영역통째 점수 + 동적 감점 규정

Revision ID: e6a1b2c3d4f5
Revises: d5b8e0a3126c
Create Date: 2026-07-16

- scoring_areas 신규 (심사 영역)
- scoring_criteria.area_id 추가 (세부항목 → 영역 소속, NULL=미분류 평면 기준)
- scoring_scores: area_id 추가 + criterion_id nullable + 유니크 재편
  (기존 uq_scoring_score 단일 유니크 → 부분 유니크 2개, 영역통째 점수 허용)
- scoring_deduction_rules / scoring_deductions 신규 (동적 감점)
- scoring_rounds.observer_groups 기본값 교체 (청중 소그룹)

주의: autogenerate는 모델 밖 인덱스를 DROP하는 코드를 만들어내므로 손으로 작성함.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'e6a1b2c3d4f5'
down_revision: Union[str, None] = 'd5b8e0a3126c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OBS_GROUPS_NEW = '\'["기수", "운영진", "참관위원", "일반청중(OB·기타)"]\''
OBS_GROUPS_OLD = '\'["운영진", "기수", "청중"]\''


def upgrade() -> None:
    # ── 심사 영역 ──
    op.create_table(
        'scoring_areas',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('max_score', sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column('order_num', sa.Integer(), server_default='0', nullable=False),
        sa.CheckConstraint('max_score > 0', name='ck_scoring_area_max_score'),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scoring_areas_round', 'scoring_areas', ['round_id'])

    # ── 세부항목 → 영역 소속 ──
    op.add_column('scoring_criteria', sa.Column('area_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_scoring_criteria_area', 'scoring_criteria', 'scoring_areas',
        ['area_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index('ix_scoring_criteria_area', 'scoring_criteria', ['area_id'])

    # ── 점수: 영역통째 지원 ──
    op.add_column('scoring_scores', sa.Column('area_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_scoring_scores_area', 'scoring_scores', 'scoring_areas',
        ['area_id'], ['id'], ondelete='CASCADE',
    )
    op.alter_column('scoring_scores', 'criterion_id', existing_type=sa.Integer(), nullable=True)
    # 기존 단일 유니크 제약 → 부분 유니크 인덱스 2개로 교체
    op.drop_constraint('uq_scoring_score', 'scoring_scores', type_='unique')
    op.create_check_constraint(
        'ck_scoring_score_target', 'scoring_scores',
        'criterion_id IS NOT NULL OR area_id IS NOT NULL',
    )
    op.create_index('uq_scoring_score_criterion', 'scoring_scores',
                    ['participant_id', 'target_id', 'criterion_id'],
                    unique=True, postgresql_where=sa.text('criterion_id IS NOT NULL'))
    op.create_index('uq_scoring_score_area', 'scoring_scores',
                    ['participant_id', 'target_id', 'area_id'],
                    unique=True, postgresql_where=sa.text('criterion_id IS NULL'))

    # ── 감점 규정 ──
    op.create_table(
        'scoring_deduction_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('config', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'"), nullable=False),
        sa.Column('order_num', sa.Integer(), server_default='0', nullable=False),
        sa.CheckConstraint("kind IN ('TIME','COUNT','FLAG')", name='ck_scoring_deduction_rule_kind'),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scoring_deduction_rules_round', 'scoring_deduction_rules', ['round_id'])

    op.create_table(
        'scoring_deductions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('rule_id', sa.Integer(), nullable=False),
        sa.Column('input', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'"), nullable=False),
        sa.Column('points', sa.Numeric(precision=6, scale=2), server_default='0', nullable=False),
        sa.Column('disqualified', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('note', sa.String(length=200), nullable=True),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_id'], ['scoring_targets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['rule_id'], ['scoring_deduction_rules.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('target_id', 'rule_id', name='uq_scoring_deduction'),
    )
    op.create_index('ix_scoring_deductions_round', 'scoring_deductions', ['round_id'])

    # ── 청중 소그룹 기본값 교체 ──
    op.execute(f"ALTER TABLE scoring_rounds ALTER COLUMN observer_groups SET DEFAULT {OBS_GROUPS_NEW}::jsonb")


def downgrade() -> None:
    op.execute(f"ALTER TABLE scoring_rounds ALTER COLUMN observer_groups SET DEFAULT {OBS_GROUPS_OLD}::jsonb")

    op.drop_index('ix_scoring_deductions_round', table_name='scoring_deductions')
    op.drop_table('scoring_deductions')
    op.drop_index('ix_scoring_deduction_rules_round', table_name='scoring_deduction_rules')
    op.drop_table('scoring_deduction_rules')

    op.drop_index('uq_scoring_score_area', table_name='scoring_scores',
                  postgresql_where=sa.text('criterion_id IS NULL'))
    op.drop_index('uq_scoring_score_criterion', table_name='scoring_scores',
                  postgresql_where=sa.text('criterion_id IS NOT NULL'))
    op.drop_constraint('ck_scoring_score_target', 'scoring_scores', type_='check')
    # criterion_id NULL 행(영역통째)이 있으면 되돌릴 수 없으므로 삭제 후 NOT NULL 복원
    op.execute('DELETE FROM scoring_scores WHERE criterion_id IS NULL')
    op.alter_column('scoring_scores', 'criterion_id', existing_type=sa.Integer(), nullable=False)
    op.create_unique_constraint('uq_scoring_score', 'scoring_scores',
                                ['participant_id', 'target_id', 'criterion_id'])
    op.drop_constraint('fk_scoring_scores_area', 'scoring_scores', type_='foreignkey')
    op.drop_column('scoring_scores', 'area_id')

    op.drop_index('ix_scoring_criteria_area', table_name='scoring_criteria')
    op.drop_constraint('fk_scoring_criteria_area', 'scoring_criteria', type_='foreignkey')
    op.drop_column('scoring_criteria', 'area_id')

    op.drop_index('ix_scoring_areas_round', table_name='scoring_areas')
    op.drop_table('scoring_areas')
