"""users: scoring_only(외부 임시 · 심사 전용) 역할 추가

Revision ID: d2e4f6a8b0c1
Revises: c9d3e5f7a1b2
Create Date: 2026-07-23

동아리 외부인이 심사 탭만 쓸 수 있게 하는 임시 역할. 접근 제한은 앱 레벨
(backend/app/deps.py의 get_current_user 경로 검사 + require_scoring_staff)에서
강제한다 — 이 마이그레이션은 그 값을 users.role에 저장할 수 있게 CHECK 제약만 넓힌다.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'd2e4f6a8b0c1'
down_revision: Union[str, None] = 'c9d3e5f7a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('ck_users_role', 'users', type_='check')
    op.create_check_constraint(
        'ck_users_role', 'users',
        "role IN ('admin','manager','viewer','scoring_only')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_users_role', 'users', type_='check')
    op.create_check_constraint(
        'ck_users_role', 'users',
        "role IN ('admin','manager','viewer')",
    )
