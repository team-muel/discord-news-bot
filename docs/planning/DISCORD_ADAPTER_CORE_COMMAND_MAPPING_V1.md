# Discord Adapter -> Core Command Mapping v1

Status note:

- Reference mapping specification for Discord adapter to core command translation.
- Use this document for contract alignment, not for active planning priority or WIP tracking.

Purpose:

- Define deterministic mapping from Discord command surface to core command intents.
- Keep adapter translation explicit and auditable.

Primary handler hub:

- src/bot.ts

## 1) Chat Input Command Mapping

| Discord command | Adapter handler                           | Core command_type        | Core payload focus                |
| --------------- | ----------------------------------------- | ------------------------ | --------------------------------- |
| 해줘            | docsHandlers.handleAskCommand             | docs.ask                 | query, visibility (compat alias) |
| 뮤엘            | docsHandlers.handleAskCommand             | docs.ask                 | query, visibility                 |
| 만들어줘        | vibeHandlers.handleMakeCommand            | worker.generate.request  | goal, coding intent, visibility   |
| 변경사항        | docsHandlers.handleChangelogCommand       | docs.changelog           | Obsidian #changelog tag search    |
| 정책            | agentHandlers.handlePolicyCommand         | agent.policy.control     | subcommand + policy update args   |
| 시작            | agentHandlers.handleAgentCommand          | agent.session.start      | goal/priority/skill               |
| 온보딩          | agentHandlers.handleAgentCommand          | agent.onboarding.run     | guild onboarding trigger          |
| 중지            | agentHandlers.handleAgentCommand          | agent.session.stop       | session identifier                |
| 스킬목록        | agentHandlers.handleAgentCommand          | agent.skill.list         | guild scope                       |
| 관리자          | adminHandlers.handleAdminCommand          | admin.runtime.command    | channel/forum/admin ops           |
| 상태            | adminHandlers.handleStatusCommand         | runtime.status.read      | guild/runtime snapshot            |
| 관리설정        | adminHandlers.handleManageSettingsCommand | admin.settings.update    | learning toggle                   |
| 잊어줘          | adminHandlers.handleForgetCommand         | privacy.forget.request   | scope, mode, confirm token        |
| 도움말          | adminHandlers.handleHelpCommand           | help.read                | command catalog                   |
| 구독            | handleGroupedSubscribeCommand             | subscription.command     | action/type/link/channel          |
| 주가            | handleStockPriceCommand                   | market.query             | symbol + visibility               |
| 차트            | handleStockChartCommand                   | market.query             | symbol + visibility               |
| 분석            | handleAnalyzeCommand                      | market.query             | query + visibility                |
| 유저            | crmHandlers.handleMyInfoCommand           | user.crm.self            | self CRM profile + login diag     |
| 통계            | crmHandlers.handleUserInfoCommand         | user.crm.lookup          | target user CRM lookup (admin)    |
| 프로필          | personaHandlers.handleProfileCommand      | user.profile.read        | self or target user profile       |
| 메모            | personaHandlers.handleMemoCommand         | user.note.command        | view or add user memo             |
| 지표리뷰        | inline in bot.ts                          | metrics.review.read      | metric snapshot generation        |

## 2) Non-Chat Interaction Mapping

| Interaction type            | Adapter path                             | Core command_type                        |
| --------------------------- | ---------------------------------------- | ---------------------------------------- |
| button interaction          | handleButtonInteraction                  | agent.action.approval or session.control |
| user context menu           | personaHandlers.handleUserContextCommand | user.profile.context                     |
| modal submit                | personaHandlers.handleUserNoteModal      | user.note.upsert                         |
| message create(simple mode) | vibeHandlers.handleVibeMessage           | agent.run (light)                        |

## 3) Envelope Binding Rule

For each adapter->core handoff:

- Build commandEnvelope v1 before invoking core service.
- Preserve trace_id across eventEnvelope and commandEnvelope chains.
- Attach idempotency_key for retriable commands.

## 4) Evidence Pointers

Source lines:

- src/bot.ts: switch(commandName) dispatch table
- src/discord/session.ts: startVibeSession and startAgentSession bridge
- src/services/multiAgentService.ts: startAgentSession core entry

Validation:

- npm run contracts:validate
- npm run test:contracts
