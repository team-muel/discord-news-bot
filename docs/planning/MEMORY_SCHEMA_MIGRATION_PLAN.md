# T-001: Memory Schema Migration Plan

## 목적

길드 단위 고맥락 장기기억을 저장/회수/교정하기 위한 테이블 집합을 도입한다.

## 반영 대상

- docs/SUPABASE_SCHEMA.sql
- 섹션: Long-term memory agent (guild context)

## 신규 테이블

1. memory_items

- 기억 본문과 메타데이터
- type: episode | semantic | policy | preference
- status: active | deprecated | archived
- confidence, priority, pinned, conflict_key 포함

2. memory_sources

- 기억의 근거 소스 추적
- source_kind: discord_message | summary_job | admin_edit | system
- message_id, author_id, excerpt 보관

3. memory_feedback

- 관리자 교정 로그
- action: pin | unpin | edit | deprecate | restore | approve | reject

4. memory_conflicts

- 상충 기억 관리
- status: open | resolved | ignored

5. memory_jobs

- 압축/재인덱싱 작업 이력
- job_type: short_summary | topic_synthesis | durable_extraction | reindex | conflict_scan | onboarding_snapshot
- next_attempt_at 기반 재시도 백오프 스케줄링

Queue-first 정책(고정):

- producer: `POST /api/bot/agent/memory/jobs/run` 경로에서 enqueue만 수행
- consumer: `src/services/memoryJobRunner.ts`가 `status=queued AND next_attempt_at<=now`를 polling 소비
- retry: `MEMORY_JOBS_MAX_RETRIES`, `MEMORY_JOBS_BACKOFF_BASE_MS`, `MEMORY_JOBS_BACKOFF_MAX_MS`
- deadletter: 최대 재시도 초과 시 `memory_job_deadletters` 적재 + 수동/자동 requeue 지원

6. memory_job_deadletters

- 최대 재시도 초과 실패 작업 보관
- 운영 분석/수동 재처리의 기준 레코드

7. memory_retrieval_logs

- 회수 호출 품질(지연/반환수/평균 score/citations) 기록
- recall 및 citation 관련 운영 지표의 원천 데이터

## 인덱스 전략

- 회수 최적화: (guild_id, status, pinned, priority, updated_at)
- 타입별 조회: (guild_id, type, updated_at)
- 충돌 탐색: (guild_id, conflict_key)
- 감사 추적: feedback/source 테이블의 created_at desc 인덱스
- 재시도 스케줄: memory_jobs(status, next_attempt_at) 인덱스
- 회수 추적: memory_retrieval_logs(guild_id, created_at) 인덱스

## 트리거

- set_updated_at 재사용
- memory_items / memory_conflicts / memory_jobs / agent_steps에 updated_at 트리거 적용

## RLS 정책

- memory\_\* 도메인 테이블 전부 RLS 활성화
- guild_id = auth.jwt() ->> 'guild_id' 조건으로 select/write 제한
- service_role은 운영/백엔드 작업을 위해 예외 허용

## 적용 순서

1. 스키마 변경 SQL 실행
2. 새 테이블 생성 확인
3. 기존 agentMemoryService는 읽기 fallback 유지
4. 신규 쓰기 로직 배포 (feature flag 권장)

## 롤백 전략

1. 애플리케이션에서 신규 테이블 쓰기 중단
2. 기존 guild_lore_docs 기반 읽기로 강등
3. 신규 테이블 drop은 데이터 백업 후 수동 수행

## 검증 체크리스트

1. memory_items insert/select 성공
2. memory_sources FK 제약 동작 확인
3. memory_feedback 액션 체크 제약 확인
4. memory_jobs 상태 전이 로깅 확인
5. 최대 재시도 초과 시 deadletters 적재 확인
6. guild_id 필터 없는 조회가 애플리케이션에서 차단되는지 확인
7. retrieval_logs 누적 및 quality metrics 집계 확인
