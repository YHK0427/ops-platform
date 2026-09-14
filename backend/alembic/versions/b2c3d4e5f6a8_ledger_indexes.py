"""ledger: member_id, session_id 인덱스 추가

recalculate_deposit_after(멤버당 전체 이력 재계산 — merit/penalty/adjust/정산
확정마다 호출)와 my-ledger 조회가 매번 member_id로 필터하는데 인덱스가 없어
ledger 테이블 전체를 시퀀셜 스캔하고 있었음(누적 테이블이라 시즌이 지날수록
악화). session_id도 delete_session 등에서 동일하게 필터됨.

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f6
Create Date: 2026-09-14
"""
from alembic import op

revision = "b2c3d4e5f6a8"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_ledger_member_id", "ledger", ["member_id"])
    op.create_index("ix_ledger_session_id", "ledger", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_ledger_session_id", table_name="ledger")
    op.drop_index("ix_ledger_member_id", table_name="ledger")
