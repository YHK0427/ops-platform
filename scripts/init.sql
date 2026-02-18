-- PostgreSQL 초기화 스크립트
-- docker-compose.yml에서 /docker-entrypoint-initdb.d/init.sql 로 마운트됨
-- Alembic 마이그레이션 전 기본 설정만 수행

-- 타임존 설정
SET timezone = 'Asia/Seoul';

-- 확장 모듈 (필요 시)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
