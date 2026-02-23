import logging
import re
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Optional

import requests
from app.config import settings
from app.models import Member

logger = logging.getLogger(__name__)


class NaverSessionExpiredError(Exception):
    """네이버 세션 만료 에러"""
    pass


def fetch_board_articles(
    session: requests.Session,
    menu_id: int,
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    """
    특정 게시판(menu_id)의 게시글 목록 조회
    URL: https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/{CAFE_ID}/menus/{menu_id}/articles
    """
    url = f"https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/{settings.NAVER_CAFE_ID}/menus/{menu_id}/articles"
    params = {
        "page": page,
        "perPage": per_page,
        "search.query": "",
        "search.sortBy": "date",
        "search.option": 0,
        "ad": "true",
    }
    
    try:
        resp = session.get(url, params=params, timeout=10)
        if resp.status_code == 401:
            raise NaverSessionExpiredError("Naver session expired (401)")
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(f"Failed to fetch articles: {e}")
        # 401 외의 에러는 그대로 raise or empty?
        # 여기서는 로직 처리를 위해 exception을 propagate
        if isinstance(e, requests.HTTPError) and e.response.status_code == 401:
            raise NaverSessionExpiredError("Naver session expired (401)")
        raise


def fetch_article_detail(
    session: requests.Session,
    article_id: int,
) -> dict[str, Any]:
    """
    게시글 상세 조회 (댓글 포함)
    URL: https://article.cafe.naver.com/gw/v4/cafes/{CAFE_ID}/articles/{article_id}
    """
    url = f"https://article.cafe.naver.com/gw/v4/cafes/{settings.NAVER_CAFE_ID}/articles/{article_id}"
    params = {
        "useCafeId": "true",
        "requestFrom": "A",
    }
    # Referer 필수
    # session headers에 "Referer": "https://cafe.naver.com/" 설정되어 있음을 가정
    
    try:
        resp = session.get(url, params=params, timeout=10)
        if resp.status_code == 401:
            raise NaverSessionExpiredError("Naver session expired (401)")
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        if isinstance(e, requests.HTTPError) and e.response.status_code == 401:
            raise NaverSessionExpiredError("Naver session expired (401)")
        raise


def extract_name_from_title(title: str, doc_type: str = "DEFAULT") -> Optional[str]:
    """
    게시글 제목에서 작성자 이름 추출
    컨벤션:
    - 사유서: "사유서20주차_김민준P"
    - 리뷰: "20주차리뷰_김민준"
    - 과제: "20주차과제_김민준"
    - PPT(영상): "김민준(8번째).mp4", "20주차_발표_김민준" 등
    
    공통적으로: [주차][유형]_[이름][옵션] 또는 [유형][주차]_[이름]
    가장 확실한 건 "_" 뒤에 있는 문자열 파싱
    """
    # 1. 괄호 제거 (김민준(8번째) -> 김민준)
    # 정규식: `^(.+?)\s*\(`  (영상 업로드용)
    if doc_type == "VIDEO":
        match = re.search(r"^(.+?)\s*\(", title)
        if match:
            return match.group(1).strip()
    
    # 2. 일반 게시글 (Underbar 기준)
    # "20주차리뷰_김민준" -> 김민준
    # "사유서20주차_김민준P" -> 김민준P -> P 제거?
    if "_" in title:
        parts = title.split("_")
        # 마지막 부분이 이름일 확률 높음 (또는 이름+suffix)
        possible_name = parts[-1].strip()
        
        # Suffix 제거 (P, L, M 등 출결 관련 마킹이 붙을 수도 있지만, 보통 이름만 씀)
        # 만약 "김민준P" 처럼 뒤에 영어 대문자 1개가 붙는다면 제거
        # 하지만 이름이 "John" 이면? -> 한국어 이름 가정
        # 정규식으로 한글만 추출? -> "김민준"
        
        # 이름 추출 정규식 (한글 2-4자)
        korean_name_match = re.search(r"([가-힣]{2,4})", possible_name)
        if korean_name_match:
            return korean_name_match.group(1)
            
        return possible_name

    return None


def match_member_by_name(
    extracted_name: str,
    members: list[Member],
) -> Optional[Member]:
    """
    추출된 이름으로 멤버 찾기
    1. name 완전 일치
    2. name_initial 완전 일치
    3. name 부분 일치 (2글자 이상) -> 위험할 수 있으나, 동명이인 없으면 허용?
       여기서는 안전하게 1, 2번만 시도하고, 
       만약 동명이인이 있다면? -> id 매칭 불가하므로 Initial 필수
    """
    if not extracted_name:
        return None

    # 1. 완전 일치
    for m in members:
        if m.name == extracted_name:
            return m
            
    # 2. Initial 일치 (예: "KMJ")
    # extracted_name이 영어라면?
    
    # 3. 부분 일치 (생략 - 오매칭 방지)

    return None


async def sync_board_to_db(
    board_type: str,
    menu_id: int,
    req_session,
    members: list,
    db,
) -> dict:
    """
    네이버 카페 게시판 내용을 CafePost 테이블에 동기화.
    - 새 글: INSERT
    - 기존 글: 제목/닉 UPDATE, is_deleted=False
    - DB에만 있고 현재 스캔에 없는 글: is_deleted=True (soft delete)
    """
    import re as _re
    from sqlalchemy import select
    from app.models import CafePost

    fetched_ids: set[int] = set()

    for page in range(1, 6):  # 최대 5페이지 (100개)
        try:
            data = fetch_board_articles(req_session, menu_id, page=page)
        except Exception as e:
            logger.error(f"sync_board_to_db: fetch failed page={page}: {e}")
            break

        items = data.get("message", {}).get("result", {}).get("articleList", [])
        if not items:
            break

        for item in items:
            article_id = item.get("articleId") or item.get("article_id")
            if not article_id:
                continue
            fetched_ids.add(int(article_id))

            title = item.get("subject", "")
            author_nick = item.get("writer", {}).get("nick", "")

            # 주차 파싱
            week_match = _re.search(r"(\d+)\s*주차", title)
            week_num = int(week_match.group(1)) if week_match else None

            # 멤버 매칭 (이름 추출 → 멤버 조회)
            extracted = extract_name_from_title(title)
            member = match_member_by_name(extracted, members) if extracted else None

            # Upsert
            stmt = select(CafePost).where(CafePost.article_id == int(article_id))
            result = await db.execute(stmt)
            post = result.scalar_one_or_none()

            if post:
                post.title = title
                post.author_nick = author_nick
                post.week_num = week_num
                if member:
                    post.member_id = member.id
                post.is_deleted = False
            else:
                db.add(CafePost(
                    article_id=int(article_id),
                    board_type=board_type,
                    title=title,
                    author_nick=author_nick,
                    week_num=week_num,
                    member_id=member.id if member else None,
                    is_deleted=False,
                ))

    # Soft-delete: DB에 있는데 이번 스캔에 없으면 삭제된 것으로 마킹
    stmt = select(CafePost).where(
        CafePost.board_type == board_type,
        CafePost.is_deleted == False,
    )
    result = await db.execute(stmt)
    existing = result.scalars().all()
    deleted_count = 0
    for post in existing:
        if post.article_id not in fetched_ids:
            post.is_deleted = True
            deleted_count += 1

    await db.commit()

    return {
        "board_type": board_type,
        "synced": len(fetched_ids),
        "soft_deleted": deleted_count,
    }
