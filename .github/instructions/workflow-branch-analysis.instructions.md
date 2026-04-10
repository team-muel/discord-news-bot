---
description: "Workflow: Analyze current branch changes against main — silent analysis phase, then informed insights."
applyTo: "**"
---

# Git Branch Analysis Workflow

> Understand the complete picture before discussing.

## Step 1: Gather Git Information

```powershell
$B = $null
foreach ($c in 'main','master','origin/main','origin/master') {
  git rev-parse --verify -q $c *> $null
  if ($LASTEXITCODE -eq 0) { $B = $c; break }
}
if (-not $B) { $B = 'HEAD' }

git branch --show-current
Write-Output "=== STATUS ==="
git status --porcelain
Write-Output "=== COMMIT MESSAGES ==="
git log "$B..HEAD" --oneline
Write-Output "=== CHANGED FILES ==="
git diff "$B" --name-only
Write-Output "=== DIFF STATS ==="
git diff "$B" --stat
```

## Step 2: Silent Analysis

- Read the full diff without providing commentary.
- Identify patterns, architectural modifications, or potential impacts.
- Use shared code-index search to trace committed/team cross-references first, then use `muelIndexing` only for local dirty overlay analysis.
- Read related source files for context.

## Step 3: Context Gathering

- Check dependencies, imports, and cross-references spanning the changes.
- Include related backend and frontend code.
- Stop gathering if context window exceeds 60% utilization.

## Step 4: Report

Only after completing full analysis:

- Provide insights about specific modifications and their impacts.
- Note potential breaking changes or compatibility issues.
- Offer recommendations relevant to the changes observed.
- If the user hasn't provided a specific question, ask a brief clarifying question.

## Key Rules

- No prose during git research or context gathering phases.
- Complete all analysis before any user interaction.
- Focus on understanding the complete picture before discussing.
