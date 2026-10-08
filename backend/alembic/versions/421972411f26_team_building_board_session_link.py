"""team_building_boards.session_id — 보드↔세션 연결

Revision ID: 421972411f26
Revises: d0e1f2a3b4c6
Create Date: 2026-10-08 00:00:00.000000

보드로 짠 팀을 세션 생성 시 불러오면 해당 세션과 연결한다.
연결된 보드는 다른 보드의 겹침 기준 목록에서 숨김(세션으로 대체).
세션 삭제 시 연결만 해제(SET NULL).
"""
from typing import Sequence, Union

from alembic import op

revision: str = '421972411f26'
down_revision: Union[str, None] = 'd0e1f2a3b4c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE team_building_boards ADD COLUMN IF NOT EXISTS session_id INTEGER "
        "REFERENCES sessions(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE team_building_boards DROP COLUMN IF EXISTS session_id")
