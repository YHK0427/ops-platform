"""add_eval_tables

Revision ID: b33f7a8c1e50
Revises: a22562d3b224
Create Date: 2026-03-12 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b33f7a8c1e50'
down_revision: Union[str, None] = 'a22562d3b224'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('eval_rounds',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('session_id', sa.Integer(), nullable=False),
        sa.Column('round_type', sa.String(length=20), nullable=False),
        sa.Column('title', sa.String(length=100), nullable=False),
        sa.Column('is_open', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('results_open', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('closed_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint("round_type IN ('INITIAL','FINAL')", name='ck_eval_rounds_type'),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('session_id', 'round_type', name='uq_eval_round_session_type'),
    )

    op.create_table('eval_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('round_id', sa.Integer(), nullable=False),
        sa.Column('evaluator_user_id', sa.Integer(), nullable=True),
        sa.Column('presenter_member_id', sa.Integer(), nullable=False),
        sa.Column('eval_type', sa.String(length=20), nullable=False),
        sa.Column('submitted_at', sa.TIMESTAMP(timezone=True), nullable=True),
        sa.CheckConstraint("eval_type IN ('SELF','AUDIENCE')", name='ck_eval_assign_type'),
        sa.ForeignKeyConstraint(['round_id'], ['eval_rounds.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['evaluator_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['presenter_member_id'], ['members.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('round_id', 'evaluator_user_id', 'presenter_member_id', 'eval_type', name='uq_eval_assignment'),
    )

    op.create_table('eval_responses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('assignment_id', sa.Integer(), nullable=False),
        sa.Column('question_key', sa.String(length=30), nullable=False),
        sa.Column('score', sa.Integer(), nullable=False),
        sa.CheckConstraint('score >= 1 AND score <= 5', name='ck_eval_response_score'),
        sa.ForeignKeyConstraint(['assignment_id'], ['eval_assignments.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('assignment_id', 'question_key', name='uq_eval_response_question'),
    )


def downgrade() -> None:
    op.drop_table('eval_responses')
    op.drop_table('eval_assignments')
    op.drop_table('eval_rounds')
