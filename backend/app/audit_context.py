"""요청 처리 중 '지금 누가 하고 있는지'를 SQLAlchemy 이벤트 훅에서도 읽을 수 있게
공유하는 contextvar. get_current_user/get_current_member 의존성이 요청마다 채운다.

ContextVar는 asyncio Task 단위로 격리되므로 동시 요청끼리 섞이지 않는다.
"""
from contextvars import ContextVar

current_actor: ContextVar[dict | None] = ContextVar("current_actor", default=None)
current_request_path: ContextVar[str | None] = ContextVar("current_request_path", default=None)


def set_actor(actor: dict | None, request_path: str | None = None) -> None:
    current_actor.set(actor)
    if request_path is not None:
        current_request_path.set(request_path)


def get_actor_label() -> str:
    actor = current_actor.get()
    if actor is None:
        return "system"
    username = actor.get("username", "?")
    role = actor.get("role")
    return f"{username}({role})" if role else f"{username}(기수)"


def get_actor_username() -> str | None:
    actor = current_actor.get()
    return actor.get("username") if actor else None


def get_actor_role() -> str | None:
    actor = current_actor.get()
    return actor.get("role") if actor else None


def get_actor_cohort_id() -> int | None:
    actor = current_actor.get()
    return actor.get("cohort_id") if actor else None
