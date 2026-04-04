---
description: "Run a security audit on recent changes using OWASP Top 10 + STRIDE."
---
# Security Scan

Perform a security audit on the changed files.

## Instructions

1. Use the `/security-audit` skill with the changed files.
2. Load `references/owasp-stride-checklist.md` for the full checklist.
3. Only report findings with confidence >= 8/10.
4. For each finding, provide: severity, OWASP category, STRIDE category, exploit scenario, and specific fix.
5. If fixes are obvious (missing input validation, leaked secrets), apply them directly.
6. Flag architectural concerns for `/plan` re-scope.
