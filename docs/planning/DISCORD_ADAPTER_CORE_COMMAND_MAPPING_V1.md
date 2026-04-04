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
| 뮤엘            | vibeHandlers.handleVibeCommand            | agent.run                | goal, visibility, session options |
| 해줘            | vibeHandlers.handleVibeCommand            | agent.run                | goal, visibility, inferred skill  |
| 만들어줘        | vibeHandlers.handleMakeCommand            | worker.generate.request  | goal, coding intent, visibility   |
| 세션            | agentHandlers.handleSessionCommand        | agent.session.control    | subcommand (조회/이력/제거)       |
| 정책            | agentHandlers.handlePolicyCommand         | agent.policy.control     | subcommand + policy update args   |
| 시작            | agentHandlers.handleAgentCommand          | agent.session.start      | goal/priority/skill               |
| 온보딩          | agentHandlers.handleAgentCommand          | agent.onboarding.run     | guild onboarding trigger          |
| 중지            | agentHandlers.handleAgentCommand          | agent.session.stop       | session identifier                |
| 스킬목록        | agentHandlers.handleAgentCommand          | agent.skill.list         | guild scope                       |
| 물어봐          | docsHandlers.handleAskCommand             | docs.ask                 | query, visibility                 |
| 문서            | docsHandlers.handleDocsCommand            | docs.search              | keyword, visibility               |
| 학습            | agentHandlers.handleUserLearningCommand   | user.learning.preference | on/off/status                     |
| 유저            | personaHandlers.handleUserCommand         | user.profile.command     | target user + note/profile action |
| 관리자          | adminHandlers.handleAdminCommand          | admin.runtime.command    | channel/forum/admin ops           |
| 상태            | adminHandlers.handleStatusCommand         | runtime.status.read      | guild/runtime snapshot            |
| 관리설정        | adminHandlers.handleManageSettingsCommand | admin.settings.update    | learning toggle                   |
| 잊어줘          | adminHandlers.handleForgetCommand         | privacy.forget.request   | scope, mode, confirm token        |
| 로그인          | adminHandlers.handleLoginCommand          | auth.login.discord       | guild/user login session          |
| 설정            | adminHandlers.handleSettingsCommand       | ui.navigate.settings     | dashboard redirect context        |
| help            | adminHandlers.handleHelpCommand           | help.read                | command catalog                   |
| 도움말          | adminHandlers.handleHelpCommand           | help.read                | command catalog                   |
| ping            | inline in bot.ts                          | runtime.ping             | ws status/ping                    |
| 구독            | handleGroupedSubscribeCommand             | subscription.command     | action/type/link/channel          |
| 주가            | handleStockPriceCommand                   | market.query             | symbol + visibility               |
| 차트            | handleStockChartCommand                   | market.query             | symbol + visibility               |
| 분석            | handleAnalyzeCommand                      | market.query             | query + visibility                |
| 할일            | tasksHandlers.handleTasksListCommand/Toggle | task.command            | subcommand (목록/완료)            |
| 내정보          | crmHandlers.handleMyInfoCommand           | user.crm.self            | self CRM profile read             |
| 유저정보        | crmHandlers.handleUserInfoCommand         | user.crm.lookup          | target user CRM lookup            |
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
