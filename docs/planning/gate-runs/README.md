# Gate Run Logs

이 디렉터리는 Progressive Autonomy Stage 판정 로그를 저장합니다.

생성 명령:

```bash
npm run gates:init-log -- --stage=A --scope=guild:123 --operator=auto
```

생성 결과:

- `YYYY-MM-DD_<runId>.md` (운영자 가독용)
- `YYYY-MM-DD_<runId>.json` (집계/자동화용 구조화 로그)

주간 집계:

```bash
npm run gates:weekly-report -- --days=7
```

로그 형식 검증:

```bash
npm run gates:validate
```

고정 fixture 회귀 검증:

```bash
npm run gates:fixtures:check
```

주간 집계 경로 검증(쓰기 없이 dry-run):

```bash
npm run gates:weekly-report:dry
```

스키마 계약:

- `docs/planning/GO_NO_GO_RUN_SCHEMA.json`
- `scripts/validate-go-no-go-runs.mjs`는 위 키셋 계약 + 의사결정 의미 규칙(no-go rollback 필수)을 함께 검증한다.

운영 규칙:

- 각 stage 판정마다 최소 1건의 로그를 생성한다.
- `overall=no-go`인 경우 rollback 유형과 기한을 반드시 채운다.
- incident/comms 문서와 증거 링크를 연결한다.
- CI는 `gates:validate` 실패 시 머지를 차단한다.
- CI는 `gates:fixtures:check` 실패 시 no-go 규칙 회귀를 차단한다.
- CI는 `gates:weekly-report:dry` 실패 시 집계 경로 불일치를 차단한다.
