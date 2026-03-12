# Multi-Guild Operations Checklist

이 문서는 Muel을 여러 디스코드 서버(길드)에서 안정적으로 운영하기 위한 실행 체크리스트입니다.

## 1) 필수 env 키 (없으면 장애 가능)

- `START_BOT=true`
- `DISCORD_TOKEN` 또는 `DISCORD_BOT_TOKEN`
- `JWT_SECRET`
- `NODE_ENV=production`

에이전트/대화 기능 사용 시:

- `AI_PROVIDER=openai` 또는 `AI_PROVIDER=gemini`
- openai 사용: `OPENAI_API_KEY`
- gemini 사용: `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY`

로그인/OAuth 사용 시:

- `DISCORD_OAUTH_CLIENT_ID`
- `DISCORD_OAUTH_CLIENT_SECRET`
- `PUBLIC_BASE_URL` (예: https://your-service.onrender.com)
- `FRONTEND_ORIGIN` (프론트 도메인)

멀티서버 상태 영속성(강력 권장):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` 또는 `SUPABASE_KEY`

## 2) 멀티서버 운영 권장 env

- `AGENT_MAX_CONCURRENT_SESSIONS=4`
- `AGENT_MAX_GOAL_LENGTH=1200`
- `AGENT_AUTO_ONBOARDING_ENABLED=true`
- `AGENT_DAILY_LEARNING_ENABLED=true`
- `AGENT_DAILY_MAX_GUILDS=30`
- `DISCORD_SIMPLE_COMMANDS_ENABLED=true`
- `DISCORD_LOGIN_SESSION_TTL_MS=86400000`

주의:

- `DISCORD_COMMAND_GUILD_ID`를 설정하면 특정 길드 빠른 동기화가 우선됩니다.
- 멀티서버 운영에서는 이 값이 의도한 테스트 길드인지 확인하거나, 비워서 글로벌 동기화 중심으로 운영하세요.

## 3) DB 준비

- [docs/SUPABASE_SCHEMA.sql](docs/SUPABASE_SCHEMA.sql) 전체 적용
- 최소 확인 테이블:
  - `discord_login_sessions`
  - `sources`
  - `agent_sessions`
  - `agent_steps`
  - `memory_items`
  - `memory_sources`

## 4) 자동 검증 명령

배포 전/후 아래 명령 실행:

```bash
npm run env:check
```

판정 규칙:

- `ERROR`: 반드시 수정 후 배포
- `WARN`: 배포 가능하지만 운영 리스크 존재

## 5) Render에 env 등록 방법

1. Render Dashboard에서 서비스 선택
2. Environment 탭으로 이동
3. 필요한 키를 `Add Environment Variable`로 추가
4. 저장 후 `Manual Deploy` 또는 재시작

운영 팁:

- 비밀키(`DISCORD_TOKEN`, `JWT_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)는 절대 코드/문서에 하드코딩하지 마세요.
- 키 변경 후에는 `npm run env:check`로 재검증하세요.

## 6) 로컬/PM2 등록 방법

PowerShell 예시:

```powershell
$env:START_BOT="true"
$env:DISCORD_TOKEN="<token>"
$env:JWT_SECRET="<secret>"
$env:AI_PROVIDER="openai"
$env:OPENAI_API_KEY="<secret>"
$env:SUPABASE_URL="https://<project>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<secret>"
npm run env:check
npm run pm2:start
```

`.env` 파일 사용 시:

- 루트에 `.env` 생성
- 위 키를 `KEY=value` 형식으로 기록
- `npm run env:check` 실행

## 7) 길드별 스모크 테스트

각 서버에서 다음 항목 확인:

- `/해줘` 명령 응답
- 구독 추가/조회/해제
- 로그인 세션 유지 (`/로그인`)
- 상태 조회 (`/상태` 또는 `/api/bot/status`)

서버별로 문제가 다르면, 해당 길드 ID 기준 로그를 우선 확인하세요.
