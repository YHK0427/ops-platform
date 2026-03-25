import random
from typing import Literal

from app.models import Member


def build_groups(
    members: list[Member],
    method: Literal["random", "balanced"] = "random",
) -> dict[int, list[int]]:
    """
    멤버를 2개 분반으로 분배.

    - random: 셔플 후 반으로 나눔
    - balanced: net_score 내림차순 → 번갈아 배정 (2팀 Snake)

    Returns: {1: [member_ids], 2: [member_ids]}
    """
    if not members:
        return {1: [], 2: []}

    if method == "balanced":
        sorted_members = sorted(members, key=lambda m: m.net_score, reverse=True)
    else:
        sorted_members = list(members)
        random.shuffle(sorted_members)

    groups: dict[int, list[int]] = {1: [], 2: []}
    for i, member in enumerate(sorted_members):
        group = (i % 2) + 1  # 1, 2, 1, 2, ...
        groups[group].append(member.id)

    return groups
