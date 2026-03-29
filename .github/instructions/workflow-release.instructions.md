---
description: "Workflow: Release checklist for Render-deployed Discord bot — version bump, validation, deploy, and post-deploy verification."
applyTo: "**"
---

# Release Workflow

> Validate everything before pushing. Every release must pass all gates.

## Step 1: Pre-Release Validation

```bash
# Ensure main is clean
git checkout main && git pull origin main

# Type check
npx tsc --noEmit

# Run full test suite
npx vitest run

# Check for uncommitted changes
git status --porcelain
```

All three must pass with zero errors before proceeding.

## Step 2: Version and Changelog

1. Determine version bump (patch/minor/major) based on changes since last release.
2. Update `package.json` version field.
3. Update `docs/CHANGELOG-ARCH.md` with user-facing change summary.
4. Commit: `git add package.json docs/CHANGELOG-ARCH.md && git commit -m "v<version> Release Notes"`

## Step 3: Release Gate Checklist

Verify ALL of the following (from `copilot-instructions.md`):

- [ ] Startup / auth / scheduler safety not degraded
- [ ] Obsidian graph-first retrieval behavior preserved
- [ ] Discord output sanitization verified (including Deliverable wrappers)
- [ ] Workflow / script idempotency and rollback path documented
- [ ] Sprint changed file cap not exceeded
- [ ] All sprint phases passed before ship

## Step 4: Deploy

```bash
git push origin main
```

Render auto-deploys from main. Monitor deploy logs at the Render dashboard.

## Step 5: Post-Deploy Verification

1. Check bot comes online in Discord (status endpoint: `/api/health`).
2. Verify scheduled tasks fire correctly (check logs for cron triggers).
3. Run a smoke test command in a test channel.
4. Monitor error logs for 15 minutes post-deploy.

## Rollback

If issues detected post-deploy:

```bash
# Revert to previous commit
git revert HEAD --no-edit
git push origin main
```

Or use Render dashboard to roll back to previous deploy.
