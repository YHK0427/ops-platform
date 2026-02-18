"""초기 스키마

Revision ID: 2f75826f6c04
Revises:
Create Date: 2026-02-18 16:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2f75826f6c04"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── members ──────────────────────────────────────────
    op.create_table(
        "members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("name_initial", sa.String(10), nullable=True),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String()),
            server_default=sa.text("'{}'"),
            nullable=True,
        ),
        sa.Column("current_deposit", sa.Integer(), nullable=True, default=20000),
        sa.Column("total_plus_score", sa.Integer(), nullable=True, default=0),
        sa.Column("total_minus_score", sa.Integer(), nullable=True, default=0),
        sa.Column("net_score", sa.Integer(), nullable=True, default=0),
        sa.Column("is_active", sa.Boolean(), nullable=True, default=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("deactivated_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── naver_sessions ────────────────────────────────────
    op.create_table(
        "naver_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_json", postgresql.JSONB(), nullable=False),
        sa.Column("is_valid", sa.Boolean(), nullable=True, default=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column(
            "validated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("expires_hint", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── sessions ──────────────────────────────────────────
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("week_num", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column(
            "config",
            postgresql.JSONB(),
            server_default='{"has_ppt":true,"has_review":true,"has_feedback":true,"is_holiday":false}',
            nullable=True,
        ),
        sa.Column("status", sa.String(20), server_default="SETUP", nullable=True),
        sa.Column("finalized_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.CheckConstraint("type IN ('INDIVIDUAL','TEAM')", name="ck_sessions_type"),
        sa.CheckConstraint(
            "status IN ('SETUP','PREP','OPS','POST','SETTLEMENT','FINALIZED')",
            name="ck_sessions_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("week_num"),
    )

    # ── teams ─────────────────────────────────────────────
    op.create_table(
        "teams",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── team_members ──────────────────────────────────────
    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("is_leader", sa.Boolean(), nullable=True, default=False),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("team_id", "member_id", name="uq_team_members"),
    )

    # ── team_history ──────────────────────────────────────
    op.create_table(
        "team_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("member_a_id", sa.Integer(), nullable=True),
        sa.Column("member_b_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.ForeignKeyConstraint(["member_a_id"], ["members.id"]),
        sa.ForeignKeyConstraint(["member_b_id"], ["members.id"]),
        sa.CheckConstraint("member_a_id < member_b_id", name="ck_team_history_order"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "member_a_id", "member_b_id", name="uq_team_history"),
    )

    # ── assignments ───────────────────────────────────────
    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("team_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("target_count", sa.Integer(), nullable=True, default=1),
        sa.Column("current_count", sa.Integer(), nullable=True, default=0),
        sa.Column("status", sa.String(20), server_default="PENDING", nullable=True),
        sa.Column("scanned_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "raw_data",
            postgresql.JSONB(),
            server_default=sa.text("'{}'"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"]),
        sa.CheckConstraint(
            "type IN ('PPT','REVIEW','FEEDBACK','HOMEWORK')",
            name="ck_assignments_type",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING','PASS','LATE','MISSING')",
            name="ck_assignments_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "member_id", "type", name="uq_assignments"),
    )

    # ── attendance ────────────────────────────────────────
    op.create_table(
        "attendance",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), server_default="PENDING", nullable=True),
        sa.Column("excuse_type", sa.String(10), nullable=True),
        sa.Column("excuse_text", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.CheckConstraint(
            "status IN ('PENDING','PRESENT','LATE_UNDER10','LATE_OVER10','EARLY_LEAVE','ABSENT','EXCUSED')",
            name="ck_attendance_status",
        ),
        sa.CheckConstraint(
            "excuse_type IN ('PRE','POST') OR excuse_type IS NULL",
            name="ck_attendance_excuse_type",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "member_id", name="uq_attendance"),
    )

    # ── ledger ────────────────────────────────────────────
    op.create_table(
        "ledger",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("member_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("amount_krw", sa.Integer(), nullable=True, default=0),
        sa.Column("score_delta", sa.Integer(), nullable=True, default=0),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(20), server_default="system", nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("deposit_after", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["members.id"]),
        sa.CheckConstraint(
            "type IN ('FINE','MILESTONE_FINE','DEPOSIT_RECHARGE','DEPOSIT_ADJUST',"
            "'DEPOSIT_REFUND','MERIT','ADJUSTMENT')",
            name="ck_ledger_type",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── net_score 트리거 ──────────────────────────────────
    op.execute("""
    CREATE OR REPLACE FUNCTION sync_net_score() RETURNS TRIGGER AS $$
    BEGIN
        NEW.net_score := NEW.total_plus_score + NEW.total_minus_score;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """)
    op.execute("""
    CREATE TRIGGER trg_sync_net_score
        BEFORE INSERT OR UPDATE OF total_plus_score, total_minus_score
        ON members FOR EACH ROW EXECUTE FUNCTION sync_net_score();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_sync_net_score ON members;")
    op.execute("DROP FUNCTION IF EXISTS sync_net_score;")

    op.drop_table("ledger")
    op.drop_table("attendance")
    op.drop_table("assignments")
    op.drop_table("team_history")
    op.drop_table("team_members")
    op.drop_table("teams")
    op.drop_table("sessions")
    op.drop_table("naver_sessions")
    op.drop_table("members")
