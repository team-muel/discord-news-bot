# Discord Output Sanitization Rules

> Load when reviewing code that sends messages to Discord.

## Core Rule

All user-facing Discord replies MUST be sanitized, including text wrapped in Deliverable blocks. Debug markers, internal IDs, and stack traces can leak.

## Sanitization Checklist

- [ ] No raw error stack traces in Discord messages
- [ ] No environment variable values in output
- [ ] No internal service names or endpoint URLs
- [ ] No raw Supabase column names or query fragments
- [ ] No sprint pipeline IDs or internal state references
- [ ] Deliverable wrapper content is sanitized (not just the outer message)

## Embed Limits (Discord API)

| Field | Limit |
|---|---|
| Embed title | 256 chars |
| Embed description | 4,096 chars |
| Field name | 256 chars |
| Field value | 1,024 chars |
| Total embeds per message | 10 |
| Total chars across all embeds | 6,000 |
| Message content | 2,000 chars |

## Common Patterns

- Truncate long outputs with `…` before hitting limits
- Use code blocks for structured data, not inline formatting
- Error responses: generic user message + detailed internal log
- Never echo user input back without escaping (prevents Discord markdown injection)
