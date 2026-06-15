"""cohort multitenancy: cohorts table + cohort_id on root tables

Revision ID: a7b8c9d0e1f2
Revises: d2e3f4a5b6c7
Create Date: 2026-06-13 00:00:00.000000

기수(Cohort)별 공간 멀티테넌시 도입.
- cohorts 테이블 신설, 33기 시드.
- 루트 6테이블(users/members/sessions/eval_rounds/treasury_expenses/cafe_posts)에 cohort_id 추가.
- 기존 전체 데이터를 33기로 백필. 슈퍼관리자(env ADMIN_USERNAME)는 cohort_id=NULL(전 기수 총괄).
- week_num / article_id unique를 (cohort_id, ...) 복합으로 재구성.
"""
import os
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# cohort_id NOT NULL 대상 (users는 슈퍼관리자 NULL 허용이라 제외)
_NOT_NULL_TABLES = ["members", "sessions", "eval_rounds", "treasury_expenses", "cafe_posts"]
_ALL_TABLES = ["users"] + _NOT_NULL_TABLES


def upgrade() -> None:
    # 1) cohorts 테이블
    op.create_table(
        "cohorts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("is_current", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("archived_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number", name="uq_cohorts_number"),
    )

    # 2) 현재 기수(33기) 시드
    op.execute("INSERT INTO cohorts (number, name, is_current, is_active) VALUES (33, '33기', true, true)")

    # 3) cohort_id 컬럼 추가 (우선 nullable)
    for tbl in _ALL_TABLES:
        op.add_column(tbl, sa.Column("cohort_id", sa.Integer(), nullable=True))

    # 4) 기존 전체 데이터를 33기로 백필
    for tbl in _ALL_TABLES:
        op.execute(f"UPDATE {tbl} SET cohort_id = (SELECT id FROM cohorts WHERE number = 33)")

    # 5) 슈퍼관리자 분리: env ADMIN_USERNAME 계정만 NULL(전 기수 총괄)
    admin_username = os.environ.get("ADMIN_USERNAME", "admin")
    op.execute(
        sa.text("UPDATE users SET cohort_id = NULL WHERE username = :u").bindparams(u=admin_username)
    )

    # 6) FK 생성 (cohort 삭제 시 데이터 보호 위해 RESTRICT)
    for tbl in _ALL_TABLES:
        op.create_foreign_key(
            f"fk_{tbl}_cohort", tbl, "cohorts", ["cohort_id"], ["id"], ondelete="RESTRICT"
        )

    # 7) NOT NULL 전환 (users는 슈퍼관리자 NULL 허용이라 제외)
    for tbl in _NOT_NULL_TABLES:
        op.alter_column(tbl, "cohort_id", existing_type=sa.Integer(), nullable=False)

    # 8) unique 재구성 — week_num / article_id 는 기수 내에서만 유일
    op.drop_constraint("sessions_week_num_key", "sessions", type_="unique")
    op.create_unique_constraint("uq_sessions_cohort_week", "sessions", ["cohort_id", "week_num"])
    op.drop_constraint("cafe_posts_article_id_key", "cafe_posts", type_="unique")
    op.create_unique_constraint("uq_cafe_posts_cohort_article", "cafe_posts", ["cohort_id", "article_id"])
    # users.username / generation_accounts.username 은 전역 unique 유지(로그인 자동판별) — 건드리지 않음

    # 9) 조회 인덱스
    op.create_index("ix_members_cohort", "members", ["cohort_id"])
    op.create_index("ix_sessions_cohort", "sessions", ["cohort_id"])
    op.create_index("ix_eval_rounds_cohort", "eval_rounds", ["cohort_id"])


def downgrade() -> None:
    op.drop_index("ix_eval_rounds_cohort", table_name="eval_rounds")
    op.drop_index("ix_sessions_cohort", table_name="sessions")
    op.drop_index("ix_members_cohort", table_name="members")

    op.drop_constraint("uq_cafe_posts_cohort_article", "cafe_posts", type_="unique")
    op.create_unique_constraint("cafe_posts_article_id_key", "cafe_posts", ["article_id"])
    op.drop_constraint("uq_sessions_cohort_week", "sessions", type_="unique")
    op.create_unique_constraint("sessions_week_num_key", "sessions", ["week_num"])

    for tbl in _ALL_TABLES:
        op.drop_constraint(f"fk_{tbl}_cohort", tbl, type_="foreignkey")
        op.drop_column(tbl, "cohort_id")

    op.drop_table("cohorts")
