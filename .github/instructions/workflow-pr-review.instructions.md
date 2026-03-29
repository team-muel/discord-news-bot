---
description: "Workflow: Code review for PRs and branches — step-by-step analysis, security/regression check, and approve/request-changes decision."
applyTo: "**"
---

# PR Review Workflow

> Analyze the code, understand the impact, then decide.

## Step 1: Gather Changes

```bash
# Current branch diff against main
git diff origin/main...HEAD --name-only
git diff origin/main...HEAD --stat
```

If reviewing a specific PR:

```bash
gh pr view <number> --json title,body,comments,files
gh pr diff <number>
```

## Step 2: Understand Context

For each modified file:

1. Read the original file to understand baseline behavior.
2. Identify imports, exports, and cross-references affected by the change.
3. Use `muelIndexing` (symbol search, references, scope reads) when available.

Do not narrate during this step — gather context silently.

## Step 3: Analyze (in priority order)

1. **Correctness and runtime safety** — will this break in production?
2. **Security** — secret exposure, injection, auth bypass, OWASP Top 10.
3. **Backward compatibility** — does this change public APIs or Discord command behavior?
4. **Test coverage** — are new paths covered? Edge cases?
5. **Operational risk** — scheduler safety, Supabase migration, deploy impact.

## Step 4: Decision

- If clean: approve with short summary of what was reviewed.
- If issues found: request changes with specific file/line references.
- If architectural concerns: flag for `/plan` phase before proceeding.

## Step 5: Report

Output format:

```
### Review Summary
- Files reviewed: N
- Risk level: LOW / MEDIUM / HIGH
- Decision: APPROVE / REQUEST_CHANGES / NEEDS_PLAN

### Findings
- [file:line] description of issue/observation
```
