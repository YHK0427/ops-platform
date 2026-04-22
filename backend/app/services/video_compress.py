"""영상 압축 서비스 — Intel iGPU 하드웨어 가속 (VAAPI) 우선, libx264 fallback.

방침:
- 1순위: h264_vaapi — Intel Quick Sync, CPU 거의 안 씀, 실시간 대비 8배 빠름
  비트레이트 5Mbps (1080p 화질 충분)
- 2순위 fallback: libx264 CRF 23 medium — VAAPI 실패 시 (device 없음, driver 이슈 등)
- 해상도/fps 유지, 오디오는 128k AAC 재인코딩
- +faststart: moov atom 앞으로 → 웹 스트리밍 시작 빠름
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

# VAAPI 비트레이트 (목표/최대)
VAAPI_BITRATE = "5M"
VAAPI_MAXRATE = "6M"
VAAPI_BUFSIZE = "10M"
VAAPI_DEVICE = "/dev/dri/renderD128"

# libx264 fallback CRF
LIBX264_CRF = 23


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def is_vaapi_available() -> bool:
    """VAAPI device 가 실제로 존재하고 읽기 가능한지."""
    return os.path.exists(VAAPI_DEVICE) and os.access(VAAPI_DEVICE, os.R_OK | os.W_OK)


def _run_ffmpeg_vaapi(src: str, dst: str) -> None:
    """Intel VAAPI 하드웨어 H.264 인코딩."""
    cmd = [
        "ffmpeg", "-y",
        "-hwaccel", "vaapi",
        "-hwaccel_device", VAAPI_DEVICE,
        "-hwaccel_output_format", "vaapi",
        "-i", src,
        "-vf", "scale_vaapi=format=nv12",
        "-c:v", "h264_vaapi",
        "-b:v", VAAPI_BITRATE,
        "-maxrate", VAAPI_MAXRATE,
        "-bufsize", VAAPI_BUFSIZE,
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-f", "mp4",
        "-loglevel", "error",
        dst,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def _run_ffmpeg_libx264(src: str, dst: str) -> None:
    """CPU H.264 (libx264) 인코딩 — VAAPI fallback."""
    cmd = [
        "ffmpeg", "-y",
        "-i", src,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", str(LIBX264_CRF),
        "-threads", "2",  # 서버 CPU 여유 확보 (최대 2코어만 사용)
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-f", "mp4",
        "-loglevel", "error",
        dst,
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


async def compress_in_place(path: str) -> tuple[int, int, str]:
    """파일을 in-place 압축.
    반환: (원본 바이트, 압축 후 바이트, 사용 인코더). 압축이 오히려 커지면 원본 유지.
    중단 시 .compressed.tmp 는 삭제, 원본은 무손실.
    """
    if not is_ffmpeg_available():
        raise RuntimeError("ffmpeg 가 설치되어 있지 않습니다")

    original_size = await asyncio.to_thread(os.path.getsize, path)
    tmp_dst = path + ".compressed.tmp"

    # VAAPI 1순위 시도
    encoder_used = "libx264"
    if is_vaapi_available():
        try:
            await asyncio.to_thread(_run_ffmpeg_vaapi, path, tmp_dst)
            encoder_used = "h264_vaapi"
        except subprocess.CalledProcessError as e:
            err_text = (e.stderr or "")[:500]
            logger.warning(f"VAAPI 인코딩 실패 — libx264 fallback 시도: {err_text}")
            # tmp 정리 후 libx264 재시도
            try:
                await asyncio.to_thread(os.remove, tmp_dst)
            except OSError:
                pass
            try:
                await asyncio.to_thread(_run_ffmpeg_libx264, path, tmp_dst)
            except subprocess.CalledProcessError as e2:
                try:
                    await asyncio.to_thread(os.remove, tmp_dst)
                except OSError:
                    pass
                raise RuntimeError(f"ffmpeg 실패 (VAAPI+libx264 모두): {e2.stderr or e2}")
    else:
        # VAAPI device 없음 → libx264 로 직행
        logger.info("VAAPI device 없음 — libx264 사용")
        try:
            await asyncio.to_thread(_run_ffmpeg_libx264, path, tmp_dst)
        except subprocess.CalledProcessError as e:
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
        return original_size, original_size, encoder_used

    # 교체 (atomic rename)
    await asyncio.to_thread(os.replace, tmp_dst, path)
    return original_size, new_size, encoder_used


def cleanup_stale_tmp_files(video_dir: str) -> int:
    """Worker 시작 시 좀비 .compressed.tmp 정리.
    워커가 중간에 죽었을 때 남는 파일. 반환: 삭제된 파일 수."""
    if not os.path.isdir(video_dir):
        return 0
    removed = 0
    for root, _, files in os.walk(video_dir):
        for fname in files:
            if fname.endswith(".compressed.tmp"):
                try:
                    os.remove(os.path.join(root, fname))
                    removed += 1
                except OSError:
                    pass
    return removed
