# Context Engineering Strategy (Discord Runtime)

This document defines the operational context-engineering strategy used by coding-oriented agent actions.

## 1) Save (Persist Important Context)

- Generate a compact context memo (`CONTEXT_MEMO`) for each coding run.
- Memo fields: objective, task type, selected memory/resources/tools, decomposed work packages.
- Store or relay this memo outside active chat history when possible (ops dashboard, DB log, issue tracker, runbook note).
- Include user brief fields whenever available: scenario, role, purpose.

## 2) Select (Only Necessary Context)

- Do not pass all available context to the model.
- Use goal-keyword relevance scoring to select only top-N:
  - long-term memory
  - external resources
  - available tools
- Smaller, relevant context improves instruction adherence and reduces hallucination risk.
- In practice: pass only what is needed for the current coding step, not the entire project history.

## 3) Summarize (Compress Long Dialogue)

- If conversation history is long, compress mid-section into a short topical summary.
- Keep first/last turns for chronology and intent continuity.
- Avoid token waste and drift by preventing stale details from dominating the prompt.

## 4) Split (Decompose Large Work)

- Break a large coding goal into small work packages before generation.
- Feed packages into the model as workflow steps.
- Typical package flow:
  - requirements analysis
  - core implementation
  - validation and cleanup
- If mixed intent is detected (research + writing + coding), separate phases and keep each execution focused on one phase.

## Prompting Contract For Vibe Coding

- Always provide background bundle together:
  - scenario
  - role
  - purpose
- Keep each request step-scoped and minimal-context.
- For complex goals, run separate threads/sessions by phase:
  - research session
  - writing/planning session
  - coding session

## Context Safety Risks and Guards

Potential risks:

- Information contamination
- Task distraction
- User intent confusion
- Instruction collisions

Runtime guards:

- Filter suspicious injection-like lines (`ignore previous`, `system prompt`, etc.).
- Detect response-format conflicts (`json-only` vs `file-blocks`).
- Prioritize stable default instructions when context is missing/noisy.

## Discord Environment Notes

- Discord input can be short/noisy; strict filtering may drop useful nuance.
- Keep strategy best-effort and reversible.
- For critical workflows, combine this strategy with explicit slash-command parameters and admin policy checks.
