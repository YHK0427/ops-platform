"""superadmin_username_unique: cohort_id IS NULL(슈퍼관리자) 행끼리도 username 유일하게

Revision ID: b8d1e2f3a4c5
Revises: a7c9d0e1f2b3
Create Date: 2026-09-14

기존 UniqueConstraint(cohort_id, username)는 SQL 표준상 NULL끼리는 서로
다른 값 취급이라(Postgres 특성) cohort_id=NULL인 슈퍼관리자 행끼리는 같은
username이 중복 생성될 수 있었다. 부분 unique 인덱스로 그 구멍만 메운다.
"""
from alembic import op

revision = "b8d1e2f3a4c5"
down_revision = "a7c9d0e1f2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_users_superadmin_username",
        "users",
        ["username"],
        unique=True,
        postgresql_where="cohort_id IS NULL",
    )


def downgrade() -> None:
    op.drop_index("uq_users_superadmin_username", table_name="users")
