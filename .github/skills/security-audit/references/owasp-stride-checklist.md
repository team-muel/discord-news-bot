# OWASP Top 10 + STRIDE Checklist

> Load when performing a security audit. Only report findings with confidence >= 8/10.

## OWASP Top 10 (2021) — Mapped to This Repo

| # | Category | Where to Look |
|---|---|---|
| A01 | Broken Access Control | API route auth middleware, Discord permission checks |
| A02 | Cryptographic Failures | Token storage, secret handling in `config.ts` |
| A03 | Injection | User input → SQL (Supabase), shell commands, Discord embeds |
| A04 | Insecure Design | Missing rate limits, unbounded loops, no input validation |
| A05 | Security Misconfiguration | CORS, exposed debug endpoints, default credentials |
| A06 | Vulnerable Components | `npm audit`, outdated dependencies |
| A07 | Auth Failures | Session management, token refresh, cookie handling |
| A08 | Data Integrity Failures | Unsigned deployments, unvalidated external data |
| A09 | Logging Failures | Secrets in logs, missing audit trail for admin actions |
| A10 | SSRF | Fetching user-provided URLs, webhook callbacks |

## STRIDE Threat Model

| Threat | Question | Repo Surface |
|---|---|---|
| **S**poofing | Can someone impersonate a user/service? | Discord auth, API tokens |
| **T**ampering | Can data be modified in transit/at rest? | Supabase RLS, env vars |
| **R**epudiation | Can actions be denied? | Audit logs, sprint trace |
| **I**nformation Disclosure | Can secrets/data leak? | Error messages, Discord output, logs |
| **D**enial of Service | Can the service be overwhelmed? | Rate limits, queue caps, connection pools |
| **E**levation of Privilege | Can someone gain unauthorized access? | Role checks, admin routes |

## False Positive Policy

Do NOT report:
- Test-only code paths (files matching `*.test.ts`, `*.spec.ts`)
- Dev-only fallback values documented as intentional
- Framework-provided protections already active (e.g., Supabase RLS)

## Exploit Scenario Format

```
### Finding: <title>
- Severity: HIGH/MEDIUM/LOW
- Confidence: 8/9/10
- OWASP: A0x
- STRIDE: <category>
- File: <path:line>
- Attack path: <step-by-step exploit>
- Fix: <specific code change>
```
