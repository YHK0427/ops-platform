"""missing_fk_indexes: N+1 조회에서 자주 쓰이는 FK 컬럼에 인덱스 추가

Revision ID: a7c9d0e1f2b3
Revises: f6a8b9c0d1e2
Create Date: 2026-09-14

복합 unique 제약이 있어도 member_id/evaluator_user_id가 두 번째 컬럼이라
단독 필터에는 안 쓰인다. team_members/assignments/attendance/
generation_accounts/cafe_posts.member_id, eval_assignments.evaluator_user_id
에 인덱스 추가.
"""
from alembic import op

revision = "a7c9d0e1f2b3"
down_revision = "f6a8b9c0d1e2"
branch_labels = None
depends_on = None


INDEXES = [
    ("ix_team_members_member_id", "team_members", "member_id"),
    ("ix_assignments_member_id", "assignments", "member_id"),
    ("ix_attendance_member_id", "attendance", "member_id"),
    ("ix_generation_accounts_member_id", "generation_accounts", "member_id"),
    ("ix_cafe_posts_member_id", "cafe_posts", "member_id"),
    ("ix_eval_assignments_evaluator_user_id", "eval_assignments", "evaluator_user_id"),
]


def upgrade() -> None:
    for name, table, column in INDEXES:
        op.create_index(name, table, [column])


def downgrade() -> None:
    for name, table, _ in INDEXES:
        op.drop_index(name, table_name=table)
