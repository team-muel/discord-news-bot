# Autonomous Agent Evolution Plan

Status: ACTIVE  
Created: 2026-04-04  
ADR: (pending — ADR-008 작성 예정)  
Canonical: 이 문서가 자율 에이전트 진화의 단일 기준 문서

## Objective

현재 시스템을 **"자동화 대리 실행(automation proxy)"**에서 **"자율 에이전트(autonomous agent)"**로 전환한다.

핵심 전환: **누가 루프를 시작하느냐**를 사람 → 시스템으로 이동.

```
현재:  사람 → /plan → 에이전트 실행 → 결과 → 사람 확인
목표:  환경 관찰 → 의도 형성 → 계획 → 실행 → 자기 평가 → 환경 관찰...
```

## Non-Goals

- AGI 구현 (범용 인지 능력은 스코프 밖)
- 기존 안전 레일 제거 (거버넌스 게이트, 서킷 브레이커 유지)
- Discord 봇 기능 축소 (기존 운영 기능 보존)
- 새로운 LLM 학습/파인튜닝 (기존 provider 체인 활용)
- OpenClaw 데스크톱 앱 의존 기능 (cmdop gRPC 블로커 유지)

## Current State Summary

### 이미 갖춘 것 (자산)

| 자산 | 역할 | 자율성 수준 |
|------|------|-------------|
| Signal Bus (typed events) | 환경 변화 감지 + 전파 | ✅ 완전 자동 |
| Self-Improvement Loop (4 sub-loops) | 품질 하락 → 자동 스프린트 트리거 | ⚠️ approve-impl에서 멈춤 |
| Sprint Orchestrator | 8단계 파이프라인 자동 실행 | ⚠️ 승인 게이트에서 블로킹 |
| Memory Evolution (A-MEM) | 메모리 간 자동 링크 + 신뢰도 조정 | ✅ 완전 자동 |
| Memory Consolidation (H-MEM) | raw→summary 자동 승격 | ⚠️ concept tier부터 수동 |
| Learning Journal | sprint retro → 다음 sprint plan 피드백 | ✅ 자동 (75%+ 신뢰도만) |
| External Tools (OpenJarvis/NemoClaw/OpenShell) | sandbox 실행 + 독립 리뷰 + ops | ✅ 어댑터 연결됨 |
| Traffic Routing (shadow/langgraph) | A/B 라우팅 + 품질 비교 | ✅ 자동 판단 |
| Action Utility Scoring | 액션별 성공/실패 추적 | ✅ planner에 피드백 |
| Convergence Monitor | 4개 트렌드 → 판정 | ⚠️ 시그널만, 자동 대응 없음 |

### 결정적 격차 (Gap)

| # | Gap | 현재 | 목표 |
|---|-----|------|------|
| G-1 | **관찰자 부재** | 에러/시그널에만 반응 | 환경을 능동적으로 스캔하고 기회/위험 식별 |
| G-2 | **의도 형성 없음** | 사람이 `/plan` 호출 | 관찰에서 목표를 스스로 도출 |
| G-3 | **승인 병목** | 모든 자동 스프린트 `approve-impl` | 신뢰 점수 기반 점진적 승인 해제 |
| G-4 | **루프 교착** | phase looping 감지만, 자동 복구 없음 | 파라미터 변경 후 자동 재시도 |
| G-5 | **도구 합성 없음** | 주어진 액션만 사용 | 필요한 도구를 스스로 작성 + 등록 |
| G-6 | **수렴 자동 대응 없음** | convergence.degrading 시그널만 | 자동 복구 스프린트 트리거 |
| G-7 | **메타 인지 없음** | 개별 스프린트 평가만 | 전체 시스템 효율을 자기 평가 |

---

## Target State Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    META-COGNITIVE LAYER (Phase J)                 │
│  시스템 전체 효율 자기 평가 + 전략 수정                           │
│  ↕                                                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              INTENT FORMATION ENGINE (Phase G)            │    │
│  │  관찰 → 가설 → 우선순위 → 목표 → 스프린트 생성            │    │
│  │  ↑                                          ↓             │    │
│  │  ┌──────────────┐              ┌──────────────────┐      │    │
│  │  │ OBSERVER     │              │ SPRINT PIPELINE  │      │    │
│  │  │ LAYER (F)    │              │ (기존 + 강화)     │      │    │
│  │  │              │              │                   │      │    │
│  │  │ • Discord    │              │ plan → implement  │      │    │
│  │  │ • Error logs │              │ → review → qa     │      │    │
│  │  │ • Memory gap │              │ → ops → ship      │      │    │
│  │  │ • Obsidian   │              │ → retro           │      │    │
│  │  │ • External   │              │                   │      │    │
│  │  │   APIs       │              │ + Tool Synthesis  │      │    │
│  │  └──────────────┘              └──────────────────┘      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │         PROGRESSIVE TRUST ENGINE (Phase H)                │    │
│  │  성공 이력 → 신뢰 점수 → 승인 게이트 자동 조정            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  EXISTING INFRA (보존)                                    │    │
│  │  Signal Bus · Memory 4-Tier · External Tools · FinOps    │    │
│  │  Governance Gates · Circuit Breaker · Learning Journal    │    │
│  └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Milestones

### Phase F: Observer Layer — "눈을 뜬다"

> 시스템이 환경을 능동적으로 스캔하고, 기회·위험·격차를 구조화된 관찰(Observation)로 생성한다.

**해결하는 Gap:** G-1 (관찰자 부재)

**Entry Criteria:**
- Signal Bus 정상 작동 (현재 ✅)
- Discord messageCreate 핸들러 활성 (현재 ✅)
- Obsidian 그래프 접근 가능 (현재 ✅)

**구현 범위:**

| 관찰 채널 | 입력 | 출력 (Observation) |
|-----------|------|-------------------|
| Discord Pulse | 채널별 메시지 빈도·감정·미응답 질문 | `{ type: 'discord-pulse', channel, metric, severity }` |
| Error Pattern | 기존 recordRuntimeError + 새 패턴 클러스터링 | `{ type: 'error-pattern', cluster, frequency, trend }` |
| Memory Gap | Obsidian 끊어진 링크 + 오래된 raw 메모리 | `{ type: 'memory-gap', gapKind, affectedNodes }` |
| Performance Drift | LLM 레이턴시·비용·품질 주간 트렌드 | `{ type: 'perf-drift', metric, delta, trend }` |
| External Signal | API 상태 변경·OSS 업데이트·Supabase 이상 | `{ type: 'external-signal', source, change }` |
| Codebase Health | 테스트 커버리지 하락·타입 에러 증가 | `{ type: 'code-health', metric, delta }` |

**핵심 컴포넌트:**
```
src/services/observer/
  observerTypes.ts          — Observation 타입 정의
  observerOrchestrator.ts   — 주기적 스캔 + 온디맨드 트리거
  channels/
    discordPulseChannel.ts  — Discord 메시지 흐름 분석
    errorPatternChannel.ts  — 에러 클러스터링 (기존 recordRuntimeError 확장)
    memoryGapChannel.ts     — Obsidian broken link + stale memory 감지
    perfDriftChannel.ts     — LLM latency/cost 트렌드 (기존 weekly report 확장)
    externalSignalChannel.ts — 외부 API 상태 감시
    codeHealthChannel.ts    — tsc --noEmit + vitest coverage delta
  observationStore.ts       — Supabase observations 테이블 persistence
```

**Supabase 테이블:**
```sql
CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,          -- Intent Formation이 소비하면 마킹
  sprint_id UUID REFERENCES sprint_pipelines(id)  -- 이 관찰에서 생성된 스프린트
);
```

**Signal Bus 확장:**
```
observation.new          — 새 관찰 생성 시
observation.critical     — severity=critical 관찰 즉시 전파
```

**Exit Criteria:**
- [ ] 6개 관찰 채널 모두 구현 + 테스트
- [ ] Observation이 Supabase에 영속
- [ ] Signal Bus에 observation 이벤트 연결
- [ ] 기존 시스템 기능에 영향 없음 (vitest 전체 통과)
- [ ] 관찰 주기 설정 가능 (env: `OBSERVER_SCAN_INTERVAL_MS`)

**예상 변경 파일:** ~12개 신규, ~4개 수정  
**위험:** 낮음 — 읽기 전용 관찰이므로 기존 동작에 부작용 없음

---

### Phase G: Intent Formation Engine — "생각한다"

> 관찰(Observation)을 분석하여 가설을 세우고, 우선순위를 매겨, 구체적인 목표(Intent)를 형성한다. Intent가 승인되면 Sprint를 자동 생성한다.

**해결하는 Gap:** G-2 (의도 형성 없음), G-6 (수렴 자동 대응 없음)

**Entry Criteria:**
- Phase F 완료 (Observation이 Supabase에 영속)
- Self-Improvement Loop 정상 작동

**설계:**

```
Observations (다수)
    ↓ 클러스터링 + 패턴 매칭
Hypotheses (가설)
    ↓ LLM + rule-based 평가
Intents (의도)
    ↓ 우선순위 + 충돌 해소 + 예산 검증
Sprint Creation
```

**핵심 컴포넌트:**
```
src/services/intent/
  intentTypes.ts            — Hypothesis, Intent, IntentPriority 타입
  intentFormationEngine.ts  — 관찰 → 가설 → 의도 변환 파이프라인
  hypothesisGenerator.ts    — 관찰 클러스터 → 가설 생성 (rule-first, LLM-fallback)
  intentPrioritizer.ts      — 긴급도·영향도·비용·신뢰도 기반 스코어링
  intentConflictResolver.ts — 상충하는 의도 해소 (예: 리팩터 vs 긴급 버그픽스)
  intentToSprint.ts         — 승인된 Intent → createSprintPipeline() 브릿지
```

**Intent 형성 규칙 (Rule-First):**

| 관찰 패턴 | 생성되는 Intent | 자율 수준 |
|-----------|----------------|-----------|
| error-pattern × 3+ 같은 클러스터 | `fix: <cluster description>` bugfix | approve-impl |
| memory-gap × broken links > 5 | `maintain: Obsidian graph repair` | full-auto |
| perf-drift × p95 latency +30% | `optimize: LLM latency regression` | approve-impl |
| discord-pulse × 미응답 질문 > 10 | `improve: FAQ auto-response gap` | approve-ship |
| code-health × coverage -5% | `qa: restore test coverage` | full-auto |
| convergence.degrading × 2+ 연속 | `investigate: system convergence degradation` | approve-impl |

**FinOps 게이트 연동:**
- Intent 생성 시 예상 LLM 토큰 비용 산정
- 일일/주간 Intent 예산 한도 (`INTENT_DAILY_BUDGET_TOKENS`, `INTENT_WEEKLY_BUDGET_TOKENS`)
- 예산 초과 시 Intent가 큐에 대기, 사람에게 알림

**Supabase 테이블:**
```sql
CREATE TABLE intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis TEXT NOT NULL,
  objective TEXT NOT NULL,
  priority_score REAL NOT NULL,
  estimated_cost_tokens INT,
  autonomy_level TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','executing','completed','rejected')),
  observation_ids UUID[] NOT NULL,    -- 소스 관찰 IDs
  sprint_id UUID REFERENCES sprint_pipelines(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);
```

**Exit Criteria:**
- [ ] Rule-based intent formation 최소 6개 패턴
- [ ] LLM fallback으로 비정형 관찰도 처리
- [ ] FinOps 예산 게이트 통합
- [ ] Intent → Sprint 자동 생성 E2E 검증
- [ ] 기존 Self-Improvement Loop와 중복 해소 (통합 또는 위임)
- [ ] Convergence.degrading → 자동 복구 Intent 생성

**예상 변경 파일:** ~8개 신규, ~5개 수정 (sprintTriggers, sprintOrchestrator, selfImprovementLoop)  
**위험:** 중간 — Self-Improvement Loop와의 책임 경계 명확화 필요

---

### Phase H: Progressive Trust Engine — "신뢰를 쌓는다"

> 스프린트 성공 이력을 기반으로 신뢰 점수(Trust Score)를 계산하고, 점수에 따라 승인 게이트를 점진적으로 해제한다.

**해결하는 Gap:** G-3 (승인 병목), G-4 (루프 교착)

**Entry Criteria:**
- Phase G 완료 (Intent → Sprint 자동 생성)
- Sprint 이력 데이터 충분 (최소 20회 완료 스프린트)

**Trust Score 공식:**
```
TrustScore = (
  successRate × 0.35 +         -- 최근 N 스프린트 성공률
  rollbackRate_inv × 0.20 +    -- 롤백 미발생률
  scopeCompliance × 0.15 +     -- 스코프 가드 위반 없음
  reviewQuality × 0.15 +       -- 리뷰 단계 통과율
  timeToResolution × 0.15      -- 평균 해결 시간 트렌드
) × categoryMultiplier          -- 카테고리별 가중치 (bugfix > feature)
```

**승인 단계 전환:**

| Trust Score | 승인 수준 | 허용 범위 |
|-------------|-----------|-----------|
| 0.0 – 0.3 | `manual` | 모든 단계 수동 승인 |
| 0.3 – 0.5 | `approve-impl` | plan 자동, implement부터 승인 |
| 0.5 – 0.7 | `approve-ship` | plan~qa 자동, ship 승인 |
| 0.7 – 0.85 | `full-auto` (bugfix only) | 버그픽스/유지보수만 완전 자동 |
| 0.85 – 1.0 | `full-auto` (all) | 기능 추가 포함 완전 자동 |

**안전 장치:**
- **Decay**: 7일간 스프린트 없으면 TrustScore 일일 -0.01 감쇠
- **Instant Demotion**: 롤백 발생 시 즉시 1단계 하락
- **Category Isolation**: bugfix/feature/security 각각 독립 TrustScore
- **Hard Cap**: `TRUST_MAX_AUTONOMY_LEVEL` env로 상한 강제 (기본: `approve-ship`)
- **Human Override**: 어느 시점에서든 수동으로 승인 수준 재설정 가능

**루프 교착 자동 복구:**
- Phase looping 감지 시:
  1. 동일 파라미터 2회 반복 → temperature +0.2로 재시도
  2. 3회 반복 → 다른 전략(ToT→self-refine 등) 전환
  3. 4회 반복 → Intent를 `blocked`로 마킹 + 사람 알림

**핵심 컴포넌트:**
```
src/services/trust/
  trustTypes.ts          — TrustScore, TrustCategory, TrustDecision 타입
  trustScoreEngine.ts    — 스프린트 이력 → Trust Score 계산
  trustGateAdapter.ts    — Trust Score → autonomy level 매핑 + sprintOrchestrator 연동
  trustDecayService.ts   — 시간 경과/롤백 감쇠 + 즉시 하락
  loopBreaker.ts         — phase looping 자동 복구 전략
```

**Exit Criteria:**
- [ ] Trust Score 계산 로직 + 단위 테스트
- [ ] 스프린트 완료 시 자동 Trust Score 갱신
- [ ] 승인 게이트 자동 조정 E2E 검증
- [ ] Instant Demotion + Decay 동작 검증
- [ ] 루프 교착 자동 복구 3단계 구현
- [ ] Hard Cap env 설정 동작 검증
- [ ] 기존 수동 `/approve` 우선순위 보존 (Human Override)

**예상 변경 파일:** ~6개 신규, ~3개 수정 (sprintOrchestrator의 autonomy 판단 분기)  
**위험:** 높음 — 잘못된 Trust Score가 위험한 코드를 자동 배포할 수 있음. Hard Cap 필수.

---

### Phase I: Tool Synthesis — "도구를 만든다"

> 에이전트가 기존 액션 레지스트리에 없는 능력이 필요할 때, OpenShell 샌드박스 안에서 스크립트를 작성·테스트·등록한다.

**해결하는 Gap:** G-5 (도구 합성 없음)

**Entry Criteria:**
- Phase H 완료 (자동 실행 경로 확보)
- OpenShell 샌드박스 정상 작동 (현재 ✅)
- Scope Guard 활성 (현재 ✅)

**설계 원칙:**
1. **샌드박스 격리**: 합성된 도구는 반드시 OpenShell 샌드박스에서만 실행
2. **코드 리뷰 게이트**: NemoClaw code.review를 통과해야 등록
3. **임시 → 영구 승격**: 처음엔 임시 등록, N회 성공 후 영구 등록
4. **Capability Manifest**: 합성된 도구의 입출력 계약을 선언적으로 정의

**합성 워크플로:**
```
1. Intent가 "액션 X 필요"를 감지 → actionRunner에 X 없음 확인
2. LLM에 도구 스펙 생성 요청 (이름, 입출력, 목적, 제약)
3. LLM이 TypeScript/Python 도구 코드 생성
4. OpenShell 샌드박스에서 실행 테스트
5. NemoClaw code.review 통과
6. ActionRegistry에 임시 등록 (maxUses: 10, expires: 24h)
7. 10회 성공 사용 후 → 영구 등록 제안 (사람 승인)
```

**핵심 컴포넌트:**
```
src/services/synthesis/
  toolSynthesisTypes.ts     — SynthesizedTool, ToolSpec, SynthesisResult 타입
  toolSynthesizer.ts        — LLM → 코드 생성 → 샌드박스 테스트
  toolRegistrar.ts          — 임시/영구 ActionRegistry 등록
  toolSandboxRunner.ts      — OpenShell sandbox.exec 래퍼
  toolReviewGate.ts         — NemoClaw code.review 통합
```

**Exit Criteria:**
- [ ] 간단한 도구 (HTTP fetch, 파일 변환 등) E2E 합성 검증
- [ ] 샌드박스 격리 + 네트워크 정책 적용
- [ ] NemoClaw 리뷰 게이트 통과/거부 동작 검증
- [ ] 임시 → 영구 승격 워크플로 동작
- [ ] 합성 실패 시 graceful degradation (기존 액션으로 폴백)
- [ ] 보안 감사 통과 (OWASP: 코드 인젝션 방지)

**예상 변경 파일:** ~6개 신규, ~3개 수정 (actionRunner, intentFormationEngine)  
**위험:** 높음 — LLM이 생성한 코드를 실행하므로 샌드박스 격리 + 리뷰 게이트가 핵심 안전장치

---

### Phase J: Meta-Cognitive Layer — "자기를 안다"

> 시스템이 자신의 전체 효율성·학습 속도·자원 사용을 주기적으로 평가하고, 전략을 자기 수정한다.

**해결하는 Gap:** G-7 (메타 인지 없음)

**Entry Criteria:**
- Phase F~I 최소 2개 완료
- 충분한 운영 데이터 (최소 30일)

**측정 축:**

| 축 | 메트릭 | 소스 |
|----|--------|------|
| 효율성 | scaffoldingRatio 트렌드, 평균 스프린트 소요 시간 | sprintLearningJournal |
| 학습 속도 | 동일 유형 버그 재발률, Trust Score 상승 속도 | trustScoreEngine, errorPatternChannel |
| 자원 효율 | LLM 토큰/스프린트, 합성 도구 재사용율 | FinOps, toolRegistrar |
| 품질 | 롤백률, 리뷰 통과율, 사용자 만족도 (Discord 반응) | sprint_pipelines, userCrmService |
| 자율성 수준 | 사람 개입 빈도, 승인 대기 시간 | trustGateAdapter |

**자기 수정 메커니즘:**
```
1. 주간 메타 평가 실행
2. 각 축의 트렌드 분석 (개선/정체/악화)
3. 악화 축에 대해 원인 가설 생성
4. 전략 수정 제안:
   - Observer 채널 가중치 조정
   - Intent 우선순위 공식 파라미터 조정
   - Trust Score 계산 가중치 조정
   - 루프 간격/cooldown 조정
5. 제안을 Learning Journal에 기록
6. 고신뢰도(≥80%) 제안은 자동 적용, 나머지는 사람 확인
```

**핵심 컴포넌트:**
```
src/services/metacognition/
  metaCognitionTypes.ts      — MetaEvaluation, StrategyAdjustment 타입
  metaEvaluator.ts           — 5축 메트릭 수집 + 트렌드 분석
  strategyAdjuster.ts        — 파라미터 조정 제안 + 자동 적용
  metaCognitionScheduler.ts  — 주간 평가 스케줄러
```

**Exit Criteria:**
- [ ] 5축 메트릭 수집 + 주간 리포트 생성
- [ ] 전략 수정 제안 생성 검증
- [ ] 고신뢰도 제안 자동 적용 + 효과 추적
- [ ] Obsidian vault에 메타 평가 기록 (graph-first 검색 가능)

**예상 변경 파일:** ~5개 신규, ~3개 수정  
**위험:** 중간 — 자기 수정이 과도하면 시스템 불안정. 변경 폭 제한(±10%/주) 적용.

---

## 실행 순서 및 의존성

```
Phase F (Observer) ──→ Phase G (Intent Formation) ──→ Phase H (Trust Engine)
                                                            │
                                                            ├──→ Phase I (Tool Synthesis)
                                                            │
                                                            └──→ Phase J (Meta-Cognition)
```

| Phase | 의존성 | 예상 규모 | 권장 우선순위 |
|-------|--------|-----------|---------------|
| F | 없음 (기존 인프라 활용) | ~12 신규 파일 | **즉시 시작** |
| G | F | ~8 신규 파일 | F 완료 후 |
| H | G + 스프린트 이력 20회 | ~6 신규 파일 | G 완료 + 데이터 축적 후 |
| I | H + OpenShell | ~6 신규 파일 | H 완료 후 |
| J | F~I 중 2개 + 30일 운영 데이터 | ~5 신규 파일 | 데이터 축적 후 |

---

## Risk Assessment

| 위험 | 심각도 | 완화 전략 |
|------|--------|-----------|
| 자율 실행이 프로덕션 장애 유발 | 🔴 높음 | Trust Hard Cap (`approve-ship` 기본), Scope Guard, 롤백 자동화 |
| LLM 생성 코드가 보안 취약점 포함 | 🔴 높음 | OpenShell 샌드박스 격리 + NemoClaw 리뷰 + `security-audit` phase 필수 |
| Observer 오탐에 의한 불필요한 스프린트 남발 | 🟡 중간 | Intent 예산 게이트 + cooldown + 우선순위 큐 |
| Self-Improvement Loop와 Intent Engine 중복 | 🟡 중간 | Phase G에서 기존 루프를 Intent Engine의 특수 채널로 통합 |
| Trust Score 과도한 상승 (오버피팅) | 🟡 중간 | Decay 메커니즘 + Category 격리 + Instant Demotion |
| 메타 인지의 자기 수정이 시스템 불안정 유발 | 🟡 중간 | 변경 폭 ±10%/주 제한 + 고신뢰도(≥80%)만 자동 적용 |
| FinOps 비용 폭발 | 🟡 중간 | 일일/주간 토큰 예산 + 서킷 브레이커 보존 |

---

## 외부 OSS 활용 매핑

| Phase | 활용하는 외부 OSS | 역할 |
|-------|------------------|------|
| F (Observer) | OpenJarvis (jarvis.bench) | 성능 벤치마크 결과를 Observer에 피딩 |
| G (Intent) | - | 순수 내부 로직 (LLM은 rule 실패 시 fallback) |
| H (Trust) | NemoClaw (code.review) | 스프린트 리뷰 품질 → Trust Score에 반영 |
| I (Synthesis) | OpenShell (sandbox.exec) | 합성 도구 격리 실행 환경 |
| I (Synthesis) | NemoClaw (code.review) | 합성 코드 리뷰 게이트 |
| J (Meta) | OpenJarvis (jarvis.optimize) | 메타 평가 결과 → 최적화 제안 |

---

## Configuration (New Env Vars)

```env
# Phase F: Observer
OBSERVER_ENABLED=false
OBSERVER_SCAN_INTERVAL_MS=300000          # 5분
OBSERVER_DISCORD_PULSE_ENABLED=true
OBSERVER_MEMORY_GAP_ENABLED=true
OBSERVER_CODE_HEALTH_ENABLED=true

# Phase G: Intent Formation
INTENT_FORMATION_ENABLED=false
INTENT_DAILY_BUDGET_TOKENS=500000
INTENT_WEEKLY_BUDGET_TOKENS=2000000
INTENT_MAX_CONCURRENT_SPRINTS=3
INTENT_RULE_FIRST_ENABLED=true

# Phase H: Trust Engine
TRUST_ENGINE_ENABLED=false
TRUST_MAX_AUTONOMY_LEVEL=approve-ship     # hard cap
TRUST_DECAY_DAILY=0.01
TRUST_INSTANT_DEMOTION_ON_ROLLBACK=true
TRUST_MIN_SPRINTS_FOR_UPGRADE=20

# Phase I: Tool Synthesis
TOOL_SYNTHESIS_ENABLED=false
TOOL_SYNTHESIS_SANDBOX_REQUIRED=true
TOOL_SYNTHESIS_REVIEW_GATE=true
TOOL_SYNTHESIS_TEMP_MAX_USES=10
TOOL_SYNTHESIS_TEMP_EXPIRES_HOURS=24

# Phase J: Meta-Cognition
META_COGNITION_ENABLED=false
META_COGNITION_INTERVAL_HOURS=168         # 주간
META_COGNITION_AUTO_APPLY_MIN_CONFIDENCE=0.80
META_COGNITION_MAX_CHANGE_PER_WEEK_PCT=10
```

모든 Phase는 `*_ENABLED=false` 기본값으로 안전하게 비활성 상태로 배포됨.

---

## 성공 기준 (전체)

이 계획의 최종 성공은 다음으로 측정한다:

1. **사람 개입 빈도 50% 감소** — 현재 모든 스프린트에 1회 이상 개입 → Phase H 이후 bugfix 스프린트의 50%가 full-auto
2. **관찰 → 스프린트 자동 생성** — Phase G 이후 월간 최소 5개 Intent가 관찰에서 자동 생성
3. **새 도구 합성 성공** — Phase I 이후 최소 3개 도구를 자율적으로 합성 + 사용
4. **시스템 자기 평가 정확도** — Phase J의 메타 평가가 사람의 주관적 평가와 70%+ 일치
5. **안정성 유지** — 전 과정에서 프로덕션 장애 0건 (장애 발생 시 즉시 Hard Cap 하향)

---

## Recommended Next Skill

- Phase F 즉시 시작: `/implement objective="Phase F: Observer Layer 구현"`
- 구현 전 보안 검토 필요 시: `/security-audit scope="Observer Layer + Intent Formation 설계"`
