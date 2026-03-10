"""rename_cafe_posts_homework_to_ppt

Revision ID: 4f4d23d93d94
Revises: 85d70b6a7265
Create Date: 2026-03-10 06:25:01.669071

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4f4d23d93d94'
down_revision: Union[str, None] = '85d70b6a7265'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. 기존 HOMEWORK 데이터를 PPT로 변환
    op.execute("UPDATE cafe_posts SET board_type = 'PPT' WHERE board_type = 'HOMEWORK'")
    # 2. 기존 check constraint 삭제 후 새로 생성
    op.drop_constraint("ck_cafe_posts_board_type", "cafe_posts", type_="check")
    op.create_check_constraint(
        "ck_cafe_posts_board_type",
        "cafe_posts",
        "board_type IN ('REVIEW','PPT','VIDEO')",
    )


def downgrade() -> None:
    op.execute("UPDATE cafe_posts SET board_type = 'HOMEWORK' WHERE board_type = 'PPT'")
    op.drop_constraint("ck_cafe_posts_board_type", "cafe_posts", type_="check")
    op.create_check_constraint(
        "ck_cafe_posts_board_type",
        "cafe_posts",
        "board_type IN ('REVIEW','HOMEWORK','VIDEO')",
    )
