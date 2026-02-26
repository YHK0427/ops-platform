from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, ForeignKey,
    Integer, String, Text, UniqueConstraint, func, text,
    TIMESTAMP,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class Member(Base):
    __tablename__ = "members"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), nullable=False)
    name_initial = Column(String(10))
    email = Column(String(200))
    tags = Column(ARRAY(String), server_default=text("'{}'"))
    current_deposit = Column(Integer, default=20000)
    total_plus_score = Column(Integer, default=0)   # 항상 ≥ 0
    total_minus_score = Column(Integer, default=0)  # 항상 ≤ 0 (음수 저장)
    net_score = Column(Integer, default=0)           # DB 트리거 자동 갱신
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    deactivated_at = Column(TIMESTAMP(timezone=True))

    # Relationships
    attendances = relationship("Attendance", back_populates="member")
    assignments = relationship("Assignment", back_populates="member")
    ledger_entries = relationship("Ledger", back_populates="member")
    team_memberships = relationship("TeamMember", back_populates="member")


class NaverSession(Base):
    __tablename__ = "naver_sessions"

    id = Column(Integer, primary_key=True)
    storage_json = Column(JSONB, nullable=False)
    is_valid = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    validated_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    expires_hint = Column(TIMESTAMP(timezone=True))


class Session(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True)
    week_num = Column(Integer, nullable=False, unique=True)
    title = Column(String(100), nullable=False)
    date = Column(Date, nullable=False)
    type = Column(String(20), nullable=False)
    config = Column(
        JSONB,
        server_default=text(
            '\'{"has_ppt":true,"has_review":true,"has_feedback":true,"is_holiday":false}\''
        ),
    )
    status = Column(String(20), server_default="SETUP")
    finalized_at = Column(TIMESTAMP(timezone=True))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("type IN ('INDIVIDUAL','TEAM')", name="ck_sessions_type"),
        CheckConstraint(
            "status IN ('SETUP','PREP','OPS','POST','SETTLEMENT','FINALIZED')",
            name="ck_sessions_status",
        ),
    )

    # Relationships
    teams = relationship("Team", back_populates="session", cascade="all, delete-orphan")
    attendances = relationship("Attendance", back_populates="session", cascade="all, delete-orphan")
    assignments = relationship("Assignment", back_populates="session", cascade="all, delete-orphan")
    ledger_entries = relationship("Ledger", back_populates="session")
    team_histories = relationship("TeamHistory", back_populates="session")


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"))
    name = Column(String(50), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    session = relationship("Session", back_populates="teams")
    members = relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")
    assignments = relationship("Assignment", back_populates="team")


class TeamMember(Base):
    __tablename__ = "team_members"

    id = Column(Integer, primary_key=True)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="CASCADE"))
    member_id = Column(Integer, ForeignKey("members.id"))

    __table_args__ = (
        UniqueConstraint("team_id", "member_id", name="uq_team_members"),
    )

    # Relationships
    team = relationship("Team", back_populates="members")
    member = relationship("Member", back_populates="team_memberships")


class TeamHistory(Base):
    __tablename__ = "team_history"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"))
    member_a_id = Column(Integer, ForeignKey("members.id"))
    member_b_id = Column(Integer, ForeignKey("members.id"))

    __table_args__ = (
        CheckConstraint("member_a_id < member_b_id", name="ck_team_history_order"),
        UniqueConstraint("session_id", "member_a_id", "member_b_id", name="uq_team_history"),
    )

    # Relationships
    session = relationship("Session", back_populates="team_histories")


class Assignment(Base):
    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"))
    member_id = Column(Integer, ForeignKey("members.id"))
    team_id = Column(Integer, ForeignKey("teams.id"))  # TEAM 세션 PPT용, 나머지 NULL
    type = Column(String(20), nullable=False)
    target_count = Column(Integer, default=1)
    current_count = Column(Integer, default=0)
    status = Column(String(20), server_default="PENDING")
    scanned_at = Column(TIMESTAMP(timezone=True))
    raw_data = Column(JSONB, server_default=text("'{}'"))
    target_member_ids = Column(ARRAY(Integer), nullable=True)
    # 피드백 대상 member_id 목록. 기본 1명, 결석 시 2명. FEEDBACK 타입에서 사용.

    __table_args__ = (
        CheckConstraint(
            "type IN ('PPT','PPT_EMAIL','REVIEW','FEEDBACK','HOMEWORK')",
            name="ck_assignments_type",
        ),
        CheckConstraint(
            "status IN ('PENDING','PASS','LATE','MISSING','EXEMPT')",
            name="ck_assignments_status",
        ),
        UniqueConstraint("session_id", "member_id", "type", name="uq_assignments"),
    )

    # Relationships
    session = relationship("Session", back_populates="assignments")
    member = relationship("Member", back_populates="assignments")
    team = relationship("Team", back_populates="assignments")


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"))
    member_id = Column(Integer, ForeignKey("members.id"))
    status = Column(String(20), server_default="PENDING")
    excuse_type = Column(String(10))
    excuse_text = Column(Text)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING','PRESENT','LATE_UNDER10','LATE_OVER10','EARLY_LEAVE','ABSENT','EXCUSED')",
            name="ck_attendance_status",
        ),
        CheckConstraint(
            "excuse_type IN ('PRE','POST') OR excuse_type IS NULL",
            name="ck_attendance_excuse_type",
        ),
        UniqueConstraint("session_id", "member_id", name="uq_attendance"),
    )

    # Relationships
    session = relationship("Session", back_populates="attendances")
    member = relationship("Member", back_populates="attendances")


class Ledger(Base):
    __tablename__ = "ledger"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"))  # NULL 허용 (세션 외 수동 처리)
    member_id = Column(Integer, ForeignKey("members.id"))
    type = Column(String(30), nullable=False)
    amount_krw = Column(Integer, default=0)   # 양수=입금, 음수=차감
    score_delta = Column(Integer, default=0)  # 양수=상점, 음수=벌점
    description = Column(Text, nullable=False)
    created_by = Column(String(20), server_default="system")
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    deposit_after = Column(Integer, nullable=False)  # 처리 후 디파짓 잔액 스냅샷

    __table_args__ = (
        CheckConstraint(
            "type IN ('FINE','MILESTONE_FINE','DEPOSIT_RECHARGE','DEPOSIT_ADJUST',"
            "'DEPOSIT_REFUND','MERIT','ADJUSTMENT')",
            name="ck_ledger_type",
        ),
    )

    # Relationships
    session = relationship("Session", back_populates="ledger_entries")
    member = relationship("Member", back_populates="ledger_entries")


class CafePost(Base):
    """네이버 카페 게시판 미러 캐시 (cron 동기화)"""
    __tablename__ = "cafe_posts"

    id = Column(Integer, primary_key=True)
    article_id = Column(Integer, unique=True, nullable=False)
    board_type = Column(String(20), nullable=False)
    title = Column(String(500))
    author_nick = Column(String(100))
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    week_num = Column(Integer, nullable=True)
    posted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    is_deleted = Column(Boolean, default=False)
    first_seen_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    last_synced_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "board_type IN ('REVIEW','HOMEWORK','VIDEO')",
            name="ck_cafe_posts_board_type",
        ),
    )
