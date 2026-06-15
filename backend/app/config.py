from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    POSTGRES_DB: str = "univpt_ops"
    POSTGRES_USER: str = "univpt"
    POSTGRES_PASSWORD: str = ""
    DATABASE_URL: str

    # Redis
    REDIS_PASSWORD: str = ""
    REDIS_URL: str

    # Auth
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD_HASH: str
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    JWT_REMEMBER_EXPIRE_MINUTES: int = 60 * 24 * 365 * 10  # 로그인 유지 시 사실상 무제한(10년)

    # Naver
    NAVER_IMAP_EMAIL: str = ""
    NAVER_IMAP_PASSWORD: str = ""
    NAVER_CAFE_ID: str = "31668555"
    NAVER_CAFE_MENU_VIDEO: int = 1
    NAVER_CAFE_MENU_REVIEW: int = 2
    NAVER_CAFE_MENU_PPT: int = 3
    NAVER_CAFE_MENU_EXCUSE: int = 0
    NAVER_ID: str = ""
    NAVER_PWD: str = ""

    # Google Drive
    GOOGLE_DRIVE_FOLDER_ID: str = ""
    GOOGLE_SERVICE_ACCOUNT_JSON: str = ""

    # App
    # (GENERATION 제거됨 — 기수는 DB cohorts 테이블로 관리, 멀티테넌시)
    CORS_ORIGINS: str = "http://localhost:3000"
    ENV: str = "dev"

    # Telegram
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_ALERT_CHAT_ID: str = ""
    TELEGRAM_AUDIT_CHAT_ID: str = ""

    # Cloudflare R2 (영상 업로드 직통 — Cloudflare Tunnel 100MB 제한 우회)
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
