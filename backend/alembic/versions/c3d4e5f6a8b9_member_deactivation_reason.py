"""members: 비활성 사유(이탈/수료) 컬럼 추가

이탈(delete)과 수료(graduate)가 둘 다 is_active=False로만 남아 구분이 안 됐음
— 과거 세션 열람 시 "이탈했는지 수료했는지" 표시하려면 사유가 필요.

Revision ID: c3d4e5f6a8b9
Revises: b2c3d4e5f6a8
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "c3d4e5f6a8b9"
down_revision = "b2c3d4e5f6a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("members", sa.Column("deactivation_reason", sa.String(length=20), nullable=True))
    op.create_check_constraint(
        "ck_members_deactivation_reason",
        "members",
        "deactivation_reason IN ('WITHDRAWN','GRADUATED') OR deactivation_reason IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_members_deactivation_reason", "members", type_="check")
    op.drop_column("members", "deactivation_reason")
