from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, ForeignKey, Index,
    Integer, Numeric, String, Text, UniqueConstraint, func, text,
    TIMESTAMP,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import relationship

from app.database import Base


class Cohort(Base):
    """기수 공간 (33기, 34기 …). 멀티테넌시 루트 — 운영진/기수/세션/평가/장부가 기수별로 격리된다."""
    __tablename__ = "cohorts"

    id = Column(Integer, primary_key=True)
    number = Column(Integer, unique=True, nullable=False)  # 33, 34
    name = Column(String(50), nullable=False)              # "33기"
    is_current = Column(Boolean, server_default="false", nullable=False)  # 신규 계정 시딩·기본값 기준
    is_active = Column(Boolean, server_default="true", nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    archived_at = Column(TIMESTAMP(timezone=True), nullable=True)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    # NULL = 슈퍼관리자(전 기수 총괄). 그 외 운영진은 소속 기수로 스코프.
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=True)
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
            "role IN ('admin','manager','viewer','scoring_only')",
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
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=False)
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
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=False)
    week_num = Column(Integer, nullable=False)  # 기수 내 유일 (uq_sessions_cohort_week)
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
        UniqueConstraint("cohort_id", "week_num", name="uq_sessions_cohort_week"),
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


class TeamBuildingBoard(Base):
    """팀 빌딩 도우미 보드 — 기수당 여러 개(예: 리슨업 팀빌딩, BP 팀빌딩). 진행 상태 저장."""
    __tablename__ = "team_building_boards"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    # {selected_session_ids:[...], num_teams:int, assignment:{memberId: teamIndex|"pool"}, consider:{...}}
    data = Column(JSONB, nullable=False, server_default=text("'{}'"))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


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
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=False)
    amount_krw = Column(Integer, nullable=False)
    description = Column(String(500), nullable=False)
    created_by = Column(String(50))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class CafePost(Base):
    """네이버 카페 게시판 미러 캐시 (cron 동기화)"""
    __tablename__ = "cafe_posts"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=False)
    article_id = Column(Integer, nullable=False)  # 기수 내 유일 (uq_cafe_posts_cohort_article)
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
        UniqueConstraint("cohort_id", "article_id", name="uq_cafe_posts_cohort_article"),
    )


# ── 발표 성장 리포트 ──────────────────────────────────────────────────────────

class EvalRound(Base):
    """평가 라운드 (초기/후기)"""
    __tablename__ = "eval_rounds"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=False)
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
    # 발표자에 포함할 조퇴자(EARLY_LEAVE) member_id 목록 (개별 선택). 결석/공결은 항상 제외.
    early_leave_member_ids = Column(ARRAY(Integer), server_default=text("'{}'"), nullable=False)
    # 보드별 피드백 카테고리 [{key,label,color}] — 기본 칭찬/발전
    categories = Column(
        JSONB,
        nullable=False,
        server_default=text(
            '\'[{"key":"praise","label":"칭찬","color":"emerald"},'
            '{"key":"improve","label":"발전","color":"amber"}]\''
        ),
    )
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
    # 작성자: 기수원(author_member_id) 또는 운영진(author_user_id) 중 하나
    author_member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    presenter_member_id = Column(Integer, ForeignKey("members.id"), nullable=False)
    # 카테고리별 내용 {categoryKey: text} — 최소 1개 필수 (보드 categories 키 기준)
    contents = Column(JSONB, nullable=False)
    is_anonymous = Column(Boolean, default=True, server_default="true", nullable=False)
    is_hidden = Column(Boolean, default=False, server_default="false", nullable=False)  # 운영진 소프트 가림
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("contents <> '{}'::jsonb", name="ck_live_feedback_post_has_content"),
    )

    board = relationship("LiveFeedbackBoard", back_populates="posts")
    author = relationship("Member", foreign_keys=[author_member_id])
    author_user = relationship("User", foreign_keys=[author_user_id])
    presenter = relationship("Member", foreign_keys=[presenter_member_id])
    reactions = relationship("LiveFeedbackReaction", back_populates="post", cascade="all, delete-orphan")


class LiveFeedbackReaction(Base):
    """피드백 글에 대한 이모지 반응 (멤버 1인당 글당 이모지당 1개)."""
    __tablename__ = "live_feedback_reactions"

    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("live_feedback_posts.id", ondelete="CASCADE"), nullable=False)
    # 반응 주체: 기수원(member_id) 또는 운영진(user_id) 중 하나
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    emoji = Column(String(16), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("uq_lf_reaction_member", "post_id", "member_id", "emoji",
              unique=True, postgresql_where=text("member_id IS NOT NULL")),
        Index("uq_lf_reaction_user", "post_id", "user_id", "emoji",
              unique=True, postgresql_where=text("user_id IS NOT NULL")),
    )

    post = relationship("LiveFeedbackPost", back_populates="reactions")


class LiveFeedbackAnonAlias(Base):
    """보드 내 멤버별 익명 닉네임 매핑 (같은 보드에서 같은 작성자는 같은 닉네임, 역추적 불가)."""
    __tablename__ = "live_feedback_anon_aliases"

    id = Column(Integer, primary_key=True)
    board_id = Column(Integer, ForeignKey("live_feedback_boards.id", ondelete="CASCADE"), nullable=False)
    # 익명 작성자: 기수원(member_id) 또는 운영진(user_id) 중 하나
    member_id = Column(Integer, ForeignKey("members.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    alias = Column(String(40), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("uq_lf_alias_member", "board_id", "member_id", unique=True,
              postgresql_where=text("member_id IS NOT NULL")),
        Index("uq_lf_alias_user", "board_id", "user_id", unique=True,
              postgresql_where=text("user_id IS NOT NULL")),
        UniqueConstraint("board_id", "alias", name="uq_live_feedback_alias_unique"),
    )

    board = relationship("LiveFeedbackBoard", back_populates="aliases")


# ── 웹 푸시 알림 + 공지 ────────────────────────────────────────────────────────

class PushSubscription(Base):
    """웹 푸시 구독 — 운영진(User) 또는 기수원(Member) 한 명의 기기에 묶임. 로그아웃 시 삭제."""
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=True)  # 슈퍼관리자=NULL
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    member_id = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    ua = Column(String(300), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("user_id IS NOT NULL OR member_id IS NOT NULL", name="ck_push_sub_user_or_member"),
    )


class Announcement(Base):
    """기수 공지 — 운영진 작성, 게시판형 리치 HTML 본문. 작성 시 대상에 푸시 발송."""
    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)  # DOMPurify로 정제된 HTML
    target = Column(String(20), nullable=False, server_default="members")  # members|staff|all|select
    target_member_ids = Column(ARRAY(Integer), nullable=True)  # target=select 시 대상 멤버
    tags = Column(ARRAY(String), nullable=True)  # 해시태그
    created_by = Column(String(50), nullable=True)  # 표기용 "이름 · 부서"
    author_username = Column(String(50), nullable=True)  # 알림 대상(작성 운영진)
    pushed = Column(Boolean, default=False, server_default="false", nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    reaction_rows = relationship("AnnouncementReaction", back_populates="announcement", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("target IN ('members','staff','all','select')", name="ck_announcement_target"),
    )


class AnnouncementReaction(Base):
    """공지에 대한 기수원의 이모지 반응 (멤버 1인당 공지당 이모지당 1개)."""
    __tablename__ = "announcement_reactions"

    id = Column(Integer, primary_key=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False)
    # 반응 주체: 기수원(member_id) 또는 운영진(user_id) 중 하나만 채워짐
    member_id = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    emoji = Column(String(16), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    announcement = relationship("Announcement", back_populates="reaction_rows")

    __table_args__ = (
        Index("uq_ann_reaction_member", "announcement_id", "member_id", "emoji",
              unique=True, postgresql_where=text("member_id IS NOT NULL")),
        Index("uq_ann_reaction_user", "announcement_id", "user_id", "emoji",
              unique=True, postgresql_where=text("user_id IS NOT NULL")),
    )


class AnnouncementComment(Base):
    """공지에 대한 기수원 댓글."""
    __tablename__ = "announcement_comments"

    id = Column(Integer, primary_key=True)
    announcement_id = Column(Integer, ForeignKey("announcements.id", ondelete="CASCADE"), nullable=False)
    # 댓글 주체: 기수원(member_id) 또는 운영진(user_id) 중 하나만 채워짐
    member_id = Column(Integer, ForeignKey("members.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    content = Column(String(1000), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


# ── 심사·점수 집계 (공개 링크 채점) ────────────────────────────────────────────
# 주의: 여기서 "score"는 심사 점수다. 상벌점(Member.net_score)·평가 리커트
# 점수(EvalResponse.score)와는 완전히 별개 도메인.

class ScoringRound(Base):
    """심사 라운드 — 공개 링크로 배포되는 채점 폼 1개. 세션 연동 또는 독립 이벤트."""
    __tablename__ = "scoring_rounds"

    id = Column(Integer, primary_key=True)
    cohort_id = Column(Integer, ForeignKey("cohorts.id", ondelete="RESTRICT"), nullable=False)
    # NULL = 세션과 무관한 독립 심사 이벤트 (대상 팀을 직접 입력)
    session_id = Column(Integer, ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    intro = Column(Text, nullable=True)  # 참가자에게 보여줄 안내문 (수정 방법 안내 포함)

    public_token = Column(String(64), nullable=False, unique=True)  # secrets.token_urlsafe(32)
    is_open = Column(Boolean, default=False, server_default="false", nullable=False)
    opened_at = Column(TIMESTAMP(timezone=True), nullable=True)
    closed_at = Column(TIMESTAMP(timezone=True), nullable=True)

    # 그룹 총점(비중) — 제출 인원과 무관하게 고정. 실제 제출자 수로 자동 정규화된다.
    judge_weight = Column(Numeric(6, 2), nullable=False, server_default="80")
    observer_weight = Column(Numeric(6, 2), nullable=False, server_default="20")

    observer_mode = Column(String(20), nullable=False, server_default="RANK")  # SCORE|RANK
    # observer_mode='RANK' 일 때 등수 가중치 — **퍼센트**로 표기한다 (합 100).
    # 엔진이 합계로 나눠 정규화하므로 실제로는 상대 비율로만 작동한다.
    # 주의: 콜론 뒤에 공백 필수 — sa.text()는 ':1' 을 바인드 파라미터로 오인해 NULL로 렌더링한다.
    rank_points = Column(
        JSONB,
        nullable=False,
        server_default=text(
            '\'[{"rank": 1, "points": 50}, {"rank": 2, "points": 30}, {"rank": 3, "points": 20}]\''
        ),
    )
    exclude_own_team = Column(Boolean, default=False, server_default="false", nullable=False)
    # 청중(RANK 모드) 전용 — 켜면 팀별 피드백을 모두 채워야 제출된다. 심사위원 총평엔 적용 안 함.
    require_feedback = Column(Boolean, default=False, server_default="false", nullable=False)

    # 청중 소그룹 라벨. 집계에는 영향을 주지 않고 제출현황·결과를 그룹별로 나눠 보기 위한
    # 분류일 뿐이다. 빈 배열이면 그룹을 묻지 않는다. (운영자가 자유롭게 편집 — 아래는 기본값)
    observer_groups = Column(
        JSONB, nullable=False,
        server_default=text('\'["기수", "운영진", "참관위원", "일반청중(OB·기타)"]\''),
    )

    # 청중 피드백 폼에 지금 노출할 부 — NULL이면 부 배정과 무관하게 전체 팀이 보인다(기본/구버전 호환).
    # 부가 삭제되면 DB가 자동으로 NULL로 되돌린다(ondelete=SET NULL).
    active_part_id = Column(Integer, ForeignKey("scoring_parts.id", ondelete="SET NULL"), nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("observer_mode IN ('SCORE','RANK')", name="ck_scoring_round_observer_mode"),
        Index("ix_scoring_rounds_cohort", "cohort_id"),
    )

    areas = relationship(
        "ScoringArea", back_populates="round",
        cascade="all, delete-orphan", order_by="ScoringArea.order_num",
    )
    criteria = relationship(
        "ScoringCriterion", back_populates="round",
        cascade="all, delete-orphan", order_by="ScoringCriterion.order_num",
    )
    targets = relationship(
        "ScoringTarget", back_populates="round",
        cascade="all, delete-orphan", order_by="ScoringTarget.order_num",
    )
    parts = relationship(
        "ScoringPart", back_populates="round", foreign_keys="ScoringPart.round_id",
        cascade="all, delete-orphan", order_by="ScoringPart.order_num",
    )
    # order_by 없으면 추가·삭제할 때마다 조회 순서가 흔들릴 수 있다 — id(생성 순서)로 고정.
    roster = relationship(
        "ScoringRosterEntry", back_populates="round", cascade="all, delete-orphan",
        order_by="ScoringRosterEntry.id",
    )
    participants = relationship("ScoringParticipant", back_populates="round", cascade="all, delete-orphan")
    deduction_rules = relationship(
        "ScoringDeductionRule", back_populates="round",
        cascade="all, delete-orphan", order_by="ScoringDeductionRule.order_num",
    )
    deductions = relationship("ScoringDeduction", back_populates="round", cascade="all, delete-orphan")


class ScoringArea(Base):
    """심사 영역 — 세부항목(ScoringCriterion)의 상위 그룹. 영역 만점 = 세부항목 배점 합.

    영역에 세부항목이 없으면 영역 자체를 하나의 채점 단위로 쓴다(max_score로 통째 채점).
    """
    __tablename__ = "scoring_areas"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    max_score = Column(Numeric(6, 2), nullable=False)  # 세부항목 있으면 그 합과 일치해야 함
    order_num = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        CheckConstraint("max_score > 0", name="ck_scoring_area_max_score"),
        Index("ix_scoring_areas_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="areas")
    criteria = relationship(
        "ScoringCriterion", back_populates="area",
        cascade="all, delete-orphan", order_by="ScoringCriterion.order_num",
    )


class ScoringCriterion(Base):
    """심사 세부항목 — 영역(area) 아래의 채점 라인. area_id=NULL이면 미분류(평면) 기준."""
    __tablename__ = "scoring_criteria"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    # NULL = 미분류(구버전 평면 기준). 값 있으면 해당 영역의 세부항목.
    area_id = Column(Integer, ForeignKey("scoring_areas.id", ondelete="CASCADE"), nullable=True)
    label = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    max_score = Column(Numeric(6, 2), nullable=False)
    order_num = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        CheckConstraint("max_score > 0", name="ck_scoring_criterion_max_score"),
        Index("ix_scoring_criteria_round", "round_id"),
        Index("ix_scoring_criteria_area", "area_id"),
    )

    round = relationship("ScoringRound", back_populates="criteria")
    area = relationship("ScoringArea", back_populates="criteria")


class ScoringPart(Base):
    """심사 라운드의 '부' 나누기 — 팀을 파트별로 묶어 공개 청중 피드백 폼 노출을 제어한다.

    순수 표시/노출 개념이다. 채점·순위·감점·집계 로직에는 절대 영향을 주지 않는다.
    """
    __tablename__ = "scoring_parts"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(50), nullable=False)
    order_num = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        Index("ix_scoring_parts_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="parts", foreign_keys="ScoringPart.round_id")


class ScoringTarget(Base):
    """심사 대상 = 팀. 세션 연동 시 Team에서 임포트, 독립 모드에선 이름만 직접 입력."""
    __tablename__ = "scoring_targets"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)  # 원본/식별용 (세션 팀 이름: "1조")
    # 평가 폼·결과에 실제로 보이는 이름. 비어 있으면 name을 쓴다.
    # 세션을 다시 임포트해도 team_id가 같으면 이 값은 보존된다.
    display_name = Column(String(100), nullable=True)
    order_num = Column(Integer, nullable=False, server_default="0")
    # 이 팀이 속한 부 — NULL(미배정)이면 활성 부가 있어도 청중 피드백 폼엔 안 보인다.
    part_id = Column(Integer, ForeignKey("scoring_parts.id", ondelete="SET NULL"), nullable=True)
    # 자기팀 제외 판정용 스냅샷 (세션 연동 시 TeamMember에서 복사)
    member_ids = Column(ARRAY(Integer), nullable=False, server_default=text("'{}'"))
    # 팀원 이름 스냅샷 — 채점 폼에서 "어느 팀인지" 알아보게 하는 표시용.
    # 이름만 따로 두는 이유: 독립 모드(외부 팀)에는 member_id가 없고, 멤버가 나중에 바뀌어도
    # 심사 당시의 팀 구성이 보존돼야 하기 때문.
    member_names = Column(ARRAY(String), nullable=False, server_default=text("'{}'"))

    __table_args__ = (
        Index("ix_scoring_targets_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="targets")


class ScoringRosterEntry(Base):
    """사전 등록 명단 — 제출자 이름 매칭 + 제출 현황 체크리스트의 기준."""
    __tablename__ = "scoring_roster"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(50), nullable=False)
    role = Column(String(20), nullable=False, server_default="ANY")  # JUDGE|OBSERVER|ANY
    member_id = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)
    note = Column(String(100), nullable=True)  # 소속 등 표시용
    # 이 사람의 기본 소그룹. 제출 시 본인이 안 고르면 이 값을 물려받는다.
    # (기수 멤버 임포트 → "기수", 운영진 임포트 → "운영진" 처럼 한 번에 태깅)
    group_label = Column(String(30), nullable=True)

    __table_args__ = (
        CheckConstraint("role IN ('JUDGE','OBSERVER','ANY')", name="ck_scoring_roster_role"),
        Index("ix_scoring_roster_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="roster")
    member = relationship("Member")


class ScoringParticipant(Base):
    """제출자 — 공개 폼에서 이름을 입력한 심사위원/참관위원 1명 (또는 운영진 대리 입력)."""
    __tablename__ = "scoring_participants"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # JUDGE|OBSERVER
    entered_name = Column(String(50), nullable=False)  # 본인이 입력한 원문 (항상 보존)
    # 참관위원 소그룹 (라운드의 observer_groups 중 하나). 분류용 — 집계에는 영향 없음.
    group_label = Column(String(30), nullable=True)

    # 명단 매칭 결과 — 자동 매칭 후 운영진이 수동 보정 가능
    matched_roster_id = Column(Integer, ForeignKey("scoring_roster.id", ondelete="SET NULL"), nullable=True)
    matched_member_id = Column(Integer, ForeignKey("members.id", ondelete="SET NULL"), nullable=True)

    token = Column(String(64), nullable=False, unique=True)  # 브라우저 저장용 (같은 기기 재접속 복원)
    is_proxy = Column(Boolean, default=False, server_default="false", nullable=False)
    proxy_by = Column(String(50), nullable=True)  # 대리 입력한 운영진 username

    # 자동저장 초안 — {scores, ranks, comments}(SubmissionIn 모양). 정식 제출(POST /submit)
    # 전까지는 이 컬럼에만 쌓이고 scoring_scores/ranks/comments·submitted_at엔 반영 안 된다.
    # 즉 제출현황·집계엔 안 잡힌다. 정식 제출 시 커밋되며 이 필드는 비운다.
    draft = Column(JSONB, nullable=True)

    submitted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    ip = Column(String(45), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("role IN ('JUDGE','OBSERVER')", name="ck_scoring_participant_role"),
        Index("ix_scoring_participants_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="participants")
    matched_roster = relationship("ScoringRosterEntry")
    matched_member = relationship("Member")
    scores = relationship("ScoringScore", back_populates="participant", cascade="all, delete-orphan")
    ranks = relationship("ScoringRank", back_populates="participant", cascade="all, delete-orphan")
    comments = relationship("ScoringComment", back_populates="participant", cascade="all, delete-orphan")


class ScoringScore(Base):
    """점수 — 제출자 × 대상팀 × (세부항목 또는 영역통째).

    한 행은 셋 중 하나:
    - criterion_id 有 / area_id 無  → 미분류(평면) 기준 점수
    - criterion_id 有 / area_id 有  → 영역 세부항목 점수
    - criterion_id 無 / area_id 有  → 영역 통째 점수(세부항목별로 안 매기는 심사위원)
    """
    __tablename__ = "scoring_scores"

    id = Column(Integer, primary_key=True)
    participant_id = Column(Integer, ForeignKey("scoring_participants.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("scoring_targets.id", ondelete="CASCADE"), nullable=False)
    area_id = Column(Integer, ForeignKey("scoring_areas.id", ondelete="CASCADE"), nullable=True)
    criterion_id = Column(Integer, ForeignKey("scoring_criteria.id", ondelete="CASCADE"), nullable=True)
    score = Column(Numeric(6, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("criterion_id IS NOT NULL OR area_id IS NOT NULL",
                        name="ck_scoring_score_target"),
        # 세부항목/미분류 점수: 제출자·팀·세부항목당 1개
        Index("uq_scoring_score_criterion", "participant_id", "target_id", "criterion_id",
              unique=True, postgresql_where=text("criterion_id IS NOT NULL")),
        # 영역 통째 점수: 제출자·팀·영역당 1개
        Index("uq_scoring_score_area", "participant_id", "target_id", "area_id",
              unique=True, postgresql_where=text("criterion_id IS NULL")),
    )

    participant = relationship("ScoringParticipant", back_populates="scores")


class ScoringRank(Base):
    """참관위원 등수 선택 (observer_mode='RANK') — 제출자당 등수 1개, 팀 1개."""
    __tablename__ = "scoring_ranks"

    id = Column(Integer, primary_key=True)
    participant_id = Column(Integer, ForeignKey("scoring_participants.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("scoring_targets.id", ondelete="CASCADE"), nullable=False)
    rank = Column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("participant_id", "rank", name="uq_scoring_rank_slot"),
        UniqueConstraint("participant_id", "target_id", name="uq_scoring_rank_target"),
        CheckConstraint("rank >= 1", name="ck_scoring_rank_positive"),
    )

    participant = relationship("ScoringParticipant", back_populates="ranks")


class ScoringComment(Base):
    """서술형 피드백 — criterion_id NULL이면 팀 총평, 값이 있으면 해당 기준에 대한 코멘트."""
    __tablename__ = "scoring_comments"

    id = Column(Integer, primary_key=True)
    participant_id = Column(Integer, ForeignKey("scoring_participants.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("scoring_targets.id", ondelete="CASCADE"), nullable=False)
    criterion_id = Column(Integer, ForeignKey("scoring_criteria.id", ondelete="CASCADE"), nullable=True)
    body = Column(Text, nullable=False)

    __table_args__ = (
        # criterion_id는 NULL(총평)일 수 있어 UniqueConstraint가 안 먹는다 → 부분 유니크 인덱스 2개
        Index("uq_scoring_comment_criterion", "participant_id", "target_id", "criterion_id",
              unique=True, postgresql_where=text("criterion_id IS NOT NULL")),
        Index("uq_scoring_comment_overall", "participant_id", "target_id",
              unique=True, postgresql_where=text("criterion_id IS NULL")),
    )

    participant = relationship("ScoringParticipant", back_populates="comments")


class ScoringDeductionRule(Base):
    """감점 규정 정의 — 운영자가 라운드마다 만든다. 팀별 적용은 ScoringDeduction.

    kind별 config(JSONB):
    - TIME (발표자료 지각): {deadline, mode:"INTERVAL"|"STEPS", interval_minutes, interval_points,
             max_points?, steps:[{after_minutes, points, disqualify?}], disqualify_after_minutes?}
      → 팀 input {submitted_at} 로 마감 대비 지연분을 자동 판정
    - DURATION (발표시간 초과·미달): {target_seconds, tolerance_seconds, unit_seconds, unit_points, max_points?}
      → 팀 input {actual_seconds}. 기준 시간과의 차이가 허용오차를 넘으면 단위마다 감점
    - FLAG (형식 미준수 등): {points}  → 팀 input {checked}
    """
    __tablename__ = "scoring_deduction_rules"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    kind = Column(String(20), nullable=False)  # TIME|DURATION|FLAG
    config = Column(JSONB, nullable=False, server_default=text("'{}'"))
    order_num = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        CheckConstraint("kind IN ('TIME','DURATION','FLAG')", name="ck_scoring_deduction_rule_kind"),
        Index("ix_scoring_deduction_rules_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="deduction_rules")


class ScoringDeduction(Base):
    """팀별 감점 적용값 — 운영자 입력. points·disqualified 는 규정 config로 서버가 계산해 캐시."""
    __tablename__ = "scoring_deductions"

    id = Column(Integer, primary_key=True)
    round_id = Column(Integer, ForeignKey("scoring_rounds.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("scoring_targets.id", ondelete="CASCADE"), nullable=False)
    rule_id = Column(Integer, ForeignKey("scoring_deduction_rules.id", ondelete="CASCADE"), nullable=False)
    input = Column(JSONB, nullable=False, server_default=text("'{}'"))
    points = Column(Numeric(6, 2), nullable=False, server_default="0")  # 감점(양수 = 그만큼 차감)
    disqualified = Column(Boolean, default=False, server_default="false", nullable=False)
    note = Column(String(200), nullable=True)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("target_id", "rule_id", name="uq_scoring_deduction"),
        Index("ix_scoring_deductions_round", "round_id"),
    )

    round = relationship("ScoringRound", back_populates="deductions")
    rule = relationship("ScoringDeductionRule")
