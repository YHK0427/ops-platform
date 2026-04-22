"""Cloudflare R2 업로드 서비스.

사용 흐름:
1. presign_put(key) → 클라이언트가 이 URL로 PUT
2. 업로드 완료 후 클라이언트가 서버에 알림
3. pull_to_disk(key, dest) → R2에서 로컬로 다운로드
4. delete(key) → R2에서 삭제
"""
from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from typing import Optional

import boto3
from botocore.client import Config

from app.config import settings

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    """R2 설정이 완료되었는지 (모든 필수 env 존재)"""
    return bool(
        settings.R2_ACCOUNT_ID
        and settings.R2_ACCESS_KEY_ID
        and settings.R2_SECRET_ACCESS_KEY
        and settings.R2_BUCKET_NAME
    )


def _endpoint_url() -> str:
    return f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"


@lru_cache
def _client():
    """S3-호환 boto3 클라이언트 (R2 endpoint)"""
    if not is_configured():
        raise RuntimeError("R2 설정이 누락되었습니다. R2_* 환경변수를 확인하세요.")
    return boto3.client(
        "s3",
        endpoint_url=_endpoint_url(),
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",  # R2는 region 개념 없음
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def presign_put(key: str, expires_in: int = 900, content_type: Optional[str] = None) -> str:
    """PUT presigned URL 생성 (기본 15분 유효)"""
    params = {"Bucket": settings.R2_BUCKET_NAME, "Key": key}
    if content_type:
        params["ContentType"] = content_type
    return _client().generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=expires_in,
    )


def _blocking_pull(key: str, dest_path: str) -> int:
    """R2 → 로컬 파일 복사. 반환: 다운로드된 바이트 수."""
    bucket = settings.R2_BUCKET_NAME
    with open(dest_path, "wb") as f:
        _client().download_fileobj(bucket, key, f)
    import os
    return os.path.getsize(dest_path)


async def pull_to_disk(key: str, dest_path: str) -> int:
    """비동기 래퍼 — 스레드 풀에서 실행"""
    return await asyncio.to_thread(_blocking_pull, key, dest_path)


def _blocking_delete(key: str) -> None:
    _client().delete_object(Bucket=settings.R2_BUCKET_NAME, Key=key)


async def delete(key: str) -> None:
    await asyncio.to_thread(_blocking_delete, key)


def _blocking_head(key: str) -> dict:
    return _client().head_object(Bucket=settings.R2_BUCKET_NAME, Key=key)


async def head(key: str) -> dict:
    """오브젝트 메타데이터 조회 (존재 확인 + 크기)"""
    return await asyncio.to_thread(_blocking_head, key)


# ── Multipart Upload ─────────────────────────────────────────────────────────
# 대용량 파일을 청크로 쪼개 업로드 — Background Fetch storage quota 회피 목적.
# 흐름: create_multipart → (part N개 PUT) → complete_multipart
#       중단 시 abort_multipart 로 R2 측 unfinished upload 정리.


def _blocking_create_multipart(key: str, content_type: str) -> str:
    resp = _client().create_multipart_upload(
        Bucket=settings.R2_BUCKET_NAME,
        Key=key,
        ContentType=content_type,
    )
    return resp["UploadId"]


async def create_multipart(key: str, content_type: str) -> str:
    """멀티파트 업로드 시작. 반환: uploadId"""
    return await asyncio.to_thread(_blocking_create_multipart, key, content_type)


def presign_part(key: str, upload_id: str, part_number: int, expires_in: int = 3600) -> str:
    """개별 part PUT presigned URL (기본 1시간). part_number 는 1-indexed."""
    return _client().generate_presigned_url(
        "upload_part",
        Params={
            "Bucket": settings.R2_BUCKET_NAME,
            "Key": key,
            "UploadId": upload_id,
            "PartNumber": part_number,
        },
        ExpiresIn=expires_in,
    )


def _blocking_complete_multipart(key: str, upload_id: str, parts: list[dict]) -> dict:
    # parts: [{"PartNumber": 1, "ETag": '"abc"'}, ...]  — PartNumber 순 정렬 필수
    sorted_parts = sorted(parts, key=lambda p: p["PartNumber"])
    return _client().complete_multipart_upload(
        Bucket=settings.R2_BUCKET_NAME,
        Key=key,
        UploadId=upload_id,
        MultipartUpload={"Parts": sorted_parts},
    )


async def complete_multipart(key: str, upload_id: str, parts: list[dict]) -> dict:
    """멀티파트 업로드 완료. parts 형식: [{'PartNumber': int, 'ETag': str}, ...]"""
    return await asyncio.to_thread(_blocking_complete_multipart, key, upload_id, parts)


def _blocking_abort_multipart(key: str, upload_id: str) -> None:
    try:
        _client().abort_multipart_upload(
            Bucket=settings.R2_BUCKET_NAME,
            Key=key,
            UploadId=upload_id,
        )
    except Exception as e:
        logger.warning(f"abort_multipart_failed key={key} upload_id={upload_id} err={e}")


async def abort_multipart(key: str, upload_id: str) -> None:
    """멀티파트 업로드 중단 — 서버 측 미완료 파트 정리."""
    await asyncio.to_thread(_blocking_abort_multipart, key, upload_id)
