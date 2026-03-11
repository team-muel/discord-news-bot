# Render Agent Env Template

Use this as a baseline for deploying Muel as a server-operations runtime.

## Required

- START_BOT=true
- DISCORD_TOKEN=<secret>
- JWT_SECRET=<secret>

## LLM Provider

- AI_PROVIDER=openai or gemini
- OPENAI_API_KEY=<secret> (if openai)
- GEMINI_API_KEY=<secret> (if gemini)
- OPENAI_ANALYSIS_MODEL=gpt-4o-mini (optional)
- GEMINI_MODEL=gemini-1.5-flash (optional)

## Agent Runtime Controls

- AGENT_MAX_CONCURRENT_SESSIONS=4
- AGENT_MAX_GOAL_LENGTH=1200
- DISCORD_SIMPLE_COMMANDS_ENABLED=true
- DISCORD_LOGIN_SESSION_TTL_MS=86400000
- DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS=7200000
- DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS=1800000
- AGENT_AUTO_ONBOARDING_ENABLED=true
- AGENT_DAILY_LEARNING_ENABLED=true
- AGENT_DAILY_LEARNING_HOUR=4
- AGENT_DAILY_MAX_GUILDS=30
- AGENT_ONBOARDING_COOLDOWN_MS=21600000

## Memory Layer

- SUPABASE_URL=<secret>
- SUPABASE_KEY=<secret>
- OBSIDIAN_VAULT_PATH=/var/data/obsidian-vault (optional)

## Automation Defaults

- START_AUTOMATION_JOBS=false
- AUTOMATION_YOUTUBE_ENABLED=true
- AUTOMATION_NEWS_ENABLED=false

## Notes

- `AUTOMATION_NEWS_ENABLED=false` keeps non-essential news push opt-in.
- If both OpenAI and Gemini keys exist, `AI_PROVIDER` selects priority.
- If no provider key exists, `/해줘` and `/시작` session creation fails by design.
- `DISCORD_SIMPLE_COMMANDS_ENABLED=true` keeps command surface minimal (`/구독`, `/로그인`, `/도움말`, `/설정`, `/ping`) and enables mention-first chat UX.
- `DISCORD_LOGIN_SESSION_TTL_MS` controls how long a non-admin login session stays active for subscription add/remove.
- `DISCORD_LOGIN_SESSION_REFRESH_WINDOW_MS` enables sliding expiration; sessions accessed near expiry are extended.
- `DISCORD_LOGIN_SESSION_CLEANUP_INTERVAL_MS` controls periodic cleanup of expired persisted sessions.
- Persistent login across bot restarts requires the `discord_login_sessions` table from `docs/SUPABASE_SCHEMA.sql`.
