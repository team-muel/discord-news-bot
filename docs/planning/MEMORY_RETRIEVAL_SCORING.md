# T-003/T-005: Memory Retrieval and Response Scoring

## 목적

회수 품질과 응답 신뢰도를 일관된 수식으로 관리한다.

## 후보군 생성

1. semantic 검색 (vector)
2. 구조화 필터 (guild_id, status=active)
3. 최근성 필터 (기본 90일)

## 최종 점수

score = 0.45 _ semantic + 0.25 _ recency + 0.20 _ confidence + 0.10 _ adminWeight

- semantic: 임베딩 유사도(0~1)
- recency: 최근성 점수(0~1)
- confidence: memory_items.confidence
- adminWeight: pinned/approved 항목 가중치

## recency 계산

recency = exp(-days_since_update / 30)

- 업데이트 0일: 1.0
- 업데이트 30일: 약 0.37

## adminWeight

- pinned = true: +1.0
- approved_at not null: +0.7
- 둘 다 없음: +0.0

최종 항목 가중 반영 시 0~1로 normalize

## 응답 포맷 규칙

1. conclusion: 1~3문장
2. citations: 최소 1개(없으면 불확실 표기)
3. confidence_label:

- high: score >= 0.78 and citations >= 2
- medium: score >= 0.58
- low: otherwise

## 안전 응답 규칙

- citations 0개면 확정형 문장 금지
- policy 질문에서 policy type 미회수면 관리자 확인 유도
- 상충 기억이 open 상태면 conflict 경고 추가

## 관측 지표

- citation_rate
- retrieval_hit_at_k
- correction_followup_rate
- unresolved_conflict_rate
