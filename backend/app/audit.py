"""표준 감사(audit) 기록 헬퍼 — "어느 계정이 무엇을 했는지"를 일관되게 남긴다.

logger.audit(AUDIT 레벨) → JSON stdout + 텔레그램 audit 채널로 전송된다.
메시지에 행위자(계정)를 항상 포함시켜 텔레그램에서 누가 했는지 보이게 한다.
"""
import logging

logger = logging.getLogger("audit")


def actor_label(actor) -> str:
    """행위자 표시 라벨. 운영진=username(role), 기수=username(기수), 없으면 system."""
    if actor is None:
        return "system"
    if isinstance(actor, str):
        return actor or "system"
    # 기수(generation) 계정: get_current_member → {"member_id", "username"}
    if actor.get("account_type") == "generation" or ("member_id" in actor and "role" not in actor):
        return f"{actor.get('username', '?')}(기수)"
    # 운영진/스태프: get_current_user → {"username", "role"}
    u = actor.get("username", "?")
    role = actor.get("role")
    return f"{u}({role})" if role else u


def record_audit(actor, action: str, detail: str = "", ip: str | None = None) -> None:
    """감사 로그 1건 기록.
    actor: get_current_user/get_current_member 의 dict, 또는 문자열, 또는 None(system).
    action: 동작명(예: "실시간 피드백 보드 생성").
    detail: 부가정보(예: "id=3 세션=18").
    """
    label = actor_label(actor)
    msg = f"👤 {label} · {action}"
    if detail:
        msg += f" — {detail}"
    extra = {"user": label}
    if ip:
        extra["ip"] = ip
        msg += f" ({ip})"
    logger.audit(msg, extra=extra)  # type: ignore[attr-defined]
