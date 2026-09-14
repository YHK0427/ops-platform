"""users/generation_accounts: 전역 unique username → 기수별 unique

기수 분리로 서로 다른 기수에서 같은 아이디(운영진 username, 기수원 username)를
쓰고 싶은 경우가 잦아짐. 전역 unique 제약을 (cohort_id, username) 복합 unique로
완화한다. generation_accounts는 cohort_id 컬럼이 없어 members 조인으로 backfill.

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users: 전역 unique(username) → (cohort_id, username) ──────────────────
    op.drop_constraint("users_username_key", "users", type_="unique")
    op.create_unique_constraint("uq_users_cohort_username", "users", ["cohort_id", "username"])

    # ── generation_accounts: cohort_id 컬럼 추가 + backfill + 복합 unique ──────
    op.add_column("generation_accounts", sa.Column("cohort_id", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE generation_accounts ga
        SET cohort_id = m.cohort_id
        FROM members m
        WHERE m.id = ga.member_id
        """
    )
    op.alter_column("generation_accounts", "cohort_id", nullable=False)
    op.create_foreign_key(
        "fk_generation_accounts_cohort_id", "generation_accounts", "cohorts",
        ["cohort_id"], ["id"], ondelete="RESTRICT",
    )
    op.drop_constraint("generation_accounts_username_key", "generation_accounts", type_="unique")
    op.create_unique_constraint(
        "uq_generation_accounts_cohort_username", "generation_accounts", ["cohort_id", "username"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_generation_accounts_cohort_username", "generation_accounts", type_="unique")
    op.create_unique_constraint("generation_accounts_username_key", "generation_accounts", ["username"])
    op.drop_constraint("fk_generation_accounts_cohort_id", "generation_accounts", type_="foreignkey")
    op.drop_column("generation_accounts", "cohort_id")

    op.drop_constraint("uq_users_cohort_username", "users", type_="unique")
    op.create_unique_constraint("users_username_key", "users", ["username"])
