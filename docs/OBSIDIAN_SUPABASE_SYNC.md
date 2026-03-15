# Obsidian -> Supabase `guild_lore_docs` Sync Runbook

Render Disk 없이 운영할 때, Obsidian Vault를 로컬(또는 별도 머신)에서 주기적으로 읽어 Supabase `guild_lore_docs`로 동기화하는 방법입니다.

## 0) 현재 운영 단계 스냅샷 (2026-03-15)

현재 운영은 고정 문서 동기화 단계를 넘어 다음 루프를 포함합니다.

- 신규 길드 진입 -> Obsidian 지식 트리 자동 bootstrap
- 길드 구조(topology) 스냅샷 자동 반영
- 채널/유저 활동 텔레메트리 주기 반영
- 리액션 기반 보상 신호(thumbs-up/thumbs-down) 주기 반영
- 반복 ops-loop에서 timeout/retry/failure-rate 게이트 적용

즉, 동기화는 단순 파일 업로드가 아니라 길드별 컨텍스트 운영 루프의 일부입니다.

## 0.1) Graph-First Retrieval Doctrine (중요)

본 프로젝트의 기본 원칙은 청킹 우선 RAG가 아닙니다.

- 원칙 1: 문서를 임의 청크로 먼저 자르지 않는다.
- 원칙 2: Obsidian 그래프 관계(태그, 백링크, 링크 연결성)를 1급 신호로 사용한다.
- 원칙 3: 문맥 보존을 우선하고, 길이 제한이 필요할 때만 출력 단계에서 최소 절단한다.
- 원칙 4: Discord/커뮤니티 맥락에서도 동일한 그래프 기반 회수 정책을 유지한다.

운영 메모:

- 청킹은 예외적 fallback이며 기본 전략이 아니다.
- 그래프 품질 감사 결과(링크/고아/dead-end/속성 누락)를 배포 게이트와 연결한다.

## 1) 전제 조건

- Supabase schema 적용 완료 (`docs/SUPABASE_SCHEMA.sql`)
- Vault 구조:
  - 기본 루트: `.../guilds/<guildId>/`
  - 권장 하위 트리: `events/`, `memory/`, `policy/`, `playbooks/`, `experiments/`, `ops/`, `index/`
  - 길드별 수집 규칙: `.../guilds/<guildId>/index/manifest.json`
- 동기화 실행 머신에서 Node.js와 이 저장소 접근 가능

## 2) 환경 변수

최소 필수:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (또는 `SUPABASE_KEY`)
- `OBSIDIAN_SYNC_VAULT_PATH` (미설정 시 `OBSIDIAN_VAULT_PATH` 사용)

선택(강력 권장):

- `OBSIDIAN_SYNC_DISCORD_WEBHOOK_URL` (관리자 채널 웹훅 알림)

선택(Manifest 기본값):

- `OBSIDIAN_SYNC_DEFAULT_INCLUDE_GLOBS`
- `OBSIDIAN_SYNC_DEFAULT_EXCLUDE_GLOBS`
- `OBSIDIAN_SYNC_DEFAULT_MAX_FILES`

선택(신규 길드 자동 부트스트랩):

- `OBSIDIAN_AUTO_BOOTSTRAP_ON_GUILD_JOIN`
- `OBSIDIAN_AUTO_BOOTSTRAP_FORCE`
- `OBSIDIAN_AUTO_BOOTSTRAP_RUN_OPS_CYCLE`
- `OBSIDIAN_AUTO_BOOTSTRAP_OPS_TIMEOUT_SEC`
- `OBSIDIAN_AUTO_TOPOLOGY_SYNC_ON_GUILD_JOIN`
- `OBSIDIAN_AUTO_TOPOLOGY_SYNC_ON_READY`

선택(채널 활동/피드백 루프):

- `DISCORD_CHANNEL_TELEMETRY_ENABLED`
- `DISCORD_CHANNEL_TELEMETRY_FLUSH_EVERY_EVENTS`
- `DISCORD_CHANNEL_TELEMETRY_MAX_CHANNELS`
- `DISCORD_CHANNEL_TELEMETRY_MAX_USERS`
- `DISCORD_ENABLE_FEEDBACK_PROMPT`
- `DISCORD_FEEDBACK_PROMPT_LINE`
- `DISCORD_REACTION_REWARD_ENABLED`
- `DISCORD_REACTION_REWARD_FLUSH_EVERY_EVENTS`
- `DISCORD_REACTION_REWARD_MAX_MESSAGES`
- `DISCORD_REACTION_REWARD_MAX_USERS`

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

신규 길드 지식 트리 부트스트랩:

```bash
npm run obsidian:bootstrap-guild -- --guild 123456789012345678
```

Discord 봇이 새 길드에 들어올 때는 `guildCreate` 이벤트에서 동일한 부트스트랩이 자동 실행됩니다.
필요 시 `OBSIDIAN_AUTO_BOOTSTRAP_*` 환경 변수로 동작을 제어하세요.
같은 시점에 길드 카테고리/채널 구조 스냅샷도 `events/ingest/discord_topology_YYYY-MM-DD.md`로 자동 동기화됩니다.

또한 길드 메시지 흐름은 채널/유저 집계 형태로 `events/ingest/channel_activity_YYYY-MM-DD-HH.md`에 주기 반영됩니다.
메시지 반응(👍/😡)은 보상 신호로 집계되어 `events/reward/reaction_reward_YYYY-MM-DD-HH.md`에 주기 반영됩니다.

강제 재생성:

```bash
npm run obsidian:bootstrap-guild -- --guild 123456789012345678 --force
```

## 4) 동작 방식

- 길드 폴더를 스캔하여 markdown을 재귀 수집합니다.
- 앱의 `obsidian.guild_doc.upsert` 액션은 문서를 항상 `guilds/<guildId>/<문서명>.md` 경로로 저장합니다.
- 길드별 `index/manifest.json`이 있으면 include/exclude/maxFiles/sourcePrefix 규칙을 적용합니다.
- manifest가 없으면 환경 기본값(`OBSIDIAN_SYNC_DEFAULT_*`)을 사용합니다.
- 폴더명이 이미 Discord guild id라면 별도 매핑 없이 신규 서버가 자동 반영됩니다.
- 길드 폴더명과 실제 `guild_id`가 다르면 매핑(JSON/파일/CLI)으로 변환합니다.
- `guild_lore_docs`에 `guild_id + source` 기준으로 1행만 유지합니다.
- 중복 행이 있으면 최신 1행만 남기고 정리합니다.
- `source` 값은 다음 규칙을 사용합니다:
  - `obsidian-sync:<sourcePrefix>/<relativePath>`
  - 예: `obsidian-sync:knowledge/memory/semantic/Guild_Lore.md`
- 완료 후(드라이런 포함) `OBSIDIAN_SYNC_DISCORD_WEBHOOK_URL`가 있으면 관리자 채널에 요약을 전송합니다.

manifest 예시 파일:

- `docs/obsidian-guild-manifest.example.json`

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

## 6) Vault 쓰기 검증

Obsidian Vault에 실제로 파일이 생성/수정되는지 즉시 확인:

```bash
npm run obsidian:verify-write -- --guild 123456789012345678
```

출력 항목:

- `relativePath` (예: `guilds/123456789012345678/Guild_Lore.md`)
- `absolutePath`
- `marker` (파일 본문에 기록된 검증 문자열)

운영 API에서 어댑터 상태 확인:

- `GET /api/bot/agent/obsidian/runtime`
- 응답에 `selectedByCapability.write_note`가 `local-fs`면 현재 write adapter가 정상 선택된 상태입니다.

운영 API에서 그래프 품질 스냅샷 확인:

- `GET /api/bot/agent/obsidian/quality`
- 응답 `snapshot`은 최신 감사 결과(`.runtime/obsidian-graph-audit.json`)를 그대로 제공합니다.

## 7) 그래프 품질 감사 (RAG 품질 게이트)

텍스트량보다 링크/속성 정합성이 RAG 품질에 더 크게 영향을 줍니다. 아래 명령으로 매 실행 시 게이트를 적용하세요.

```bash
npm run obsidian:audit-graph
```

감사 항목:

- unresolved 링크 수
- ambiguous 링크 수(동일 basename 후보가 여러 개인 링크)
- orphan 파일 수(backlink 0)
- dead-end 파일 수(outgoing link 0)
- 필수 frontmatter 속성 누락 파일 수

결과:

- `.runtime/obsidian-graph-audit.json` 생성
- 임계치 초과 시 비정상 종료(exit 1)

## 8) 통합 운영 사이클 (지식 운영체제 루프)

하나의 명령으로 `쓰기 검증 -> 그래프 감사 -> Supabase 동기화`를 순차 실행:

```bash
npm run obsidian:ops-cycle -- --guild 123456789012345678
```

동기화 생략(테스트용):

```bash
npm run obsidian:ops-cycle -- --guild 123456789012345678 --skip-sync
```

고주기 반복 실행(예: 5분 간격):

```bash
npm run obsidian:ops-loop -- --guild 123456789012345678 --interval-sec 300
```

전체 길드 자동 발견 모드:

```bash
npm run obsidian:ops-loop -- --all-guilds --vault "C:\\Users\\you\\Documents\\Obsidian Vault" --interval-sec 300
```

운영 안정화 옵션(타임아웃/재시도/실패율 게이트):

```bash
npm run obsidian:ops-loop -- --guild 123456789012345678 --interval-sec 300 --timeout-sec 900 --retry-count 1 --max-failure-rate 0.4
```

동일 머신에서 중복 실행은 `.runtime/obsidian-ops-loop.lock`으로 차단됩니다.

운영 권장:

- loop를 상시 운영할 때는 `--max-failure-rate`를 반드시 설정합니다.
- 실패율이 임계치를 넘으면 자동 중지되므로 원인 확인 후 재시작합니다.
- 장애 대응 시 먼저 lock 파일 stale 여부와 timeout 설정 과소 여부를 확인합니다.

한정 반복 실행(예: 12회 실행 후 종료):

```bash
npm run obsidian:ops-loop -- --guild 123456789012345678 --interval-sec 300 --max-runs 12
```

## 9) CLI vs Headless 역할 분리

- Obsidian CLI: 데스크톱 실행 상태에서 고급 편집/명령 자동화
- Obsidian Headless: 서버/원격 환경에서 동기화 중심 자동화

권장 원칙:

- 편집/분류/플러그인 명령은 CLI 중심
- 서버 배치/백업/원격 동기화는 Headless 중심

배포 전 필수 점검:

- CLI 전용 작업이 서버 배치 경로에 포함되지 않았는지 확인

## 9.1) 권장 확정 프로파일 (Headless-first + write fallback)

아래 프로파일을 기준으로 운영하면, 읽기/검색/그래프 조회는 Headless를 우선 사용하고, 쓰기는 local-fs 경로를 유지해 리스크를 낮출 수 있습니다.

```bash
OBSIDIAN_HEADLESS_ENABLED=true
OBSIDIAN_HEADLESS_COMMAND=ob

OBSIDIAN_ADAPTER_ORDER=headless-cli,script-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_READ_LORE=headless-cli,script-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT=headless-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_READ_FILE=headless-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA=headless-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE=local-fs,script-cli

OBSIDIAN_ADAPTER_STRICT=false
```

검증 절차:

- `GET /api/bot/agent/obsidian/runtime`
- 응답에서 `selectedByCapability.read_lore|search_vault|read_file|graph_metadata`가 `headless-cli`인지 확인
- 응답에서 `selectedByCapability.write_note`가 `local-fs`인지 확인

## 9.2) 무인 운영 프로파일 (로컬 PC 오프 전제)

목표: 개인 PC가 꺼져 있어도 Render + Discord Bot + LiteLLM 프록시 + Headless로 지속 운영.

원칙:

- 읽기/검색/그래프는 Headless 경로 고정
- 쓰기는 Obsidian 파일 직접 쓰기보다 Supabase 메모리 테이블(memory_items, guild_lore_docs) 우선
- 모델 라우팅은 LiteLLM 프록시 단일 엔드포인트로 고정

권장 env 프로파일:

```bash
AI_PROVIDER=openclaw
OPENCLAW_BASE_URL=https://<litellm-proxy-endpoint>
OPENCLAW_API_KEY=<secret>

OBSIDIAN_HEADLESS_ENABLED=true
OBSIDIAN_HEADLESS_COMMAND=ob
OBSIDIAN_VAULT_NAME=<vault-name>

OBSIDIAN_ADAPTER_ORDER=headless-cli,script-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_READ_LORE=headless-cli,script-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_SEARCH_VAULT=headless-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_READ_FILE=headless-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_GRAPH_METADATA=headless-cli,local-fs
OBSIDIAN_ADAPTER_ORDER_WRITE_NOTE=local-fs,script-cli
OBSIDIAN_ADAPTER_STRICT=false
```

운영 체크:

- `GET /api/bot/agent/obsidian/runtime`에서 read/search/read_file/graph가 `headless-cli`인지 확인
- `GET /ready`에서 provider 미구성/adapter 미가용 경고가 없는지 확인
- memory retrieval 로그(`memory_retrieval_logs`)와 ToT 후보 로그(`agent_tot_candidate_pairs`)가 지속 누적되는지 확인

주의:

- 현재 headless adapter는 읽기 중심(capability: read_lore/search_vault/read_file/graph_metadata)이며 write_note는 직접 제공하지 않습니다.
- 따라서 문서 업데이트 자동화는 Supabase 메모리-파이프라인을 주 경로로 두고, 파일 쓰기는 보조 경로로 운영하는 것이 안전합니다.

## 10) Sourcetrail 스타일 코드 조망 (함수/클래스 + 백링크)

개인 Obsidian Vault에서 전체 코드를 함수/클래스 단위로 조망하려면 아래 명령을 사용합니다.

1회 생성:

```bash
npm run obsidian:code-map -- --repo "C:\\Users\\fancy\\Documents\\Git Muel\\Git Muel" --vault "C:\\Users\\fancy\\Documents\\Git Muel\\Git Muel"
```

변경 자동 동기화(watch):

```bash
npm run obsidian:code-map:watch -- --repo "C:\\Users\\fancy\\Documents\\Git Muel\\Git Muel" --vault "C:\\Users\\fancy\\Documents\\Git Muel\\Git Muel"
```

생성 경로(기본):

- `index/code-map/_INDEX.md`
- `index/code-map/hubs/_SYSTEM.md` (읽기 순서 허브)
- `index/code-map/hubs/_ENTRYPOINTS.md` (진입점 허브)
- `index/code-map/hubs/architecture/*.md` (아키텍처별 허브)
- `index/code-map/files/*.md` (파일 노트)
- `index/code-map/symbols/class/*.md`, `index/code-map/symbols/function/*.md` (심볼 노트)

노트 특징:

- 함수/클래스별 독립 문서 생성
- 파일 -> 심볼, 심볼 -> 관련 심볼, 심볼 -> 참조 파일 링크 자동 연결
- 파일 노트에 `Primary Dependencies` / `Primary Dependents` 섹션 자동 생성
- 심볼 노트에 `Breadcrumb`(Layer/Architecture/Entry Context) 자동 생성
- 심볼 링크를 `Primary(import 기반)` / `Related Mentions(텍스트 기반)`로 분리
- `#code-map`, `#code/file`, `#code/symbol` 태그 자동 부여
- Headless 동기화 작업이 데스크톱 의존 없이 실행 가능한지 확인
- 역할 경계가 흐려진 변경은 no-go 처리 후 수정

태그 유연화(환경변수):

- `OBSIDIAN_CODEMAP_TAG_BASE`: 공통 베이스 태그 (기본 `code-map`)
- `OBSIDIAN_CODEMAP_TAG_FILE`: 파일 노트 태그 (기본 `code-file,code/file`)
- `OBSIDIAN_CODEMAP_TAG_SYMBOL`: 심볼 노트 태그 (기본 `symbol,code/symbol`)
- `OBSIDIAN_CODEMAP_TAG_SYMBOL_KIND_PREFIX`: 심볼 kind 접두사 (기본 `symbol`, 결과 예: `symbol/function`)
- `OBSIDIAN_CODEMAP_TAG_INDEX`: 인덱스 노트 태그 (기본 `index`)
- `OBSIDIAN_CODEMAP_TAG_PATH_ENABLED`: 경로 기반 태그 생성 여부 (`true/false`)
- `OBSIDIAN_CODEMAP_TAG_PATH_PREFIX`: 경로 태그 prefix (기본 `code/path`)
- `OBSIDIAN_CODEMAP_TAG_PATH_DEPTH`: 경로 태그 깊이 (기본 `3`)
- `OBSIDIAN_CODEMAP_TAG_INCLUDE_EXTENSION`: 확장자 태그 추가 여부 (`true/false`, 예: `code/ext/ts`)
- `OBSIDIAN_CODEMAP_TAG_INLINE_ENABLED`: 본문 `#tag` 라인 출력 여부 (기본 `false`, 중복 태그 방지 권장)
- `OBSIDIAN_CODEMAP_ARCH_TAG_RULES`: 경로 기반 아키텍처 태그 규칙 (`pathPrefix:tag` CSV)

태그 유연화(CLI):

```bash
npm run obsidian:code-map -- --repo "C:\\Muel_S\\discord-news-bot" --vault "C:\\Users\\fancy\\Documents\\Git Muel\\Git Muel" --tag-base "code-map,kamibot" --tag-file "code-file,discord-file" --tag-symbol "symbol,discord-symbol" --tag-path-enabled --tag-path-prefix "code/path" --tag-path-depth 2 --tag-include-extension
```

중복 태그/아키텍처 구분 개선 팁:

- Obsidian에서 태그 중복(Frontmatter + 본문 #tag)이 보이면 `OBSIDIAN_CODEMAP_TAG_INLINE_ENABLED=false` 유지
- 아키텍처 구분은 `OBSIDIAN_CODEMAP_ARCH_TAG_RULES`로 강제
- 예: `src/discord:arch/discord,src/services/obsidian:arch/obsidian,scripts:arch/tooling`

## 10) 복구 및 회귀 대응

오작동이나 품질 저하 시 복구 우선순위:

1. `obsidian diff` / `history:read` / `history:restore`로 문서 버전 확인 및 복구
2. `npm run obsidian:audit-graph`로 그래프 정합성 재검증
3. `npm run sync:obsidian-lore` 재실행으로 DB 반영 상태 정합화

## 11) 보안 경계 권장

- 에이전트 전용 Obsidian 계정/볼트 분리
- 운영 볼트 경로는 최소 권한 계정으로만 접근
- webhook, Supabase service role key는 배치 머신 외부 노출 금지

## 12) 운영 팁

- 먼저 `sync:obsidian-lore:dry`로 경로/권한 검증 후 실제 반영하세요.
- Service role key는 읽기/쓰기 권한이 크므로 동기화 머신 외부에 노출하지 마세요.
- 동기화 주기는 15~60분부터 시작하는 것을 권장합니다.
- 이 동기화는 `guild_lore_docs`를 갱신하며, 런타임 메모리 검색은 `memory_items`와 함께 병행됩니다.
- Discord 알림은 서버 봇 토큰이 아닌 웹훅 방식이라 Render 인스턴스와 독립적으로 운영할 수 있습니다.
- 답변 하단 피드백 문구(`-# ...`)는 `DISCORD_ENABLE_FEEDBACK_PROMPT`로 제어할 수 있습니다.

## 13) 문서 업데이트 트리거

다음 변경이 발생하면 본 문서를 즉시 갱신합니다.

- 신규 자동 수집 소스 추가(예: 새로운 Discord 이벤트 계열)
- bootstrap 트리 구조 변경 또는 manifest 규칙 변경
- loop 제어 파라미터(timeout/retry/failure-rate/interval) 기본값 변경
- 보상 신호 처리 규칙 변경(가중치, 집계 단위, flush 정책)
