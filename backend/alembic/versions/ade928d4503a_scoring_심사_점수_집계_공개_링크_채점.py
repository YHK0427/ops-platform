"""scoring: 심사 점수 집계 (공개 링크 채점)

Revision ID: ade928d4503a
Revises: c6d7e8f9a0b1
Create Date: 2026-07-14 13:54:49.121382

주의: autogenerate 원본은 모델에 선언되지 않은 기존 인덱스 12개(ix_members_cohort 등)를
DROP 하는 코드를 함께 만들어냈다. 그건 이 마이그레이션과 무관한 사고이므로 전부 제거했다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'ade928d4503a'
down_revision: Union[str, None] = 'c6d7e8f9a0b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 등수별 기본 배점 — 콜론 뒤 공백 필수(sa.text가 ':1'을 바인드 파라미터로 오인함)
RANK_POINTS_DEFAULT = '\'[{"rank": 1, "points": 2}, {"rank": 2, "points": 1.3}, {"rank": 3, "points": 0.7}]\''


def upgrade() -> None:
    op.create_table(
        'scoring_rounds',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('cohort_id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('intro', sa.Text(), nullable=True),
        sa.Column('public_token', sa.String(length=64), nullable=False),
        sa.Column('is_open', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('opened_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('closed_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('judge_weight', sa.Numeric(precision=6, scale=2), server_default='80', nullable=False),
        sa.Column('observer_weight', sa.Numeric(precision=6, scale=2), server_default='20', nullable=False),
        sa.Column('observer_mode', sa.String(length=20), server_default='RANK', nullable=False),
        sa.Column('rank_points', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text(RANK_POINTS_DEFAULT), nullable=False),
        sa.Column('exclude_own_team', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.CheckConstraint("observer_mode IN ('SCORE','RANK')", name='ck_scoring_round_observer_mode'),
        sa.ForeignKeyConstraint(['cohort_id'], ['cohorts.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('public_token'),
    )
    op.create_index('ix_scoring_rounds_cohort', 'scoring_rounds', ['cohort_id'])

    op.create_table(
        'scoring_criteria',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('max_score', sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column('order_num', sa.Integer(), server_default='0', nullable=False),
        sa.CheckConstraint('max_score > 0', name='ck_scoring_criterion_max_score'),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scoring_criteria_round', 'scoring_criteria', ['round_id'])

    op.create_table(
        'scoring_roster',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('role', sa.String(length=20), server_default='ANY', nullable=False),
        sa.Column('member_id', sa.Integer(), nullable=True),
        sa.Column('note', sa.String(length=100), nullable=True),
        sa.CheckConstraint("role IN ('JUDGE','OBSERVER','ANY')", name='ck_scoring_roster_role'),
        sa.ForeignKeyConstraint(['member_id'], ['members.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scoring_roster_round', 'scoring_roster', ['round_id'])

    op.create_table(
        'scoring_targets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('team_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('order_num', sa.Integer(), server_default='0', nullable=False),
        sa.Column('member_ids', postgresql.ARRAY(sa.Integer()), server_default=sa.text("'{}'"), nullable=False),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['team_id'], ['teams.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_scoring_targets_round', 'scoring_targets', ['round_id'])

    op.create_table(
        'scoring_participants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('entered_name', sa.String(length=50), nullable=False),
        sa.Column('matched_roster_id', sa.Integer(), nullable=True),
        sa.Column('matched_member_id', sa.Integer(), nullable=True),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('is_proxy', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('proxy_by', sa.String(length=50), nullable=True),
        sa.Column('submitted_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column('ip', sa.String(length=45), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.CheckConstraint("role IN ('JUDGE','OBSERVER')", name='ck_scoring_participant_role'),
        sa.ForeignKeyConstraint(['matched_member_id'], ['members.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['matched_roster_id'], ['scoring_roster.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['round_id'], ['scoring_rounds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
    )
    op.create_index('ix_scoring_participants_round', 'scoring_participants', ['round_id'])

    op.create_table(
        'scoring_comments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('participant_id', sa.Integer(), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('criterion_id', sa.Integer(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['criterion_id'], ['scoring_criteria.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['participant_id'], ['scoring_participants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_id'], ['scoring_targets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    # criterion_id가 NULL(총평)일 수 있어 UniqueConstraint가 안 먹는다 → 부분 유니크 인덱스 2개
    op.create_index('uq_scoring_comment_criterion', 'scoring_comments',
                    ['participant_id', 'target_id', 'criterion_id'],
                    unique=True, postgresql_where=sa.text('criterion_id IS NOT NULL'))
    op.create_index('uq_scoring_comment_overall', 'scoring_comments',
                    ['participant_id', 'target_id'],
                    unique=True, postgresql_where=sa.text('criterion_id IS NULL'))

    op.create_table(
        'scoring_ranks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('participant_id', sa.Integer(), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('rank', sa.Integer(), nullable=False),
        sa.CheckConstraint('rank >= 1', name='ck_scoring_rank_positive'),
        sa.ForeignKeyConstraint(['participant_id'], ['scoring_participants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_id'], ['scoring_targets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('participant_id', 'rank', name='uq_scoring_rank_slot'),
        sa.UniqueConstraint('participant_id', 'target_id', name='uq_scoring_rank_target'),
    )

    op.create_table(
        'scoring_scores',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('participant_id', sa.Integer(), nullable=False),
        sa.Column('target_id', sa.Integer(), nullable=False),
        sa.Column('criterion_id', sa.Integer(), nullable=False),
        sa.Column('score', sa.Numeric(precision=6, scale=2), nullable=False),
        sa.ForeignKeyConstraint(['criterion_id'], ['scoring_criteria.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['participant_id'], ['scoring_participants.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['target_id'], ['scoring_targets.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('participant_id', 'target_id', 'criterion_id', name='uq_scoring_score'),
    )


def downgrade() -> None:
    op.drop_table('scoring_scores')
    op.drop_table('scoring_ranks')
    op.drop_index('uq_scoring_comment_overall', table_name='scoring_comments',
                  postgresql_where=sa.text('criterion_id IS NULL'))
    op.drop_index('uq_scoring_comment_criterion', table_name='scoring_comments',
                  postgresql_where=sa.text('criterion_id IS NOT NULL'))
    op.drop_table('scoring_comments')
    op.drop_index('ix_scoring_participants_round', table_name='scoring_participants')
    op.drop_table('scoring_participants')
    op.drop_index('ix_scoring_targets_round', table_name='scoring_targets')
    op.drop_table('scoring_targets')
    op.drop_index('ix_scoring_roster_round', table_name='scoring_roster')
    op.drop_table('scoring_roster')
    op.drop_index('ix_scoring_criteria_round', table_name='scoring_criteria')
    op.drop_table('scoring_criteria')
    op.drop_index('ix_scoring_rounds_cohort', table_name='scoring_rounds')
    op.drop_table('scoring_rounds')
