# ADR-006: Intent Intelligence Layer

## 상태

Accepted — 2026-04-03

## 맥락

현재 intent 분류 시스템은 3가지 레이어(runtimePolicy regex, coreNodes LLM 3분류, sprintTriggers CS 분류)가 분절되어 있으며 다음 병목이 확인됨:

1. **피드백 루프 부재**: 분류 결과의 정확도를 추적/평가/개선하는 경로 없음
2. **택소노미 조잡**: `task | casual_chat | uncertain` 3개로 info_seek/action_execute/opinion 등 구분 불가
3. **Confidence 없음**: 낮은 확신과 높은 확신 분류가 동일 처리
4. **대화 컨텍스트 미활용**: 현재 메시지 하나만 보고 분류
5. **Obsidian 그래프 미연결**: RAG에만 사용되는 그래프 구조가 intent 분류에 활용 안 됨
6. **promptCompiler 분절**: intentTags가 추출되지만 routeIntentNode에 전달되지 않음
7. **uncertain dead-end**: clarification 후 새 세션이 시작되어 이전 uncertain 컨텍스트 소실

## 결정

Intent Intelligence Layer를 도입하여 분류-평가-개선 closed-loop을 구축한다.

### 택소노미 확장 (3 → 8)

```typescript
type IntentTaxonomy =
  | 'info_seek'         // 정보 탐색
  | 'action_execute'    // 작업 실행 요청
  | 'creative_generate' // 생성/작성 요청
  | 'opinion_consult'   // 의견/추천 요청
  | 'context_provide'   // 추가 맥락 제공 (대화 내)
  | 'confirm_deny'      // 이전 제안에 대한 승인/거절
  | 'emotional'         // 감정 표현 / 공감 필요
  | 'meta_control'      // 시스템 제어 ("멈춰", "취소")
```

하위 호환: 기존 `AgentIntent = 'task' | 'casual_chat' | 'uncertain'`은 facade mapping으로 유지.

### IntentClassification 구조

```typescript
type IntentClassification = {
  primary: IntentTaxonomy;
  confidence: number;          // 0-1
  secondary: IntentTaxonomy | null;
  legacyIntent: AgentIntent;   // 기존 코드 호환용
  latentNeeds: string[];       // 표면에 없지만 추론된 요구사항
  reasoning: string;           // trace용 분류 근거
  source: 'rule' | 'exemplar' | 'llm';  // 어떤 단계에서 결정되었는지
};
```

### 3단 파이프라인

1. **Rule-based fast-path** (기존 regex 확장) → high-confidence만 채택
2. **Exemplar matching** (Supabase `intent_exemplars` 테이블 few-shot) → 길드별 calibration
3. **LLM structured output** (fallback) → confidence + secondary + latentNeeds

### Signal Enricher

분류 전에 다중 신호를 수집:
- promptCompiler의 intentTags/directives
- 최근 대화 턴 (fetchRecentTurnsForUser)
- Obsidian 그래프 neighbor tags (1-hop)

### Outcome Attribution (Closed-Loop)

- 세션 종료 시 intent 분류 정확도를 역추론
- `intent_exemplars.was_correct` 필드 업데이트
- Entity Nervous System Circuit 2에 통합

## Supabase 마이그레이션

```sql
CREATE TABLE IF NOT EXISTS intent_exemplars (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  message TEXT NOT NULL,
  signal_snapshot JSONB DEFAULT '{}',
  classified_intent TEXT NOT NULL,
  confidence FLOAT DEFAULT NULL,
  was_correct BOOLEAN DEFAULT NULL,
  session_id TEXT DEFAULT NULL,
  session_reward FLOAT DEFAULT NULL,
  user_correction TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_exemplars_guild
  ON intent_exemplars(guild_id, classified_intent);
CREATE INDEX IF NOT EXISTS idx_intent_exemplars_quality
  ON intent_exemplars(was_correct, session_reward DESC NULLS LAST);
```

## 하위 호환 전략

- `AgentIntent` 타입은 deprecated alias로 유지
- `runRouteIntentNode` 반환값을 `IntentClassification`으로 확장하되, `legacyIntent` 필드로 기존 소비자 호환
- `stateContract.ts`의 `intent` 필드는 `IntentClassification | null`로 확장
- 기존의 `routedIntent === 'task'` 비교는 `legacyIntent` 통해 동작 유지

## 리스크

- LLM 응답이 8개 택소노미를 정확히 지키지 않을 수 있음 → strict JSON schema + fallback to 'info_seek'
- Exemplar DB 초기 데이터 부족 → P2까지는 rule+LLM만 사용, exemplar는 수집만
- 대화 컨텍스트 로드 latency → enricher에 timeout guard (기존 `AGENT_MEMORY_HINT_TIMEOUT_MS` 공유)

## 후속 작업

- ADR 승인 후 `/implement`로 전환
- P0: 타입 + enricher + 3단 파이프라인
- P1: intent_exemplars 테이블 + 수집
- P2: Outcome Attributor + Entity Nervous System 통합
