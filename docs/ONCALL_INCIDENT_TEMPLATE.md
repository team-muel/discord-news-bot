# On-Call Incident Template

Use this template during an active incident.
Keep entries chronological and timestamped in KST.

## 1) Incident Header

- Incident ID:
- Date:
- Severity: SEV-1 | SEV-2 | SEV-3
- Status: Investigating | Mitigating | Monitoring | Resolved
- Incident Commander:
- Comms Owner:
- Ops Engineer(s):

## 2) Scope and Impact

- User impact summary:
- Affected components: Render | Supabase | Vercel | Discord bot | Obsidian sync
- Start time (detected):
- Estimated blast radius:

## 3) Live Timeline

- HH:mm - Detection signal observed
- HH:mm - Triage started
- HH:mm - Initial hypothesis
- HH:mm - Mitigation action applied
- HH:mm - Validation check passed/failed
- HH:mm - User-facing update posted
- HH:mm - Service restored
- HH:mm - Monitoring window completed

## 4) Triage Checklist

- Health endpoints checked:
  - GET /health
  - GET /ready
  - GET /api/bot/status
- Recent changes reviewed:
  - deploy
  - env variable edits
  - Supabase schema changes
  - key rotation
- Fault domain narrowed:
  - API-only
  - bot-only
  - frontend-only
  - data-only
  - sync-only

## 5) Mitigation Log

- Action 1:
  - Owner:
  - Command/API:
  - Result:
- Action 2:
  - Owner:
  - Command/API:
  - Result:

## 6) Validation Evidence

- Primary checks:
  - /health:
  - /ready:
  - /api/auth/me:
  - /api/bot/status:
- Secondary checks:
  - admin endpoint check:
  - Discord command response:
  - Obsidian sync status:

## 7) Resolution

- Resolved at:
- Customer impact end time:
- Total duration:
- Temporary workaround left in place: yes/no
- Follow-up issue links:

## 8) Handover Notes

- Current risk level:
- What to watch next 24h:
- Pending actions:
