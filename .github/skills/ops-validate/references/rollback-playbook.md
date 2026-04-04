# Rollback Playbook

> Load when assessing rollback safety for a release or automation change.

## Render Deploy Rollback

```bash
# Option 1: Revert commit and push
git revert HEAD --no-edit
git push origin main

# Option 2: Use Render dashboard
# Navigate to service → Deploys → click "Rollback" on previous successful deploy
```

## Database Rollback

- Supabase schema changes require explicit down-migration scripts
- Store rollback SQL in `scripts/migrations/` alongside the up-migration
- Test rollback on staging before production
- Never drop columns in production without a 2-phase approach:
  1. Phase 1: Stop writing to column, deploy
  2. Phase 2: Drop column after confirming no reads

## Automation / Script Rollback

- Scripts must be idempotent — running twice produces the same result
- For state-modifying scripts, log before/after state for manual reversal
- Cron job changes: keep old schedule commented in config until verified

## Rollback Decision Matrix

| Signal | Action |
|---|---|
| Bot offline after deploy | Immediate Render rollback |
| Scheduler failing | Revert last commit, check cron config |
| Partial command failure | Investigate logs, consider feature-flag disable |
| Data corruption | Stop writes, assess blast radius, restore from backup |
| Performance degradation | Monitor 15min, rollback if no improvement |

## Post-Rollback Checklist

- [ ] Verify bot is online and responding
- [ ] Verify scheduler fires correctly
- [ ] Check error logs for new issues
- [ ] Notify stakeholders of rollback and reason
- [ ] Create incident ticket for root cause analysis
