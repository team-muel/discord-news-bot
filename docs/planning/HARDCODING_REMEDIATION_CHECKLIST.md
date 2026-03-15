# Hardcoding Remediation Checklist (Discord + Agent Runtime)

목표: 디스코드 런타임 계층의 하드코딩/매직넘버를 정책/설정으로 외부화해 변경 리스크를 낮춘다.

## 원칙

- 실행 정책은 코드 상수보다 설정/정책 계층을 우선한다.
- 사용자 경험에 영향을 주는 임계치(길이, 주기, timeout)는 중앙화한다.
- 보안/가드레일 임계치는 fail-closed 기본값을 유지한다.
- 변경 후에는 반드시 `npm run lint`를 통과한다.

## Phase 1 (즉시): Discord 계층

### H-001 명령/의도 패턴 중앙화

- 대상 파일:
  - `src/discord/commandDefinitions.ts`
  - `src/discord/session.ts`
- 작업:
  - allowlist, legacy 명령, intent regex를 중앙 정책 객체로 이관
- 완료 기준:
  - 명령/의도 관련 하드코딩이 단일 정책 경로에서 관리됨

### H-002 응답 길이 제한 상수 중앙화

- 대상 파일:
  - `src/discord/commands/docs.ts`
  - `src/discord/ui.ts`
  - `src/discord/commands/market.ts`
- 작업:
  - 1400/3900/4000 등 길이 제한 값을 공통 상수로 통합
- 완료 기준:
  - 길이 제한 값 변경 시 수정 위치 1곳으로 축소

### H-003 세션 스트리밍 주기/timeout 중앙화

- 대상 파일:
  - `src/discord/session.ts`
- 작업:
  - 스트리밍 interval/timeout 값을 env + 공통 설정으로 이동
- 완료 기준:
  - 채널 특성/운영 상황에 따라 설정만으로 조정 가능

## Phase 2 (단기): Bot 런타임 계층

### H-004 재연결 백오프 정책 외부화

- 대상 파일:
  - `src/bot.ts`
- 작업:
  - reconnect cooldown/backoff 식의 상수/최대값을 설정 계층으로 이동
- 완료 기준:
  - 재연결 정책 변경 시 코드 로직 수정 없이 설정 반영 가능

### H-005 버튼/상호작용 커스텀 ID 규약 정리

- 대상 파일:
  - `src/bot.ts`
  - `src/discord/commands/*.ts`
- 작업:
  - customId prefix와 파싱 규약을 상수화하고 문서화
- 완료 기준:
  - 버튼 액션 추가 시 파싱 규약 충돌 없음

## Phase 3 (중기): Agent/Action 계층

### H-006 정책 임계치 카탈로그화

- 대상 파일:
  - `src/services/skills/actionRunner.ts`
  - `src/services/agentRuntimeReadinessService.ts`
  - `src/services/finopsService.ts`
- 작업:
  - 주요 임계치(실패율, timeout, retry, quality gate)를 카탈로그 문서로 표준화
- 완료 기준:
  - 임계치 변경 이력과 운영 근거를 문서로 추적 가능

### H-007 구성값 소스 일원화

- 대상 파일:
  - `src/config.ts`
  - 관련 서비스 env 파싱 파일
- 작업:
  - 중복/별칭 env를 정리하고 우선순위 규칙 문서화
- 완료 기준:
  - 동일 의미 설정이 다중 키로 분산되지 않음

## Graph-First Guard (중요)

- 본 프로젝트는 비청킹/그래프 우선 회수 전략을 기본으로 유지한다.
- 태그/백링크/링크 연결성 신호가 손실되는 리팩터링은 금지한다.
- 청킹은 예외적 fallback으로만 허용한다.

## 검증

- 필수: `npm run lint`
- 권장: `npm run obsidian:ops-cycle -- --guild <guildId> --skip-sync`
- 권장: `GET /api/bot/agent/obsidian/quality` 지표 확인
