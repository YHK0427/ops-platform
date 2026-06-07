from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, ForeignKey,
    Integer, String, Text, UniqueConstraint, func, text,
    TIMESTAMP,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    display_name = Column(String(50), nullable=False)
    role = Column(String(20), nullable=False, server_default="viewer")
    department = Column(String(30), nullable=True)  # 운영진 부서: 회장단, 인홍부, 학술부, 기획부, 총무부
    totp_secret = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "role IN ('admin','manager','viewer')",
            name="ck_users_role",
        ),
    )


class GenerationAccount(Base):
    """기수 멤버 전용 계정 (ops 시스템과 무관)"""
    __tablename__ = "generation_accounts"

    id = Column(Integer, primary_key=True)
    member_id = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    username = Column(String(50), unique=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    is_active = Column(Boolean, default=True, server_default="true", nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    member = relationship("Member", backref="generation_account")


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
            '\'{"has_ppt_email":true,"has_ppt":true,"has_review":true,"has_feedback":true,"is_holiday":false}\''
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
    presenter_order = Column(Integer)  # 발표 순서 (NULL = 미지정)
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
    note = Column(Text)  # 자유 메모 (예: 도착 시간)
    group_num = Column(Integer)  # 분반: 1 or 2, NULL = 분반 없음
    presenter_order = Column(Integer)  # 분반 내 발표 순서 (NULL = 미지정)
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
        CheckConstraint(
            "group_num IN (1, 2) OR group_num IS NULL",
            name="ck_attendance_group_num",
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
    is_paid = Column(Boolean, nullable=True)  # MILESTONE_FINE 납부 여부

    __table_args__ = (
        CheckConstraint(
            "type IN ('FINE','MILESTONE_FINE','DEPOSIT_RECHARGE','DEPOSIT_ADJUST',"
            "'DEPOSIT_REFUND','DEPOSIT_FORFEIT','MERIT','ADJUSTMENT')",
            name="ck_ledger_type",
        ),
    )

    # Relationships
    session = relationship("Session", back_populates="ledger_entries")
    member = relationship("Member", back_populates="ledger_entries")


class TreasuryExpense(Base):
    """금고 지출 기록"""
    __tablename__ = "treasury_expenses"

    id = Column(Integer, primary_key=True)
    amount_krw = Column(Integer, nullable=False)
    description = Column(String(500), nullable=False)
    created_by = Column(String(50))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


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
            "board_type IN ('REVIEW','PPT','VIDEO')",
            name="ck_cafe_posts_board_type",
        ),
    )


# ── 발표 성장 리포트 ──────────────────────────────────────────────────────────

class EvalRound(Base):
    """평가 라운드 (초기/후기)"""
    __tablename__ = "eval_rounds"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id"), nullable=True)
    round_type = Column(String(20), nullable=False)
    title = Column(String(100), nullable=False)
    is_open = Column(Boolean, default=False, server_default="false", nullable=False)
    results_open = Column(Boolean, default=False, server_default="false", nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    closed_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # 후기(FINAL) 라운드가 비교 대상으로 삼는 초기(INITIAL) 라운드. NULL이면 단일 리포트.
    compare_to_round_id = Column(
        Integer, ForeignKey("eval_rounds.id", ondelete="SET NULL"), nullable=True
    )
    # 결과 공개 시에도 결과를 숨길 멤버 id 목록(예: 당일 결석자). NULL/빈배열이면 전원 공개.
    hidden_member_ids = Column(ARRAY(Integer), nullable=True)

    __table_args__ = (
        CheckConstraint("round_type IN ('INITIAL','FINAL','COMBINED')", name="ck_eval_rounds_type"),
    )

    session = relationship("Session")
    assignments = relationship("EvalAssignment", back_populates="round", cascade="all, delete-orphan")


class EvalAssignment(Base):
    """평가 배정 (자기평가/청중평가)"""
    __tablename__ = "eval_assignments"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("eval_rounds.id", ondelete="CASCADE"), nullable=False)
    evaluator_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    presenter_member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    eval_type = Column(String(20), nullable=False)
    submitted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    # FINAL 라운드 SELF 평가에서 입력하는 성장 회고 서술형 (그 외에는 NULL)
    growth_reflection = Column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("eval_type IN ('SELF','AUDIENCE')", name="ck_eval_assign_type"),
        UniqueConstraint(
            "round_id", "evaluator_user_id", "presenter_member_id", "eval_type",
            name="uq_eval_assignment",
        ),
    )

    round = relationship("EvalRound", back_populates="assignments")
    evaluator = relationship("User")
    presenter = relationship("Member")
    responses = relationship("EvalResponse", back_populates="assignment", cascade="all, delete-orphan")


class EvalResponse(Base):
    """평가 응답 (문항별 점수)"""
    __tablename__ = "eval_responses"

    id = Column(Integer, primary_key=True)
    assignment_id = Column(Integer, ForeignKey("eval_assignments.id", ondelete="CASCADE"), nullable=False)
    question_key = Column(String(30), nullable=False)
    score = Column(Integer, nullable=False)

    __table_args__ = (
        CheckConstraint("score >= 1 AND score <= 5", name="ck_eval_response_score"),
        UniqueConstraint("assignment_id", "question_key", name="uq_eval_response_question"),
    )

    assignment = relationship("EvalAssignment", back_populates="responses")


# ── 실시간 익명 상호 피드백 (Padlet 스타일) ────────────────────────────────────
# 주의: 기존 Assignment.type='FEEDBACK'(세션 후 네이버 카페 댓글 과제)와 완전히 별개.

class LiveFeedbackBoard(Base):
    """세션별 실시간 피드백 보드 (개인/분반 세션 전용). EvalRound 라이프사이클 미러링."""
    __tablename__ = "live_feedback_boards"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True)
    title = Column(String(100), nullable=False)
    is_open = Column(Boolean, default=False, server_default="false", nullable=False)  # 공개/비공개
    # 조퇴자(EARLY_LEAVE)를 발표자 목록에 포함할지 (결석/공결은 항상 제외)
    include_early_leave = Column(Boolean, default=False, server_default="false", nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    closed_at = Column(TIMESTAMP(timezone=True), nullable=True)

    session = relationship("Session")
    posts = relationship("LiveFeedbackPost", back_populates="board", cascade="all, delete-orphan")
    aliases = relationship("LiveFeedbackAnonAlias", back_populates="board", cascade="all, delete-orphan")


class LiveFeedbackPost(Base):
    """피드백 글 — 작성자(author)는 항상 저장(운영진 실명용), is_anonymous로 멤버 노출만 제어."""
    __tablename__ = "live_feedback_posts"

    id = Column(Integer, primary_key=True)
    board_id = Column(Integer, ForeignKey("live_feedback_boards.id", ondelete="CASCADE"), nullable=False)
    author_member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    presenter_member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    # 칭찬·발전을 한 피드백에 함께 담을 수 있음(각각 선택, 최소 1개 필수)
    praise_content = Column(Text, nullable=True)
    improve_content = Column(Text, nullable=True)
    is_anonymous = Column(Boolean, default=True, server_default="true", nullable=False)
    is_hidden = Column(Boolean, default=False, server_default="false", nullable=False)  # 운영진 소프트 가림
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "praise_content IS NOT NULL OR improve_content IS NOT NULL",
            name="ck_live_feedback_post_has_content",
        ),
    )

    board = relationship("LiveFeedbackBoard", back_populates="posts")
    author = relationship("Member", foreign_keys=[author_member_id])
    presenter = relationship("Member", foreign_keys=[presenter_member_id])
    reactions = relationship("LiveFeedbackReaction", back_populates="post", cascade="all, delete-orphan")


class LiveFeedbackReaction(Base):
    """피드백 글에 대한 이모지 반응 (멤버 1인당 글당 이모지당 1개)."""
    __tablename__ = "live_feedback_reactions"

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("live_feedback_posts.id", ondelete="CASCADE"), nullable=False)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    emoji = Column(String(16), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("post_id", "member_id", "emoji", name="uq_live_feedback_reaction"),
    )

    post = relationship("LiveFeedbackPost", back_populates="reactions")


class LiveFeedbackAnonAlias(Base):
    """보드 내 멤버별 익명 닉네임 매핑 (같은 보드에서 같은 작성자는 같은 닉네임, 역추적 불가)."""
    __tablename__ = "live_feedback_anon_aliases"

    id = Column(Integer, primary_key=True)
    board_id = Column(Integer, ForeignKey("live_feedback_boards.id", ondelete="CASCADE"), nullable=False)
    member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    alias = Column(String(40), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("board_id", "member_id", name="uq_live_feedback_alias_member"),
        UniqueConstraint("board_id", "alias", name="uq_live_feedback_alias_unique"),
    )

    board = relationship("LiveFeedbackBoard", back_populates="aliases")
