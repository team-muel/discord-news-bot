# ADR-006: 메모리 진화(Evolution)와 계층화(Tiering)

- 상태: Accepted
- 날짜: 2026-04-03

## 배경

현재 memory_items는 flat store에 INSERT-only로 동작한다.
A-MEM(NeurIPS 2025)과 H-MEM(EACL 2026) 연구는 다음 두 가지를 표준으로 제시한다:

1. **Memory Evolution**: 새 메모리 저장 시 기존 관련 메모리의 context/confidence를 자동 업데이트하고 링크를 생성
2. **Hierarchical Tiering**: 메모리가 raw → summary → concept → schema 계층으로 승격/강등

## 결정

### 1. memory_item_links 테이블 신설

메모리 간 양방향 연결을 명시적으로 저장한다.
- `source_id`, `target_id`: memory_items FK
- `relation_type`: related | derived_from | contradicts | supersedes
- `strength`: 0~1 (유사도 또는 LLM 판정 기반)

### 2. memory_items에 tier 컬럼 추가

4단계 계층: `raw` → `summary` → `concept` → `schema`
- 신규 메모리는 `raw`로 시작
- consolidation batch가 주기적으로 하위 tier를 상위로 통합

### 3. Evolution 로직을 durable_extraction에 삽입

INSERT 전에 기존 관련 메모리를 hybrid search로 탐색하여:
- 유사 메모리가 있으면 confidence boost + link 생성
- 모순 메모리가 있으면 contradicts link + conflict_scan 큐잉
- 기존 메모리의 updated_at을 갱신하여 recency score에 반영

### 4. Consolidation batch job

6시간 간격으로 raw tier 메모리를 summary tier로 통합.
- 같은 주제(tag/keyword overlap)의 raw 메모리 3개 이상 → LLM 요약 → summary tier 생성
- summary 3개 이상 → concept tier 생성 (LLM 추상화)
- schema tier는 수동 승격만 허용 (안전 보장)

## 근거

- A-MEM의 Zettelkasten 패턴은 Obsidian graph-first 전략과 자연스럽게 정렬
- H-MEM의 계층화는 기존 ADR-005 compression pipeline(short→topic→durable)과 동일 방향
- entityNervousSystem의 precipitation, reward-behavior, self-notes 3 circuit에 evolution이 4번째 circuit으로 추가

## 영향 범위

- `docs/SUPABASE_SCHEMA.sql`: memory_item_links 테이블, memory_items.tier 컬럼
- `src/services/memoryEvolutionService.ts`: 신규 — evolution + linking 로직
- `src/services/memoryConsolidationService.ts`: 신규 — tier 승격 batch
- `src/services/memoryJobRunner.ts`: durable_extraction에 evolution 호출 삽입
- `src/services/agent/agentMemoryService.ts`: scoring formula에 tier/link 가중치 추가
- `src/services/runtimeBootstrap.ts`: consolidation batch 타이머 등록

## 후속 작업

- Obsidian vault에 link graph를 미러링하는 옵션 (Phase 3+)
- schema tier 자동 승격을 위한 LLM judge gate
- memory evolution 품질 평가셋 구축
