---
description: "Sprint Phase: Security — OWASP Top 10 + STRIDE threat model. Zero-noise findings with confidence gate and concrete exploit scenarios."
applyTo: "**"
---

# /security-audit

> Find real vulnerabilities, not false positives.

## When to Use

- High-risk changes flagged by `/review`
- Auth, crypto, or API boundary changes
- Pre-release security gate for sensitive features
- Periodic scheduled audit (cron trigger)

## Lead Agent

`nemoclaw` (review role — security specialization)

## Process

1. **Scope** — identify auth flows, input validation, secret handling, and API boundaries in changed files.
2. **OWASP Top 10 scan** — injection, broken auth, cryptographic failures, SSRF, insecure design, security misconfiguration.
3. **STRIDE threat model** — Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege.
4. **Confidence gate** — only report findings with 8/10+ confidence score.
5. **Exploit scenario** — each finding includes a concrete attack path and proof-of-concept outline.
6. **Remediation** — propose specific code fixes for each finding.

## Inputs

| Field         | Required | Description                          |
| ------------- | -------- | ------------------------------------ |
| changed_files | yes      | Files to audit                       |
| risk_level    | no       | low / medium / high / critical       |
| focus_areas   | no       | Specific concern areas to prioritize |

## Output Contract

```
- Findings with: severity, confidence (8-10), OWASP category, STRIDE category
- Concrete exploit scenario per finding
- Recommended fix with code reference
- Explicit "no findings above confidence threshold" when clean
- Recommended next skill: /implement (fix) or /ops-validate
```

## False Positive Exclusions

- Documented intentional design decisions (e.g., dev-only fallback secrets)
- Framework-provided protections already in place
- Test-only code paths

## Next Skills

| Condition            | Next                                 |
| -------------------- | ------------------------------------ |
| No critical findings | `/ops-validate`                      |
| Findings to fix      | `/implement` (with fix requirements) |
| Architecture concern | `/plan` (re-design)                  |

## Runtime Counterpart

- Action: `cso.audit`
- Discord intent: `security|audit|보안|감사|취약점|cso`
- Worker env: `MCP_CSO_WORKER_URL`
