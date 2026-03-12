# Lightweight Worker Split Architecture

Goal: keep Muel core small and move unstable crawling logic into isolated MCP workers.

## Architecture

1. Core (`discord-news-bot`)

- Intent routing
- Agent planning
- Action governance (allowlist, approval)
- Memory and session management

2. Worker (`crawler-worker`)

- Tool endpoint: `POST /tools/call`
- Domain tools:
  - `youtube.search.first`
  - `news.google.search`
  - `community.search` (plugin-based sources)

Community plugin layer (worker-local):

- `scripts/crawler-worker/plugins/types.ts`
- `scripts/crawler-worker/plugins/registry.ts`
- built-in plugins:
  - `reddit`
  - `hackernews`
  - `stub`

3. Delegation Flow

- Core action planner selects domain action
- Action executes via MCP worker URL
- On success: returns worker results
- On failure:
  - strict mode: fail fast
  - non-strict mode: fallback/local path where available

## Why This Helps

- Core binary remains light
- Crawler failures are isolated from bot/api runtime
- Worker can be redeployed independently
- New sources can be added as new worker tools, not core rewrite

## Current Implementation

- Core delegation envs:
  - `ACTION_MCP_DELEGATION_ENABLED`
  - `ACTION_MCP_STRICT_ROUTING`
  - `MCP_YOUTUBE_WORKER_URL`
  - `MCP_NEWS_WORKER_URL`
  - `MCP_COMMUNITY_WORKER_URL`
- Worker runtime command:
  - `npm run worker:crawler`
- Plugin controls:
  - `COMMUNITY_PLUGIN_ORDER=reddit,hackernews,stub`
  - `COMMUNITY_PLUGIN_ENABLED=*`
