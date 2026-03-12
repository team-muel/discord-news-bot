# Obsidian -> Supabase `guild_lore_docs` Sync Runbook

Render Disk 없이 운영할 때, Obsidian Vault를 로컬(또는 별도 머신)에서 주기적으로 읽어 Supabase `guild_lore_docs`로 동기화하는 방법입니다.

## 1) 전제 조건

- Supabase schema 적용 완료 (`docs/SUPABASE_SCHEMA.sql`)
- Vault 구조:
  - `.../guilds/<guildId>/Guild_Lore.md` 또는 `.../guilds/<guildId>/Guild_Lore`
  - `.../guilds/<guildId>/Server_History.md` 또는 `.../guilds/<guildId>/Server_History`
  - `.../guilds/<guildId>/Decision_Log.md` 또는 `.../guilds/<guildId>/Decision_Log`
- 동기화 실행 머신에서 Node.js와 이 저장소 접근 가능

## 2) 환경 변수

최소 필수:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (또는 `SUPABASE_KEY`)
- `OBSIDIAN_SYNC_VAULT_PATH` (미설정 시 `OBSIDIAN_VAULT_PATH` 사용)

선택(강력 권장):

- `OBSIDIAN_SYNC_DISCORD_WEBHOOK_URL` (관리자 채널 웹훅 알림)

선택(폴더명 != guild id인 경우):

- `OBSIDIAN_SYNC_GUILD_MAP_JSON`
- `OBSIDIAN_SYNC_GUILD_MAP_FILE`

## 3) 수동 실행

```bash
npm run sync:obsidian-lore:dry
npm run sync:obsidian-lore
```

추가 옵션:

- 특정 길드만: `npm run sync:obsidian-lore -- --guild 123456789012345678`
- 폴더명과 guildId를 함께 지정: `npm run sync:obsidian-lore -- --guild alpha-server:123456789012345678`
- Vault 경로 직접 지정: `npm run sync:obsidian-lore -- --vault "C:\\Users\\you\\Documents\\Obsidian Vault"`
- 매핑 JSON 직접 지정: `npm run sync:obsidian-lore -- --guild-map-json "{\"alpha-server\":\"123456789012345678\"}"`
- 매핑 파일 지정: `npm run sync:obsidian-lore -- --guild-map-file "C:\\sync\\guild-map.json"`
- 예시 파일: `docs/guild-map.example.json`

## 4) 동작 방식

- 길드 폴더를 스캔하여 lore markdown을 읽습니다.
- 폴더명이 이미 Discord guild id라면 별도 매핑 없이 신규 서버가 자동 반영됩니다.
- 길드 폴더명과 실제 `guild_id`가 다르면 매핑(JSON/파일/CLI)으로 변환합니다.
- `guild_lore_docs`에 `guild_id + source` 기준으로 1행만 유지합니다.
- 중복 행이 있으면 최신 1행만 남기고 정리합니다.
- `source` 값은 다음 규칙을 사용합니다:
  - `obsidian-sync:Guild_Lore.md`
  - `obsidian-sync:Server_History.md`
  - `obsidian-sync:Decision_Log.md`
- 완료 후(드라이런 포함) `OBSIDIAN_SYNC_DISCORD_WEBHOOK_URL`가 있으면 관리자 채널에 요약을 전송합니다.

## 5) Windows 작업 스케줄러 (무료)

예시: 30분마다 실행

1. 작업 스케줄러에서 기본 작업 생성
2. 트리거: 매일, 반복 간격 30분
3. 동작: 프로그램 시작
   - 프로그램/스크립트: `powershell.exe`
   - 인수:

```powershell
-NoProfile -ExecutionPolicy Bypass -Command "Set-Location 'C:\\Muel_S\\discord-news-bot'; npm run sync:obsidian-lore"
```

현재 워크스페이스 기준 그대로 복붙 가능한 명령입니다.

4. 이 계정으로 실행 시 `.env` 또는 시스템 환경 변수에 Supabase/Vault 값을 등록

## 6) 운영 팁

- 먼저 `sync:obsidian-lore:dry`로 경로/권한 검증 후 실제 반영하세요.
- Service role key는 읽기/쓰기 권한이 크므로 동기화 머신 외부에 노출하지 마세요.
- 동기화 주기는 15~60분부터 시작하는 것을 권장합니다.
- 이 동기화는 `guild_lore_docs`를 갱신하며, 런타임 메모리 검색은 `memory_items`와 함께 병행됩니다.
- Discord 알림은 서버 봇 토큰이 아닌 웹훅 방식이라 Render 인스턴스와 독립적으로 운영할 수 있습니다.
