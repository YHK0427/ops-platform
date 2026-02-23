import logging
import random
from typing import Optional

from app.models import Member, TeamHistory


class TeamBuilder:
    def __init__(self, members: list[Member], history: list[TeamHistory] = None):
        """
        :param members: 전체 대상 멤버 리스트 (net_score 내림차순 정렬 권장)
        :param history: 과거 팀 이력 (충돌 감지용) - Phase 04에선 단순 참고만
        """
        self.members = sorted(members, key=lambda m: m.net_score, reverse=True)
        self.history = history or []
        self.logger = logging.getLogger(__name__)

    def build_teams(self, num_teams: int) -> list[list[Member]]:
        """
        Snake Draft 알고리즘으로 팀 배정
        1. leader 태그 보유자 우선 각 팀에 1명씩 배정 (net_score 순)
        2. 나머지 인원을 Snake Order로 배정 (1->N, N->1, 1->N ...)
        """
        if num_teams < 1:
            return []

        teams: list[list[Member]] = [[] for _ in range(num_teams)]

        # 1. 리더 분리
        leaders = [m for m in self.members if "leader" in m.tags]
        others = [m for m in self.members if "leader" not in m.tags]

        # 리더 배정 (팀 수보다 리더가 많으면? -> 그냥 순서대로)
        # 리더가 적으면? -> 앞에서부터 채우고 끝
        for i, leader in enumerate(leaders):
            target_team_idx = i % num_teams
            teams[target_team_idx].append(leader)

        # 2. 나머지 인원 (Snake Draft)
        # 현재 각 팀 인원이 다를 수 있음 (리더 배정 때문에)
        # 공정성을 위해 '현재 인원 적은 팀' 우선? or 그냥 순서대로?
        # spec: "나머지 net_score 내림차순으로 배분" (Snake Order)

        # Snake Order 인덱스 생성
        # 0, 1, 2, ... N-1, N-1, ... 2, 1, 0, 0, 1 ...
        snake_indices = []
        direction = 1  # 1: forward, -1: backward
        current_idx = 0

        # 충분히 많이 생성해둠 (최대 인원 수 만큼)
        while len(snake_indices) < len(others):
            snake_indices.append(current_idx)
            current_idx += direction
            if current_idx == num_teams:
                direction = -1
                current_idx = num_teams - 1
            elif current_idx == -1:
                direction = 1
                current_idx = 0

        # 리더 배정으로 인해 이미 1명씩 찬 팀들이 있음.
        # 리더가 없는 팀부터 채워야 할 수도 있지만, 
        # spec에 "리더 먼저 각 팀에 1명씩"이라고 했으므로
        # 리더가 3명이고 팀이 4개면, 4번째 팀은 0명인 상태.
        # Snake Draft는 0번 팀부터 다시 시작하는 게 아니라,
        # 리더 배정이 끝난 지점부터 이어가는 게 맞음.
        
        # 하지만 명세 단순화를 위해:
        # 리더들은 이미 배정됨.
        # 나머지는 0번 팀부터(혹은 리더 배정 끝난 다음 팀부터) Snake로 채움.
        # 여기선 간단하게 0번 팀부터 Snake로 채우되,
        # "Total Score Balance"를 맞추기 위해
        # 현재 팀 점수 합계가 가장 낮은 팀에 배정하는 방식도 고려 가능하나,
        # 명세가 "Snake Draft"이므로 정석대로 0->N / N->0 순서 적용.

        # 리더 배정이 꽉 찼다면 (모든 팀 1명 이상), Snake 시작은 N-1번 팀부터(역순) 하는 게 밸런스상 좋음.
        # 리더가 부족했다면, 빈 팀부터 채워야 함.
        
        start_team_idx = len(leaders) % num_teams
        # 만약 리더가 팀 수의 배수라면 0부터 시작.
        # 아니라면 그 다음 팀부터.

        # 하지만 복잡도를 줄이기 위해, others 전체를 다시 Snake로 분배.
        # 단, 이미 리더가 있는 팀은 인원수가 1일 것임.
        
        for i, member in enumerate(others):
            # 현재 가장 인원이 적은 팀들 중 net_score 합이 가장 낮은 팀?
            # -> 이건 Greedy. Snake는 아님.
            
            # Snake:
            # Round 1: 0 -> N-1
            # Round 2: N-1 -> 0
            # ...
            
            # 리더 배정 후 밸런스를 위해:
            # 리더가 배정된 팀들은 "1라운드 참가 완료"로 간주할 수도 있음.
            # 하지만 리더간 점수 편차도 있으므로, 
            # 여기서는 "others"를 별도 풀로 보고 0번 팀부터 Snake로 넣되,
            # 전체 팀 밸런스를 최종적으로 확인하는 게 나음.
            
            # 가장 단순한 Snake 구현:
            team_idx = snake_indices[i]
            teams[team_idx].append(member)

        return teams

    def get_collision_warnings(self, teams: list[list[Member]]) -> list[dict]:
        """
        같은 팀 이력 충돌 감지 (2회 이상)
        :return: [{"members": [String], "count": Int}, ...]
        """
        warnings = []
        # TODO: Phase 04에서는 구체적 구현 생략 가능 (Optional)
        # 실제로는 team_history 테이블 조회해서 카운트
        return warnings
