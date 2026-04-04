# Sprint Pipeline Environment Variables

All sprint pipeline configuration is defined in `src/config.ts`.

## Core

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_ENABLED` | boolean | `false` | Master switch — enables autonomous sprint pipeline |
| `SPRINT_AUTONOMY_LEVEL` | enum | `approve-ship` | `full-auto` / `approve-ship` / `approve-impl` / `manual` |
| `SPRINT_MAX_IMPL_REVIEW_LOOPS` | int | `3` | Max implement→review loop iterations before forced advance |
| `SPRINT_MAX_TOTAL_PHASES` | int | `12` | Circuit breaker — max total phase transitions per pipeline |
| `SPRINT_CHANGED_FILE_CAP` | int | `10` | Max files changed in a single sprint (scope guard) |
| `SPRINT_PHASE_TIMEOUT_MS` | int | `120000` | Per-phase timeout (ms) |
| `SPRINT_PIPELINES_TABLE` | string | `sprint_pipelines` | Supabase table for pipeline state persistence |
| `SPRINT_DRY_RUN` | boolean | `false` | Dry-run mode — skips Supabase persist and git operations, logs what would happen |

## Triggers

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_TRIGGER_ERROR_THRESHOLD` | int | `5` | Runtime errors within window to auto-trigger bugfix sprint |
| `SPRINT_TRIGGER_CS_CHANNEL_IDS` | string | `""` | Comma-separated Discord channel IDs for CS ticket classification |
| `SPRINT_TRIGGER_CRON_SECURITY_AUDIT` | string | `""` | Cron expression for scheduled security audit sprints |
| `SPRINT_TRIGGER_CRON_IMPROVEMENT` | string | `""` | Cron expression for scheduled code improvement sprints |

## Git / GitHub

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_GIT_ENABLED` | boolean | `false` | Enable autonomous git operations (branch/commit/PR) |
| `SPRINT_GITHUB_TOKEN` | string | `""` | GitHub PAT for PR creation |
| `SPRINT_GITHUB_OWNER` | string | `""` | GitHub repository owner |
| `SPRINT_GITHUB_REPO` | string | `""` | GitHub repository name |

## Fast Path (Deterministic Phases)

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_FAST_PATH_ENABLED` | boolean | `true` | Enable zero-LLM-token fast path for qa/ops-validate/ship |
| `SPRINT_FAST_PATH_VITEST_TIMEOUT_MS` | int | `60000` | Vitest execution timeout in fast-path QA |
| `SPRINT_FAST_PATH_TSC_TIMEOUT_MS` | int | `30000` | tsc --noEmit timeout in fast-path QA |

## Cross-Model Outside Voice

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_CROSS_MODEL_ENABLED` | boolean | `false` | Enable cross-model voice for designated phases |
| `SPRINT_CROSS_MODEL_PROVIDER` | string | `""` | LiteLLM model identifier for outside voice |
| `SPRINT_CROSS_MODEL_PHASES` | string | `review,security-audit` | Comma-separated phases that use cross-model |

## Scope Guard

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_SCOPE_GUARD_ENABLED` | boolean | `true` | Enable file/command scope guard |
| `SPRINT_SCOPE_GUARD_ALLOWED_DIRS` | string | `src,scripts,tests,.github/skills` | Comma-separated allowed directories |
| `SPRINT_SCOPE_GUARD_PROTECTED_FILES` | string | `package.json,.env,ecosystem.config.cjs,render.yaml` | Comma-separated protected files (write blocked) |

## LLM-as-Judge

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_LLM_JUDGE_ENABLED` | boolean | `false` | Enable LLM judge evaluation for tier-3 quality gates |
| `SPRINT_LLM_JUDGE_PHASES` | string | `review,retro` | Comma-separated phases with LLM judge evaluation |

## Autoplan

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `SPRINT_AUTOPLAN_ENABLED` | boolean | `false` | Enable multi-lens autoplan sub-pipeline |
| `SPRINT_AUTOPLAN_LENSES` | string | `ceo,engineering,security` | Comma-separated planning lenses |

## External Adapter Integration

| Variable | Type | Default | Description |
| --- | --- | --- | --- |
| `OPENCLAW_ENABLED` | boolean | `false` | Enable OpenClaw adapter for sprint phases |
| `OPENCLAW_GATEWAY_URL` | string | `""` | OpenClaw Gateway HTTP endpoint (e.g., `http://34.56.232.61:18789`) |
| `OPENCLAW_GATEWAY_TOKEN` | string | `""` | Bearer token for OpenClaw Gateway authentication |
| `OPENJARVIS_ENABLED` | boolean | `false` | Enable OpenJarvis adapter for sprint phases |
| `NEMOCLAW_ENABLED` | boolean | `false` | Enable NemoClaw adapter for sprint phases |
| `OPENSHELL_ENABLED` | boolean | `false` | Enable OpenShell adapter (qa/security-audit secondary) |
| `DEEPWIKI_ADAPTER_ENABLED` | boolean | `false` | Enable DeepWiki adapter (plan/retro enrichment) |
| `N8N_ENABLED` | boolean | `false` | Enable n8n adapter (ops-validate enrichment) |
| `SPRINT_CROSS_MODEL_NEMOCLAW_ENABLED` | boolean | `false` | Enable NemoClaw as cross-model outside voice for review phases |

## Recommended Profiles

### Development (local)

```env
SPRINT_ENABLED=false
SPRINT_DRY_RUN=true
SPRINT_GIT_ENABLED=false
```

### Staging (local-first-hybrid)

```env
SPRINT_ENABLED=true
SPRINT_AUTONOMY_LEVEL=approve-impl
SPRINT_DRY_RUN=true
SPRINT_GIT_ENABLED=false
```

### Production

```env
SPRINT_ENABLED=true
SPRINT_AUTONOMY_LEVEL=approve-ship
SPRINT_DRY_RUN=false
SPRINT_GIT_ENABLED=true
SPRINT_GITHUB_TOKEN=ghp_...
SPRINT_GITHUB_OWNER=your-org
SPRINT_GITHUB_REPO=muel-platform
SPRINT_TRIGGER_CRON_SECURITY_AUDIT=0 3 * * 1
SPRINT_TRIGGER_CRON_IMPROVEMENT=0 4 * * 5
```

## Applying Profiles

Sprint variables are included in env profile files under `config/env/`. Apply with:

```bash
node scripts/apply-env-profile.mjs local              # Dev: sprint disabled, dry-run on
node scripts/apply-env-profile.mjs local-first-hybrid  # Staging: sprint enabled, dry-run on
node scripts/apply-env-profile.mjs production          # Prod: sprint enabled, git enabled
```

Preview changes without modifying `.env`:

```bash
node scripts/apply-env-profile.mjs local --dry-run
```

A backup is created at `.env.profile-backup` on each apply.
