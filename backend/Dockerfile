FROM python:3.12-slim

# Playwright (Chromium) + ffmpeg + Intel VAAPI 하드웨어 가속 런타임
# - intel-media-va-driver: Intel iGPU용 iHD 드라이버 (Kaby Lake+)
# - i965-va-driver: 구세대 Intel GPU 폴백
# - libva2, libva-drm2: VAAPI 코어 라이브러리
# - vainfo: 런타임 진단 (선택)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget gnupg ca-certificates ffmpeg \
    intel-media-va-driver i965-va-driver libva2 libva-drm2 vainfo \
    && rm -rf /var/lib/apt/lists/*

# iHD 드라이버를 기본으로 설정 (Intel HD 620 / Kaby Lake+ 세대)
ENV LIBVA_DRIVER_NAME=iHD

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e ".[all]" --break-system-packages

# Playwright Chromium 설치
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
