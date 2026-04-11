# IDE MCP Workspace Setup

목표:

- 이 저장소를 VS Code에서 열었을 때 워크스페이스 MCP 서버를 바로 인식하게 한다.
- shared/team context는 GCP shared MCP를 우선 사용하고, dirty workspace는 로컬 overlay로 분리한다.
- 팀원이 GCP shared MCP에 접속하고, 새 도구 변경을 publish하는 절차를 문서화한다.

## 등록된 워크스페이스 MCP 서버

설정 파일:

- `.vscode/mcp.json`

### stdio 서버

- `muelIndexing`: `npm run mcp:indexing:dev` — local overlay index for dirty workspace / uncommitted files only
- `muelUnified`: `npm run mcp:unified:dev` — local unified hub for actions, ext adapters, upstream tools, and local-only vault overlay work
- `gcpCompute`: SSH stdio — GCP VM shared unified MCP for team-shared repo state and shared tool surface

### HTTP upstream 서버

HTTP 외부 MCP 서버는 `.vscode/mcp.json`에 직접 등록하지 않고 `MCP_UPSTREAM_SERVERS` 환경 변수로 구성한다.
`muelUnified`가 시작될 때 자동으로 `upstream.<namespace>.*` 도구로 노출된다. 현재는 각 upstream entry에 `toolAllowlist` / `toolDenylist` 와일드카드 필터와 federation metadata (`label`, `plane`, `audience`, `owner`, `sourceRepo`)를 함께 지정할 수 있다.

권장 역할 분리:

- shared Obsidian: semantic owner. 의사결정, 의미, 링크 그래프, durable knowledge의 정본
- shared Supabase MCP (`supabase_ro`): operational read plane. advisor, migration, schema, logs, branch/runtime diagnostics의 팀 공용 읽기 표면
- direct Supabase SDK / admin-only surface: write, DDL, migration apply, 운영 수정 경로
- future Supabase extension growth belongs on the operational side: pgvector, pg_trgm, pg_cron, pg_net, HypoPG, pg_stat_statements, and similar DB capabilities should remain Supabase-native and only be projected into human-facing Obsidian surfaces when needed

federated 확장 규칙:

- 다른 레포의 external execution runtime, projection service, 별도 Obsidian wiki도 checkout 공유 없이 namespace 단위로 붙인다.
- 공용면에 올리는 기본 단위는 source tree가 아니라 capability lane이다.
- semantic lane, operational lane, execution lane, control lane을 분리해 두면 repo/VM/service가 달라도 운영 경계가 덜 무너진다.
- 현재 붙어 있는 lane은 `diag.upstreams`로 바로 확인할 수 있다.

- Supabase MCP: namespace `supabase_ro` 또는 `supabase`, `.env`의 `MCP_UPSTREAM_SERVERS` JSON 배열로 등록
- DeepWiki MCP: namespace `deepwiki`, `.env`의 `MCP_UPSTREAM_SERVERS` JSON 배열로 등록
- 외부 execution runtime: namespace `exec_<lane>` 형태 권장
- 별도 use-case wiki/shared knowledge lane: namespace `wiki_<domain>` 형태 권장

예시 `.env`:

```env
MCP_UPSTREAM_SERVERS=[{"id":"supabase-ro","label":"Shared Supabase Read Plane","url":"https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF","namespace":"supabase_ro","token":"sbp_xxx","protocol":"streamable","plane":"operational","audience":"shared","owner":"team-muel","sourceRepo":"team-muel/discord-news-bot","toolAllowlist":["get_*","list_*","*_advisors","*_migrations","*_branches","*_logs"]},{"id":"deepwiki","label":"DeepWiki Repo Docs","url":"https://mcp.deepwiki.com/mcp","namespace":"deepwiki","plane":"semantic","audience":"shared","owner":"team-muel"},{"id":"external-projection","label":"External Projection Runtime","url":"https://runtime.example.com/mcp","namespace":"exec_projection","protocol":"streamable","plane":"execution","audience":"shared","owner":"team-runtime","sourceRepo":"team-runtime/projection-runtime","toolAllowlist":["project_*","refresh_*","status_*"]},{"id":"wiki-usecases","label":"Use Case Wiki","url":"https://wiki.example.com/mcp","namespace":"wiki_usecases","plane":"semantic","audience":"hybrid","owner":"team-knowledge","sourceRepo":"team-knowledge/usecase-wiki","toolAllowlist":["read_*","search_*","graph_*"]}]
```

운영 원칙:

- shared `supabase_ro`는 팀 공용 read-only surface로만 쓴다
- write, raw SQL mutation, DDL, extension 변경, cron 설치/수정은 shared surface에 싣지 않는다
- 그런 작업이 필요하면 별도 operator-only namespace 또는 별도 host를 둔다
- execution lane은 가급적 idempotent, replay-safe, auth-bounded capability만 노출한다
- semantic lane은 human-facing knowledge object를 우선하고, raw storage path나 내부 작업트리 공유를 목표로 삼지 않는다

## 팀 온보딩 순서

1. `scripts/bootstrap-team.ps1`를 실행한다.
2. 생성된 SSH public key를 팀 리드에게 전달한다.
3. 팀 리드는 `scripts/register-team-ssh.ps1`로 키를 등록한다.
4. VS Code를 재시작하고 `MCP: List Servers`에서 `gcpCompute`를 Enable 또는 Start 한다.
5. shared MCP 쪽 도구를 바꿨다면 `scripts/publish-gcp-shared-mcp.ps1 -RestartServices`로 GCP VM에 반영한다.

### shared-only 구조

- `gcpCompute`만 먼저 쓰려면 `scripts/bootstrap-team.ps1 -SharedOnly`로 시작한다.
- 이 경로는 SSH key만 전제한다. 팀원에게 local `OBSIDIAN_REMOTE_MCP_TOKEN`, `MCP_SHARED_MCP_TOKEN`, 또는 로컬 `.env`를 먼저 배포할 필요가 없다.
- shared Obsidian auth와 upstream auth는 GCP shared MCP runtime이 보유한다. 팀원이 shared surface를 쓰기 위해 별도 Obsidian token을 들고 있을 이유가 없다.
- local `muelUnified`와 `muelIndexing`는 나중에 필요해질 때만 다시 켠다. 기본 shared truth 확인에는 필요하지 않다.

### catalog rescue 절차

- 어떤 커스텀 로컬 MCP 서버가 VS Code tool catalog를 깨뜨리면, 먼저 nonstandard local/global server를 잠시 disable하고 `github` + `gcpCompute`만으로 세션을 띄운다.
- `tool parameters array type must have items` 같은 오류는 대개 해당 서버가 invalid inputSchema를 내보내는 경우다. shared gcpCompute 경로는 upstream schema를 IDE-safe 하게 정규화해서 같은 종류의 upstream drift가 shared catalog 전체를 깨뜨리지 않도록 방어한다.
- 세션이 복구된 뒤에만 문제가 된 로컬 서버를 다시 고치거나 재등록한다.

## 팀 전면 수용 readiness gates

팀원이 `gcpCompute`를 기본 shared surface로 쓰게 하려면 다음 조건을 먼저 만족시키는 편이 안전하다.

- identity/access gate: 팀원마다 개별 SSH key를 등록하고, private key 공유를 금지한다. shared lane token도 개인용 비밀과 섞지 않는다.
- lane contract gate: shared upstream entry마다 `namespace`, `label`, `plane`, `audience`, `owner`, `sourceRepo`를 채운다. 팀원이 보는 것은 checkout이 아니라 lane registry여야 한다.
- safety gate: 팀 공용 lane은 read-only 또는 idempotent capability 위주로 둔다. write, DDL, extension mutation, cron mutation은 별도 operator-only namespace 또는 별도 host로 분리한다.
- observability gate: public `/mcp/health`에서 `upstreams` 요약이 보여야 하고, IDE에서는 `diag.upstreams`로 같은 lane 구성을 다시 확인할 수 있어야 한다.
- knowledge gate: repo source doc와 shared Obsidian profile이 같이 움직여야 한다. 이 문서를 바꿨다면 `scripts/backfill-obsidian-system.ts --entry service-unified-mcp-profile --overwrite`로 `ops/services/unified-mcp/PROFILE.md`를 같은 change window 안에 다시 올린다.
- drift gate: shared MCP는 `/opt/muel/shared-mcp-runtime` 같은 published non-git runtime mirror에서 실행하는 편이 안전하다. git checkout을 바로 실행 표면으로 쓰면 deploy와 runtime drift가 같은 working tree에 쌓인다.
- onboarding gate: 팀원은 bootstrap 직후 어떤 서버를 언제 쓰는지 알아야 한다. `gcpCompute`는 shared truth, `muelIndexing`는 local overlay, `muelUnified`는 local-only 실험과 upstream aggregation으로 고정해서 설명한다.

## GCP shared MCP 운영 기준

- canonical public ingress: `https://34.56.232.61.sslip.io/mcp`
- compatibility alias: `https://34.56.232.61.sslip.io/obsidian`
- shared runtime path: `/opt/muel/shared-mcp-runtime`
- legacy source checkout may still exist at `/opt/muel/discord-news-bot`, but shared MCP should not execute from that git working tree.
- shared runtime override file: `config/env/unified-mcp.gcp.env`
- `gcpCompute`는 원격에서 `.env`를 먼저 로드하고, 그 다음 `config/env/unified-mcp.gcp.env` override를 로드한다.
- `unified-mcp-http.service`도 같은 순서로 env를 읽는다.

## 강화된 GCP VM에서 다음 우선순위

이제 우선순위는 "새 lane을 더 붙이는 일"보다 "shared truth를 더 명확하게 운영하는 일"이다.

1. lane contract completeness를 release gate로 취급한다.
   - `namespace`, `label`, `plane`, `audience`, `owner`, `sourceRepo` 중 하나라도 빠지면 단순 메타데이터 누락이 아니라 운영 계약 결손으로 본다.
2. shared runtime mirror 원칙을 계속 유지한다.
   - shared MCP는 git checkout이 아니라 `/opt/muel/shared-mcp-runtime` 같은 published non-git mirror에서만 실행한다.
3. shared publish 검증을 도구 단위가 아니라 lane 단위로 한다.
   - publish 후 `GET /mcp/health`와 `diag.upstreams`를 같이 보고, visible tool 수만이 아니라 metadata, filter, collision 상태까지 확인한다.
4. shared public lane은 read-only 또는 idempotent capability 위주로 유지한다.
   - write, DDL, cron mutation, privileged admin 작업은 operator-only namespace 또는 별도 host로 분리한다.
5. drift review를 정기 업무로 넣는다.
   - 매일은 health, upstream summary, role worker 상태를 보고, 주간에는 stale lane, filter drift, shared vault root drift를 같이 점검한다.

## IDE에서 Copilot을 잘 쓰는 기준

좋은 결과를 얻기 위해 프롬프트 템플릿이 필요한 것은 아니다. 대신 아래 4가지만 명확하면 된다.

1. 먼저 어떤 truth surface를 기준으로 볼지 말한다.
   - shared truth면 `gcpCompute`, dirty local overlay면 `muelIndexing`, local aggregation이나 실험이면 `muelUnified`를 먼저 보게 한다.
2. 요청의 종류를 짧게 분류한다.
   - `shared review`, `local fix`, `publish risk check` 중 어디에 가까운지만 말해도 검색 경로와 검증 범위가 크게 좋아진다.
3. control-plane 변경에는 구현만이 아니라 hardening까지 같이 요구한다.
   - route, health, diagnostics, docs sync, rollback visibility를 함께 보라고 하면 후행 drift가 줄어든다.
4. vague한 질문이어도 agent가 분류와 개선을 먼저 하도록 기대한다.
   - 사용자가 완성형 프롬프트를 만드는 것이 아니라, agent가 현재 요청을 shared problem, local problem, ops problem으로 먼저 정리하는 것이 맞다.

권장 협업 루틴:

- shared issue가 의심되면 먼저 "shared truth 기준으로 보고 local dirty overlay는 나중에 덧씌워 달라"고 요청한다.
- publish 전에는 "operator-visible contract change인지부터 분류하고, 맞다면 same-window close-out까지 포함해 달라"고 요청한다.
- local patch를 하고 있어도 shared MCP drift가 의심되면 먼저 `diag.upstreams`와 shared health를 확인하게 한다.

## same-window completion rule

shared Obsidian promotion이나 shared profile sync를 별도 프로젝트처럼 떼어내지 않는다.

operator-visible 또는 architecture-significant한 shared MCP 변경은 같은 change window 안에서 아래를 함께 닫는다.

1. repo source doc 갱신
2. 필요 시 `docs/CHANGELOG-ARCH.md` 갱신
3. shared service profile backfill 실행
   - `npm run obsidian:backfill:system -- --entry service-unified-mcp-profile --overwrite`
4. publish 또는 반영 확인
   - `GET /mcp/health`
   - `diag.upstreams`

반대로 아래는 same-window shared promotion 대상이 아니다.

- dirty local overlay 실험
- 아직 operator-visible contract로 승격되지 않은 임시 구조 탐색
- local-only scratch notes 또는 prompt 실험

## 팀 공용 운영 체크리스트

매일 빠르게 보는 항목:

1. `GET /mcp/health`에서 shared ingress와 upstream summary가 정상인지 확인한다.
2. `diag.upstreams`에서 lane metadata, filter, cache 상태, tool collision 여부를 확인한다.
3. `GET /api/bot/agent/actions/catalog`와 `GET /api/bot/agent/runtime/role-workers`로 실제 callable surface를 확인한다.
4. shared vault 관련 작업이면 `GET /api/bot/agent/obsidian/runtime`도 함께 본다.

shared publish 직후 추가로 보는 항목:

1. 새 lane 또는 수정된 lane의 visible tool count가 기대치와 맞는지 본다.
2. allowlist/denylist 적용 결과가 의도와 맞는지 확인한다.
3. sanitized-name collision이나 invalid schema drift가 새로 생기지 않았는지 확인한다.
4. operator-visible 문서가 바뀌었다면 같은 change window에서 service profile backfill까지 닫았는지 확인한다.

## 권장 사용 방식

1. 팀 공용 상태, 운영 기준, 공용 repo index, shared Obsidian read/write는 `gcpCompute` 우선
2. dirty workspace, 미커밋 변경, 로컬 실험은 `muelIndexing` 우선
3. 일반 MCP 액션, upstream 도구, 로컬 전용 vault 실험은 `muelUnified` 사용
4. raw grep/read 전에 index 도구로 범위를 먼저 줄인다.

## indexing overlap 기준

| 상황 | 기본 서버 | 이유 |
| ---- | --------- | ---- |
| 팀 공용 branch 상태, 커밋된 코드, 리뷰 기준선 | `gcpCompute` | 팀이 공유하는 동일 repo 상태를 본다 |
| 미커밋 변경, 로컬 임시 파일, branch-only 실험 | `muelIndexing` | 로컬 overlay를 즉시 반영한다 |
| shared truth와 local patch를 함께 봐야 하는 경우 | `gcpCompute` 후 `muelIndexing` | 먼저 shared 기준선을 잡고 local diff만 overlay로 비교한다 |

겹치는 인덱싱 도구는 `symbol_search`, `symbol_define`, `symbol_references`, `file_outline`, `scope_read`, `context_bundle`, `security.candidates_list`다. 이 7개는 모두 shared/team 기준이면 `gcpCompute`, local-only 변경이면 `muelIndexing`로 고정해서 생각하는 편이 덜 헷갈린다.

## shared MCP 변경 publish 원칙

1. shared MCP publish target은 git checkout이 아니라 non-git runtime mirror여야 한다. runtime mirror가 git repo처럼 잡히면 수정하거나 `-Force`로만 진행한다.
2. 기본 publish 세트는 shared MCP surface와 shared indexing에 필요한 파일과 디렉터리만 sync한다.
3. 새 도구가 기본 세트 밖 파일을 건드리면 `-IncludePath`로 추가 경로를 넘긴다.
4. publish 후에는 `https://34.56.232.61.sslip.io/mcp/health`로 health를 확인한다.
5. service profile이나 onboarding contract를 바꿨다면 `scripts/backfill-obsidian-system.ts --entry service-unified-mcp-profile --overwrite`로 shared Obsidian mirror도 같은 change window에서 갱신한다.

## 운영 메모

- Windows에서는 MCP sandboxing을 기대하지 않는다.
- `muelIndexing`은 `.env`를 로드하며, 워크스페이스 루트를 인덱싱 루트로 사용하는 local overlay다. shared truth를 대체하는 기본 인덱서로 쓰지 않는다.
- `muelUnified`는 시작 시 `MCP_UPSTREAM_SERVERS`를 파싱하여 upstream 서버를 자동 등록한다.
- `diag.upstreams`는 현재 등록된 upstream namespace, metadata, filter, cached catalog 상태를 JSON으로 보여준다.
- 응답에는 `metadata.repoId`, `metadata.branch`, `metadata.commitSha`, `metadata.indexedAt`, `metadata.indexVersion`, `metadata.freshness`가 포함된다.
- stricter 운영이 필요하면 `.env`에 `INDEXING_MCP_STRICT=true` 또는 `INDEXING_MCP_STALE_POLICY=fail`을 설정한다.
- `security.candidates_list`는 `view=raw|merged`를 지원한다. merged 파일이 없으면 raw JSONL로부터 review unit을 즉시 합성한다.

## 트러블슈팅

1. 서버가 보이지 않으면 `MCP: Open Workspace Folder MCP Configuration`으로 `.vscode/mcp.json`을 확인한다.
2. 도구가 안 보이면 `MCP: Reset Cached Tools` 후 서버를 Restart 한다.
3. 신뢰 문제면 `MCP: Reset Trust` 후 다시 Start 한다.
4. `gcpCompute`가 연결되지 않으면 `scripts/bootstrap-team.ps1` 출력에서 SSH access 상태와 shared MCP health 상태를 확인한다.
5. upstream 도구가 보이지 않으면 `.env`의 `MCP_UPSTREAM_SERVERS` JSON과 `toolAllowlist` / `toolDenylist` 패턴을 검증하고 `muelUnified`를 Restart 한다.
6. `tool parameters array type must have items`가 뜨면 invalid schema를 내보내는 로컬/외부 MCP 서버가 있는지 확인하고, 우선 `scripts/bootstrap-team.ps1 -SharedOnly` 경로로 `github` + `gcpCompute`만 복구한다.
