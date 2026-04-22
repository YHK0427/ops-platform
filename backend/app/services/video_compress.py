"""영상 압축 서비스 — ffmpeg H.264 CRF 기반.

방침:
- H.264 libx264 CRF 23 (시각적으로 거의 무손실에 가까움, 범용 호환)
- preset 'medium' (속도/크기 밸런스)
- 오디오는 128k AAC로 재인코딩 (원본 고비트레이트 시 절약)
- +faststart: moov atom을 앞으로 → 웹/네이버 카페 스트리밍 시작 빠름
- 해상도/프레임레이트는 건드리지 않음 (화질 유지)
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)

# 이 크기(MB) 초과 파일만 압축 시도
COMPRESS_THRESHOLD_MB = 300

# ffmpeg CRF (낮을수록 고화질/큰용량, 23이 기본 권장)
CRF = 23


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _run_ffmpeg(src: str, dst: str) -> None:
    """동기 ffmpeg 실행 (블로킹). 실패 시 CalledProcessError.
    출력 파일이 .tmp 확장자라 자동 포맷 추정 실패하므로 -f mp4 로 명시."""
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", str(CRF),
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-f", "mp4",
        "-loglevel", "error",
        dst,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


async def compress_in_place(path: str) -> tuple[int, int]:
    """파일을 in-place 압축.
    반환: (원본 바이트, 압축 후 바이트). 압축이 오히려 커지면 원본 유지."""
    if not is_ffmpeg_available():
        raise RuntimeError("ffmpeg 가 설치되어 있지 않습니다")

    original_size = os.path.getsize(path)
    tmp_dst = path + ".compressed.tmp"

    try:
        await asyncio.to_thread(_run_ffmpeg, path, tmp_dst)
    except subprocess.CalledProcessError as e:
        # 실패 시 tmp 정리
        try:
            await asyncio.to_thread(os.remove, tmp_dst)
        except OSError:
            pass
        raise RuntimeError(f"ffmpeg 실패: {e.stderr or e}")

    new_size = await asyncio.to_thread(os.path.getsize, tmp_dst)

    # 압축 결과가 원본보다 크거나 같으면 원본 유지
    if new_size >= original_size:
        logger.info(f"compress_skipped path={path} original={original_size} compressed={new_size} (크기 이득 없음)")
        await asyncio.to_thread(os.remove, tmp_dst)
        return original_size, original_size

    # 교체
    await asyncio.to_thread(os.replace, tmp_dst, path)
    return original_size, new_size
