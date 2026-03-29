---
description: "Workflow: Incident response and recovery — detect, triage, mitigate, and postmortem for production issues."
applyTo: "**"
---

# Incident Response Workflow

> Stop the bleeding first. Root cause later.

## Step 1: Detection and Triage

Identify the incident type:

- **Bot offline** → Check Render deploy status, Discord gateway preflight, token validity.
- **Scheduler failure** → Check cron logs, Supabase connectivity, rate limits.
- **Data corruption** → Check recent migrations, Supabase schema drift.
- **Performance degradation** → Check LLM API latency, memory usage, connection pool exhaustion.

Severity classification:

- **SEV1**: Bot completely offline, no Discord response. Immediate action.
- **SEV2**: Partial functionality loss (some commands fail, scheduler broken). Urgent.
- **SEV3**: Degraded performance but functional. Monitor and fix in next sprint.

## Step 2: Immediate Mitigation

For SEV1/SEV2:

1. **Check if recent deploy caused the issue:**

   ```bash
   git log --oneline -5
   ```

   If yes → revert immediately:

   ```bash
   git revert HEAD --no-edit && git push origin main
   ```

2. **Check external dependencies:**
   - Discord API status: https://discordstatus.com
   - Supabase status: check dashboard
   - LLM provider status: check respective status pages

3. **Restart if stuck state:**
   - Render: trigger manual deploy of current commit
   - Local: `pm2 restart ecosystem.config.cjs`

## Step 3: Diagnosis

After bleeding stops:

1. Collect error logs from the incident window.
2. Identify the root cause — code change, config change, external dependency, or data issue.
3. Check `docs/OPERATOR_SOP_DECISION_TABLE.md` for known patterns.
4. If code bug: trigger a bugfix sprint:
   ```
   /plan objective="Fix: <description of the bug>"
   ```

## Step 4: Resolution

1. Implement fix (via sprint pipeline or manual hotfix).
2. Validate: `tsc --noEmit && npx vitest run`.
3. Deploy fix.
4. Verify recovery in production (check affected commands/features).

## Step 5: Postmortem

Use `docs/POSTMORTEM_TEMPLATE.md` to document:

- Timeline of events
- Root cause
- Impact (users affected, duration)
- What went well / what didn't
- Action items to prevent recurrence

Store postmortem in `docs/adr/` with date prefix.
