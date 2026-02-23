from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models import Assignment, Attendance, Member, Session

# ------------------------------------------------------------------
# Penalty Matrix (Spec B-2 그대로 구현)
# ------------------------------------------------------------------
# (status, excuse_type) -> (score_delta, deposit_delta)
ATTENDANCE_MATRIX = {
    # 지각 (10분 미만)
    ("LATE_UNDER10", "PRE"):  (-1, -2000),
    ("LATE_UNDER10", "POST"): (-1, -3000),
    ("LATE_UNDER10", None):   (-1, -4000),
    # 지각 (10분 이상)
    ("LATE_OVER10",  "PRE"):  (-2, -2000),
    ("LATE_OVER10",  "POST"): (-2, -3000),
    ("LATE_OVER10",  None):   (-2, -4000),
    # 조퇴
    ("EARLY_LEAVE",  "PRE"):  (-2, -2000),
    ("EARLY_LEAVE",  "POST"): (-2, -3000),
    ("EARLY_LEAVE",  None):   (-2, -4000),
    # 결석
    ("ABSENT",       "PRE"):  (-4, -4000),
    ("ABSENT",       "POST"): (-4, -6000),
    ("ABSENT",       None):   (-4, -8000),
    # 면제 / 출석
    ("EXCUSED",      None):   (0,  0),
    ("PRESENT",      None):   (0,  0),
}

PPT_MATRIX = {
    "PASS":    (0, 0),
    "LATE":    (-1, -1000),
    "MISSING": (-2, -3000),
}

HOMEWORK_PENALTY = (-1, -1000)   # 셋 중 하나라도 MISSING이면 동일하게 적용


@dataclass
class PenaltyItem:
    type: str  # ATTENDANCE, PPT, HOMEWORK, MILESTONE_FINE
    member: Member
    score_delta: int
    deposit_delta: int
    description: str


class PenaltyEngine:
    def __init__(self, session: Session, db: AsyncSession):
        self.session = session
        self.db = db

    async def calculate_all(self) -> list[PenaltyItem]:
        """세션의 모든 멤버에 대해 페널티 계산"""
        penalties = []
        
        # 활성 멤버 조회
        stmt = select(Member).where(Member.is_active == True)
        result = await self.db.execute(stmt)
        members = result.scalars().all()

        for member in members:
            # 1. 출석 정보 조회
            att_stmt = select(Attendance).where(
                Attendance.session_id == self.session.id,
                Attendance.member_id == member.id
            )
            att_res = await self.db.execute(att_stmt)
            att = att_res.scalar_one_or_none()

            att_status = att.status if att else "ABSENT"  # 출석 없으면 결석 처리? (보통 기본값 PRESENT나 입력 필요)
            # 여기서는 출석 없으면 일단 PRESENT로 가정? 아니면 입력 안됨?
            # 규칙상 출석 데이터는 항상 있어야 함. 없으면 기본값?
            # 일단, 출석 데이터가 없으면 'PRESENT'로 가정하거나 무시?
            # -> 출석부 생성 시 기본값이 있으므로, 없으면 에러일 수 있음. 여기서는 'None' 처리
            if not att:
                # 출석 데이터가 없으면 페널티 계산 스킵? (아직 출석체크 안함)
                # 하지만 Finalize 시점에는 반드시 있어야 함.
                att_status = "PRESENT"
                excuse_type = None
            else:
                att_status = att.status
                excuse_type = att.excuse_type

            # 2. 과제 정보 조회 (PPT, REVIEW, HOMEWORK, FEEDBACK)
            assign_stmt = select(Assignment).where(
                Assignment.session_id == self.session.id,
                Assignment.member_id == member.id
            )
            assign_res = await self.db.execute(assign_stmt)
            assignments = {a.type: a for a in assign_res.scalars().all()}
            
            ppt = assignments.get("PPT")
            review = assignments.get("REVIEW")
            hw = assignments.get("HOMEWORK")
            fb = assignments.get("FEEDBACK")

            is_excused = att_status == "EXCUSED"

            # --- 페널티 계산 ---

            # [출결]
            # excuse_type이 None이면 None으로, 아니면 값 그대로
            key = (att_status, excuse_type if excuse_type else None)
            # ATTENDANCE_MATRIX 키에 (status, None) 형태가 많으므로 주의
            # DB에는 excuse_type이 NULL일 수 있음.
            
            # 매트릭스 조회
            if key in ATTENDANCE_MATRIX:
                score_d, dep_d = ATTENDANCE_MATRIX[key]
            else:
                # 키가 없으면 (예: EXCUSED에 사유서가 달려있거나?) -> 기본값 0
                # 하지만 EXCUSED는 항상 (0,0)
                if att_status == "EXCUSED":
                    score_d, dep_d = (0, 0)
                elif att_status == "PRESENT":
                    score_d, dep_d = (0, 0)
                else:
                    # 매트릭스에 없는 케이스 (예: LATE_UNDER10인데 excuse_type이 이상함)
                    # Fallback to None key
                    score_d, dep_d = ATTENDANCE_MATRIX.get((att_status, None), (0, 0))

            if score_d != 0 or dep_d != 0:
                penalties.append(PenaltyItem(
                    type="ATTENDANCE",
                    member=member,
                    score_delta=score_d,
                    deposit_delta=dep_d,
                    description=f"{att_status} ({excuse_type or '사유서없음'})"
                ))

            # [PPT] (발표자이고, 인정결석이 아닌 경우 체크)
            if ppt and not is_excused:
                # PPT 담당자인데 상태가 있는지 확인
                s_d, d_d = PPT_MATRIX.get(ppt.status, (0, 0))
                if s_d != 0 or d_d != 0:
                    penalties.append(PenaltyItem(
                        type="PPT",
                        member=member,
                        score_delta=s_d,
                        deposit_delta=d_d,
                        description=f"PPT {ppt.status}"
                    ))

            # [과제/리뷰/피드백] (통합 페널티)
            # 하나라도 MISSING이면 페널티 적용
            # 단, 해당 주차에 과제/리뷰/피드백이 있어야 함. (없으면 PASS 취급)
            # Crawler가 돌아서 Assignments를 만들었을 것임.
            # 만약 DB에 없으면? -> MISSING으로 간주해야 할까?
            # -> 시스템 설계상 '제출된 것만 저장'한다면, 대상자인데 DB에 없으면 MISSING.
            # -> 하지만 편의상 'Assignments 테이블에 존재하는데 status=MISSING인 경우'만 체크?
            #    Spec B-5: "any(a and a.status == 'MISSING' ...)"
            #    즉, Assignment Object가 존재하고 MISSING이어야 함.
            #    따라서 Crawler가 미제출자도 MISSING으로 생성해줘야 함! (중요)
            #    하지만 현재 Crawler는 제출자만 저장함 ("PASS").
            #    -> PenaltyEngine에서 보정 필요?
            #    -> "Crawler가 돌았는데 없다" = "미제출"
            #    => 하지만 과제/리뷰가 없는 주차일 수도 있음. (휴강 등)
            #    => 따라서 Assignment가 '필수'인 주차인지 알아야 함.
            #    => 일단 현재 로직은 'Assignment가 존재하고 MISSING인 경우'로 구현.
            #    => 사용자가 수동으로 'MISSING'을 입력하거나, Crawler가 '미제출자 생성' 로직을 가져야 함.
            #    => Spec B-5 예시 코드도 `a.status == "MISSING"`을 체크함.
            
            any_hw_missing = False
            missing_types = []
            
            # 여기서 Assignment가 없으면 PASS로 간주 (안그러면 모든 주차에 과제 강요됨)
            # 운영팀이 수동으로 관리하거나 스캔 시 생성해야 함.
            for a in [review, hw, fb]:
                if a and a.status == "MISSING":
                    any_hw_missing = True
                    missing_types.append(a.type)
            
            if any_hw_missing:
                penalties.append(PenaltyItem(
                    type="HOMEWORK",
                    member=member,
                    score_delta=HOMEWORK_PENALTY[0],
                    deposit_delta=HOMEWORK_PENALTY[1],
                    description=f"미제출: {', '.join(missing_types)}"
                ))

        return penalties

    def check_milestone_after_update(self, before: int, after: int) -> PenaltyItem | None:
        """
        Finalize 시점에 호출. 점수 업데이트 전/후 비교하여 마일스톤 돌파 여부 체크.
        누적 벌점이 -10, -20, -30... 아래로 떨어질 때마다 벌금 5000원.
        before > threshold >= after
        """
        thresholds = [-10, -20, -30, -40, -50] # 충분히 많이
        for th in thresholds:
            if before > th >= after:
                return PenaltyItem(
                    type="MILESTONE_FINE",
                    member=None, # 호출자가 member 주입
                    score_delta=0,
                    deposit_delta=-5000,
                    description=f"누적벌점 {th}점 도달 추가 벌금"
                )
        return None
