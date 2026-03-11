# T-004: Admin Memory Commands (Discord)

## 목표

관리자가 장기기억을 즉시 교정할 수 있도록 최소 명령 체계를 제공한다.

## 명령 세트

1. /기억검색 query:<text> [유형]

- 길드 메모리 검색 + 근거 표시

2. /기억고정 memoryId:<id> [사유]

- memory_feedback(action=pin)
- memory_items.pinned=true

3. /기억수정 memoryId:<id> 내용:<text> [사유]

- memory_feedback(action=edit)
- memory_items.content/summary 업데이트

4. /기억폐기 memoryId:<id> 사유:<text>

- memory_feedback(action=deprecate)
- memory_items.status=deprecated

5. /기억충돌목록 [상태]

- memory_conflicts 조회

6. /기억충돌해결 conflictId:<id> resolution:<text>

- memory_conflicts.status=resolved
- memory_feedback(action=approve or reject)

## 권한 모델

- requireAdmin 필수
- 일반 사용자는 /기억검색(읽기 축약형)만 허용 가능

## 감사 규칙

- 모든 교정 명령은 actor_id, reason, patch를 memory_feedback에 기록
- 교정 후 5분 내 회수 반영

## 실패 처리

- 대상 memoryId 미존재: NOT_FOUND
- guild_id 불일치: FORBIDDEN
- 이미 deprecated 항목 재폐기: NOOP 처리
