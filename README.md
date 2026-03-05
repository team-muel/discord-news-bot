# Muel Discord News Bot (백엔드)

이 저장소는 Muel 프로젝트의 백엔드(Discord 봇, 스케줄링, 데이터 수집)를 담당합니다.
프론트엔드는 https://github.com/team-muel/muel-front-uiux 에서 관리되며 Vercel로 배포됩니다.

## 주요 목적

- Discord 알림/봇 처리
- 뉴스 수집 및 AI 분석 파이프라인
- Render에 배포되어 백엔드 API/봇을 운영

## 필수 환경변수

- `DISCORD_TOKEN` 또는 `DISCORD_BOT_TOKEN` — Discord 봇 토큰
- `SUPABASE_URL` — Supabase 프로젝트 URL
- `SUPABASE_KEY` — Supabase 서비스 키
- `OPENAI_API_KEY` — (선택) OpenAI 키 (사용 스크립트에서 필요)
- `TARGET_CHANNEL_ID` — 디스코드 알림을 보낼 채널 ID
- `FRONTEND_ORIGIN` — 프론트엔드(예: Vercel) 도메인 (CORS 허용)
- `PORT` — 서버 포트 (기본 3000)

> Render에 배포 시에는 Render의 Environment 영역에 위 값을 설정하세요.

## 로컬 실행

Node.js 백엔드만 실행:

```bash
# 서버만 실행 (봇도 함께 시작됨)
npm run start:server

# 봇만 별도 실행
npm run start:bot
```

### pm2로 24/7(로컬/서버) 실행 예시

1. pm2 설치

```bash
npm install -g pm2
```

2. 레포 루트의 `ecosystem.config.js`를 사용하여 봇 시작

```bash
pm2 start ecosystem.config.js --only muel-bot
pm2 save
pm2 startup
```

3. pm2 로그 확인

```bash
pm2 logs muel-bot
```

## Render 배포 가이드 - 간단

1. Render에 새 Web Service를 생성
   - Build Command: `npm install && npm run lint` (선택적)
   - Start Command: `npm run start:server`
   - 포트: 3000 (또는 `PORT` env 설정 사용)
2. Environment에 위 필수 env들을 추가
3. 자동 배포(Repository 연결) 또는 Manual deploy 사용

## GitHub Actions

저장소의 `.github/workflows/main.yml`는 Python 기반 주기 작업(`bot_task.py`)을 실행합니다. 이 워크플로는 깃허브 시크릿을 사용하므로, Render와 별개로 주기 작업이 필요하면 시크릿을 GitHub에 설정하세요.

권장 확인 사항:

## Sentry (선택)

에러 추적을 위해 Sentry를 사용할 수 있습니다. `SENTRY_DSN` 환경변수를 Render 또는 실행 환경에 설정하면 애플리케이션이 자동으로 Sentry에 초기화됩니다. 예:

```
SENTRY_DSN=https://<key>@o0.ingest.sentry.io/0
```

## Render 자동 배포

레포지토리의 `.github/workflows/render-deploy.yml`은 `push` 시 Render API를 통해 배포를 트리거합니다. 사용하려면 다음 GitHub 시크릿을 설정하세요:

- `RENDER_SERVICE_ID` (숫자/문자열, Render 서비스 ID)
- `RENDER_API_KEY` (Render API key)

워크플로는 `push` 이벤트로 동작하며, 시크릿이 없을 경우 배포를 건너뜁니다.

## 보안/운영 권고

- `bot.ts`의 디버그 로그는 production에서는 출력되지 않도록 조치되어 있습니다.
- `FRONTEND_ORIGIN`에 프론트 배포 도메인만 설정하여 CORS를 제한하세요.
- 불필요한 프런트 의존성(`@discord/embedded-app-sdk`, `clsx` 등)이 `package.json`에 남아있는지 확인하고, 백엔드 전용 리포지토리라면 제거를 권장합니다. 필요 시 제가 제거 작업을 안전하게 진행해드리겠습니다.

## 추가 지원

원하시면 아래 작업을 추가로 수행하겠습니다:

- `package.json`에서 백엔드 불필요 의존성 제거 및 `npm ci` 후 타입 검사
- GitHub Actions를 Render 배포에 맞게 조정(예: push → Render deploy 트리거)
- 더 엄격한 로깅/모니터링(예: Winston, Sentry) 도입

문의 및 다음 지시를 알려주세요.
