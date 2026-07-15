"""scoring: 감점 종류 COUNT → DURATION (발표시간 초과·미달)

Revision ID: f7b2c8d1e9a3
Revises: e6a1b2c3d4f5
Create Date: 2026-07-16

감점 규정의 kind 제약을 TIME|COUNT|FLAG → TIME|DURATION|FLAG 로 교체.
"발표시간 초과·미달"은 기준 시간과의 차이를 자동 판정한다.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'f7b2c8d1e9a3'
down_revision: Union[str, None] = 'e6a1b2c3d4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 기존 COUNT 규정이 있으면 DURATION 으로 옮길 수 없으니(설정 형태가 다름) 그냥 삭제 후 제약 교체.
    op.execute("DELETE FROM scoring_deductions WHERE rule_id IN "
               "(SELECT id FROM scoring_deduction_rules WHERE kind = 'COUNT')")
    op.execute("DELETE FROM scoring_deduction_rules WHERE kind = 'COUNT'")
    op.drop_constraint('ck_scoring_deduction_rule_kind', 'scoring_deduction_rules', type_='check')
    op.create_check_constraint(
        'ck_scoring_deduction_rule_kind', 'scoring_deduction_rules',
        "kind IN ('TIME','DURATION','FLAG')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM scoring_deductions WHERE rule_id IN "
               "(SELECT id FROM scoring_deduction_rules WHERE kind = 'DURATION')")
    op.execute("DELETE FROM scoring_deduction_rules WHERE kind = 'DURATION'")
    op.drop_constraint('ck_scoring_deduction_rule_kind', 'scoring_deduction_rules', type_='check')
    op.create_check_constraint(
        'ck_scoring_deduction_rule_kind', 'scoring_deduction_rules',
        "kind IN ('TIME','COUNT','FLAG')",
    )
