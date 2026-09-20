# 서버 감시 · 백업 운영 가이드

다음 기수 운영진이 읽는 문서입니다. 개발을 몰라도 따라 할 수 있게 썼습니다.

---

## 1. 제일 먼저 알아야 할 것

**서버 안에서 서버를 감시하는 건 반쪽짜리입니다.** 서버가 통째로 꺼지면 감시하던
프로그램도 같이 꺼져서 아무도 알려주지 않습니다. 지금 이 서비스는 집에 있는 서버에서
돌기 때문에 정전, 인터넷 끊김, 누가 전원을 뽑는 일이 실제로 일어납니다.

그래서 **밖에서 "연락이 끊겼다"를 감시하는 장치**가 제일 중요합니다. 아래 3번입니다.
다른 걸 다 못 하더라도 3번만은 해두세요.

---

## 2. 매일 보는 곳 — 사이트 안의 모니터링 화면

로그인 → 왼쪽 맨 아래 **관리 > 모니터링 > 인프라 상태**

맨 위 한 줄만 보면 됩니다.

| 표시 | 뜻 | 할 일 |
|---|---|---|
| 🟢 모두 정상입니다 | 문제 없음 | 없음 |
| 🟡 지켜볼 것 | 지금 당장은 괜찮지만 놔두면 문제 | 시간 날 때 확인 |
| 🔴 조치가 필요합니다 | 지금 뭔가 안 돌고 있음 | 바로 확인 |

아래 카드 중 **"아무도 알려주지 않는 것들"** 줄이 핵심입니다.
화면이 깨지면 기수원이 바로 말해주지만, 아래 것들은 아무도 말해주지 않습니다.

- **작업 워커** — 네이버 크롤링·영상 변환·푸시 알림을 처리하는 부분.
  "멈춤"이면 과제 검사와 푸시가 전부 안 됩니다.
- **대기 중인 작업** — 처리를 기다리는 작업 수. 계속 쌓이면 워커가 일을 못 하는 중입니다.
- **마지막 백업** — 이게 "없음"이거나 며칠 전이면 지금 데이터가 날아가면 복구 못 합니다.

---

## 3. 밖에서 감시하기 (데드맨 스위치) — **가장 중요**

서버가 5분마다 외부 서비스에 "나 살아있다"고 신호를 보냅니다.
신호가 끊기면 그쪽에서 메일을 보냅니다. **침묵이 곧 알람입니다.**

### 설정 방법 (10분, 무료)

1. <https://healthchecks.io> 가입 (무료 20개까지). **동아리 공용 구글 계정으로 가입하세요.**
   개인 계정으로 하면 그 사람이 졸업할 때 알림이 같이 사라집니다.
2. 체크 2개를 만듭니다.

   | 이름 | Period | Grace |
   |---|---|---|
   | `univpt-worker` | 5분 | 15분 |
   | `univpt-backup` | 1일 | 2시간 |

3. 각 체크의 **Ping URL** 을 복사해서 서버의 `.env` 에 넣습니다.

   ```
   HEARTBEAT_URL=https://hc-ping.com/여기에-worker-것
   BACKUP_HC_URL=https://hc-ping.com/여기에-backup-것
   ```

4. 적용:
   ```bash
   cd ~/ops-deploy && docker compose up -d worker
   ```

5. healthchecks.io 의 **Notifications** 에서 알림 받을 곳을 정합니다.
   - 공용 메일 주소 (필수)
   - 동아리 디스코드 채널 웹훅 (권장 — 채널은 사람이 바뀌어도 남습니다)

   **개인 메일이나 개인 디스코드 DM 으로 하지 마세요.** 인수인계 때 끊깁니다.

---

## 4. 백업

### 자동 백업 걸기 (한 번만)

```bash
crontab -e
```
아래 한 줄을 추가하고 저장:
```
0 4 * * * /home/ubuntu/ops-deploy/scripts/backup_db.sh >> /home/ubuntu/backup.log 2>&1
```
매일 새벽 4시에 `backups/` 폴더로 백업하고 14일 지난 건 지웁니다.

### 지금 바로 한 번 받기
```bash
cd ~/ops-deploy && ./scripts/backup_db.sh
```

### 복구하기 (실제로 사고 났을 때)
```bash
cd ~/ops-deploy
docker compose exec -T db psql -U $POSTGRES_USER -d postgres -c "DROP DATABASE $POSTGRES_DB;"
docker compose exec -T db psql -U $POSTGRES_USER -d postgres -c "CREATE DATABASE $POSTGRES_DB;"
docker compose exec -T db pg_restore -U $POSTGRES_USER -d $POSTGRES_DB < backups/db-2026-01-01_0400.dump
```

> **1년에 한 번은 복구를 실제로 해보세요.** 해보지 않은 백업은 백업이 아니라 가설입니다.
> 테스트용 DB를 하나 만들어서 거기에 복구해보면 됩니다.

---

## 5. 자세한 화면이 필요할 때 (선택)

평소엔 꺼져 있습니다. 필요하면 켜세요.

```bash
cd ~/ops-deploy
docker compose --profile monitoring up -d      # 켜기
docker compose --profile monitoring down       # 끄기
```

셋 다 합쳐서 메모리 약 160MB 씁니다.

| 주소 | 도구 | 쓰는 상황 |
|---|---|---|
| `127.0.0.1:8081` | **Dozzle** | 뭔가 고장났을 때 **에러 메시지를 읽는 곳**. 터미널 못 쓰는 사람용 |
| `127.0.0.1:8090` | **Beszel** | CPU·메모리·디스크 **그래프(이력)** 와 알림 설정 |
| `127.0.0.1:3001` | **Uptime Kuma** | 주소가 살아있는지 주기적으로 찔러보기 + 알림 |

**모두 `127.0.0.1` 에만 열려 있어 바깥에서 직접 접근할 수 없습니다.**
밖에서 보려면 Cloudflare Tunnel 에 주소를 추가하고, 반드시 Cloudflare Access 로
로그인을 걸어야 합니다. 로그에는 사용자 정보가 들어 있습니다.

Dozzle 첫 로그인: 아이디 `admin`. 비밀번호는 `monitoring/dozzle/users.yaml` 을 만들 때
정한 값입니다. 바꾸려면:
```bash
docker run --rm amir20/dozzle:v8.14.4 generate --password '새비밀번호' --name '운영진' admin \
  > monitoring/dozzle/users.yaml
docker compose --profile monitoring up -d --force-recreate dozzle
```

> Uptime Kuma 는 **같은 서버에서 돌기 때문에 서버가 통째로 죽으면 같이 죽습니다.**
> "서버가 꺼졌다"를 잡는 건 3번(healthchecks.io)뿐입니다. 둘은 역할이 다릅니다.

---

## 6. 문제가 생겼을 때 치는 명령어

```bash
cd ~/ops-deploy

docker compose ps                  # 뭐가 떠 있고 뭐가 죽었는지
docker compose logs -f backend     # 백엔드 에러 보기 (Ctrl+C 로 나감)
docker compose logs -f worker      # 워커 에러 보기
docker compose restart worker      # 워커만 다시 시작
docker compose up -d               # 꺼진 것들 다시 올리기
df -h /                            # 디스크 남은 용량
```

### 증상별

| 증상 | 먼저 볼 것 |
|---|---|
| 사이트가 아예 안 열림 | `docker compose ps` → `Exited` 있으면 `docker compose up -d` |
| 과제 검사가 전부 미제출로 나옴 | 대시보드의 **네이버 세션 상태**. 만료면 네이버 재로그인 |
| 푸시 알림이 안 감 | 모니터링 화면의 **작업 워커**. 멈춤이면 `docker compose restart worker` |
| 디스크가 꽉 참 | `docker system prune -a` (안 쓰는 이미지 정리), `backups/` 오래된 것 삭제 |

---

## 7. 일부러 안 만든 것들

나중에 "왜 제대로 된 모니터링이 없냐"는 말이 나올 수 있어 이유를 남깁니다.

| 안 쓴 것 | 이유 |
|---|---|
| Prometheus + Grafana | 설정 파일이 6개. 유지보수할 사람이 없으면 6개월 뒤 아무도 못 고칩니다 |
| Loki (로그 수집) | 메모리 1~2GB. 컨테이너 6개 로그 보자고 쓰기엔 과합니다. Dozzle 로 충분 |
| cAdvisor | Beszel 이 설정 없이 같은 일을 합니다 |
| SLO · 에러 예산 | 지킬 사람도, 못 지켰을 때 조정할 일정도 없습니다. 숫자만 남고 아무도 안 봅니다 |
| 인증서 만료 감시 | Cloudflare 가 알아서 갱신합니다. 우리가 가진 만료되는 인증서가 없습니다 |

대신 **문제가 생기지 않게 막는 쪽**에 넣었습니다. 컨테이너 로그 용량 제한,
Redis 메모리 상한, 30초 넘는 쿼리 강제 종료, 5분 넘게 열려 있는 트랜잭션 강제 종료.
감시할 필요 자체를 줄이는 게 감시 도구를 늘리는 것보다 낫습니다.

---

## 8. 서버를 옮기게 되면

현재 서버는 집에 있는 노트북(`my-home-server`, x86_64, 4코어 / 7.7GB / 914GB)입니다.

Oracle Cloud 무료 A1 으로 옮기려 했으나 **"Out of Capacity" 로 인스턴스를 못 만들어
보류된 상태**입니다. 나중에 다시 시도하면:

- 무료 한도가 2026-06-15 에 **4 OCPU/24GB → 2 OCPU/12GB 로 줄었습니다.** 1~2 OCPU / 6~12GB 로 잡으세요.
- 한도를 넘긴 인스턴스는 정지되고, **한 번 종료하면 다시 못 만들 수 있습니다.**
- 7일 동안 CPU·네트워크·메모리가 **전부** 20% 미만이면 회수됩니다(셋 다 낮아야 함).
  Postgres 가 떠 있으면 거의 안전하지만, "자원 아끼려고" 서비스를 끄지 마세요.
- ARM(aarch64)이라 이미지 태그가 ARM 을 지원하는지 확인해야 합니다.
