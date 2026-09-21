# ─── Stage 1: Build ───────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci --frozen-lockfile

COPY . .
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# ─── Stage 2: Serve ───────────────────────────────
FROM nginx:1.25-alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
# 00- 접두사로 default.conf 보다 먼저 읽히게 한다(map 을 먼저 정의해야 한다).
COPY preview-bot.conf /etc/nginx/conf.d/00-preview-bot.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
# conf.d 가 아니라 그 바깥에 둔다 — conf.d 안의 .conf 는 nginx 가 server 블록으로
# 자동 include 해버려서, 헤더 조각을 거기 두면 설정이 깨진다.
COPY security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
