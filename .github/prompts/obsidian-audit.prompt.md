---
description: "Audit the Obsidian vault graph health and fix broken links."
---
# Obsidian Vault Audit

Check the Obsidian vault for graph health issues.

## Instructions

1. Run `scripts/audit-obsidian-graph.ts` to get the current graph snapshot.
2. Identify broken backlinks, orphaned documents, and missing tags.
3. Check that recent retro and plan documents have proper `[[backlinks]]` to related docs.
4. Verify tag conventions match `references/obsidian-tagging-guide.md`.
5. Report findings with specific file paths and suggested fixes.
6. If fixes are safe (adding missing tags, fixing broken links), apply them directly.
