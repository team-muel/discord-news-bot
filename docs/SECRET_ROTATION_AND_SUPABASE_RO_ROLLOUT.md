# Secret Rotation And Shared Supabase RO Rollout

Purpose: give operators one executable checklist for the remaining non-repo work after the Supabase hygiene and shared-MCP filter changes landed.

Use this document when either condition is true:

- tracked or local env surfaces may have exposed live credentials
- shared read-only Supabase MCP (`supabase_ro`) is ready to be rolled out to the team surface

## 1. Scope And Guardrails

This document covers two operator-only tasks:

1. rotate live credentials in their authoritative control planes and runtime secret stores
2. enable the filtered shared Supabase read plane without exposing write or DDL tools

Hard rules:

- Never paste live secret values into repository files, PR comments, issues, Discord messages, or shared Obsidian notes.
- Treat local `.env` and `.env.profile-backup` as secret material.
- Do not mount write-capable Supabase MCP tools into the shared team surface.
- If Supabase key rotation invalidates sessions or JWT-derived keys, schedule a maintenance window first.

## 2. Blast Radius

Potentially affected surfaces:

- Render backend and bot runtime
- Vercel frontend auth flow
- shared MCP host and remote worker env
- local operator machines using `.env` or `.env.profile-backup`
- Discord bot token and OAuth secret
- Supabase API keys / JWT-derived service-role flow
- model provider keys such as OpenAI, Anthropic, Gemini, Hugging Face, Serper, Binance, and similar upstreams

Rollback principle:

- secret rotation rollback is usually "re-apply the last known good secret and restart the dependent service"
- shared `supabase_ro` rollout rollback is "remove the upstream entry, restart the shared MCP host, reset cached tools"

## 3. Secret Rotation Checklist

### 3.1 Inventory The Surfaces First

Record secret names only, not values.

- local untracked files: `.env`, `.env.profile-backup`
- Render service env
- Vercel project env
- GCP/shared MCP worker env
- any local Task Scheduler, PM2, systemd, or shell profile overrides
- provider-side control planes where the secret is actually issued

Minimum high-priority keys to review:

- `DISCORD_TOKEN`
- `DISCORD_OAUTH_CLIENT_SECRET` / `DISCORD_CLIENT_SECRET`
- `JWT_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `HF_TOKEN` / `HF_API_KEY` / `HUGGINGFACE_API_KEY`
- `SERPER_API_KEY`
- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`
- `MCP_SHARED_MCP_TOKEN`
- `OBSIDIAN_REMOTE_MCP_TOKEN`

### 3.2 Rotate In The Authoritative Control Plane

Preferred order:

1. create replacement credentials in the provider control plane
2. update runtime secret stores with the new values
3. restart or redeploy the dependent runtime
4. run smoke verification
5. revoke the old credentials only after the new path is confirmed healthy

Provider-specific caution:

- Discord: token or OAuth secret rotation can immediately break bot connectivity or login callbacks.
- Supabase: service-role and anon/public keys may be tied to project-level key material; use the current Supabase key rotation flow for your project version and plan for token invalidation if JWT signing material changes.
- LLM providers and search providers: rotate in the provider console first, then update Render/GCP/Vercel/local stores.

### 3.3 Clean Local Secret Residue

After the new secrets are active:

- replace local `.env` values with the new set if that machine is still an operator workstation
- securely delete or archive stale `.env.profile-backup`
- confirm no secret-bearing file is staged or copied into docs/export folders

Local verification:

- `.gitignore` still covers `.env` and `.env.*`
- tracked docs still contain placeholders only
- any copied deployment notes contain variable names, never values

## 4. Shared `supabase_ro` Rollout Checklist

### 4.1 Preconditions

Do not enable the shared surface until all of the following are true:

- Supabase hygiene migrations and policy cleanup are already applied to the target project
- upstream proxy filter support is already deployed on the shared MCP host
- the team only needs diagnostics, schema visibility, advisor visibility, migration visibility, branch visibility, or logs
- no write, raw SQL mutation, DDL, extension install, or cron mutation path is being exposed through the shared lane

### 4.2 Recommended Shared Upstream Shape

Use a filtered upstream entry in the real secret store, not in tracked docs:

```env
MCP_UPSTREAM_SERVERS=[{"id":"supabase-ro","url":"https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF","namespace":"supabase_ro","token":"sbp_xxx","protocol":"streamable","enabled":true,"toolAllowlist":["get_*","list_*","*_advisors","*_migrations","*_branches","*_logs"]}]
```

Operational rule:

- if you later need admin or mutation capability, create a separate operator-only namespace or a separate host

### 4.3 Rollout Steps

1. issue or select the upstream token that will be stored on the shared MCP host
2. add the filtered `supabase_ro` entry to the host secret store
3. restart the shared `muelUnified` process
4. reset cached MCP tools in IDE clients if the catalog was already cached
5. verify the shared tool catalog exposes only the filtered names

Expected visible shape:

- `upstream.supabase_ro.get_*`
- `upstream.supabase_ro.list_*`
- `upstream.supabase_ro.*_advisors`
- `upstream.supabase_ro.*_migrations`
- `upstream.supabase_ro.*_branches`
- `upstream.supabase_ro.*_logs`

Expected absent shape:

- `upstream.supabase_ro.execute_*`
- raw SQL write tools
- migration apply tools
- DDL / extension mutation tools

### 4.4 Validation

Run these checks after restart:

1. confirm the shared MCP host starts cleanly with the new `MCP_UPSTREAM_SERVERS` JSON
2. confirm IDE or route-visible tool catalogs show `upstream.supabase_ro.*`
3. confirm filtered-out tools are not visible
4. confirm existing shared Obsidian access still works
5. confirm runtime write paths still use the direct Supabase SDK path and were not redirected to MCP

Suggested operator evidence to capture:

- restart time of the shared MCP host
- visible tool namespace snapshot
- note that write-capable tools were absent
- smoke query result from one read-only Supabase tool

## 5. Rollback

### 5.1 Secret Rotation Rollback

- restore the prior secret only if the replacement path is broken and the old secret is still valid
- restart or redeploy the affected service
- document why the new secret failed before retrying rotation

### 5.2 Shared `supabase_ro` Rollout Rollback

1. remove the `supabase_ro` entry from `MCP_UPSTREAM_SERVERS`
2. restart the shared MCP host
3. reset cached tools in IDE clients if necessary
4. revoke the upstream token if the rollout should not remain available

## 6. Completion Criteria

This work is complete only when all of the following are true:

- exposed live secrets were rotated in their real control planes
- runtime secret stores were updated everywhere they are actually used
- stale local backup secret files were handled intentionally
- tracked docs still contain placeholders only
- shared `supabase_ro` is either fully validated as read-only or explicitly left disabled
- rollback notes and operator evidence were captured
