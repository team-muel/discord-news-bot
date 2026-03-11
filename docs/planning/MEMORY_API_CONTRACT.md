# T-002: Memory API Contract (Draft v1)

## 공통 규칙

- 모든 엔드포인트는 관리자 권한(requireAdmin) 기준
- 모든 쓰기 요청은 guildId 필수
- 모든 응답은 가능하면 citations 포함

## 1) 메모리 검색

### GET /api/bot/agent/memory/search

Query

- guildId: string (required)
- q: string (required)
- type: episode|semantic|policy|preference (optional)
- limit: number (optional, default 8, max 20)

Response 200

```json
{
  "ok": true,
  "items": [
    {
      "id": "mem_123",
      "type": "policy",
      "title": "공지 채널 규칙",
      "content": "모든 공지는 #announcements에서만 공지",
      "confidence": 0.91,
      "pinned": true,
      "score": 0.87,
      "citations": [
        { "sourceKind": "discord_message", "sourceMessageId": "129001" }
      ],
      "updatedAt": "2026-03-12T10:00:00.000Z"
    }
  ],
  "meta": {
    "requestedTopK": 8,
    "returned": 1,
    "queryLatencyMs": 43
  }
}
```

## 2) 메모리 생성

### POST /api/bot/agent/memory/items

Body

```json
{
  "guildId": "123",
  "channelId": "456",
  "type": "semantic",
  "title": "서버 핵심 주제",
  "content": "이 서버는 AI 트레이딩과 자동화 운영 중심",
  "tags": ["identity", "topic"],
  "confidence": 0.72,
  "source": {
    "sourceKind": "admin_edit",
    "sourceRef": "manual-seed"
  }
}
```

Response 201

```json
{
  "ok": true,
  "item": {
    "id": "mem_abc",
    "guildId": "123",
    "type": "semantic",
    "status": "active"
  }
}
```

## 3) 관리자 교정

### POST /api/bot/agent/memory/items/:memoryId/feedback

Body

```json
{
  "guildId": "123",
  "action": "deprecate",
  "reason": "정책 변경으로 무효화",
  "patch": {
    "status": "deprecated"
  }
}
```

Response 202

```json
{
  "ok": true,
  "message": "feedback accepted",
  "memoryId": "mem_abc",
  "action": "deprecate"
}
```

## 4) 충돌 조회

### GET /api/bot/agent/memory/conflicts

Query

- guildId: string (required)
- status: open|resolved|ignored (optional, default open)
- limit: number (optional, default 20)

Response 200

```json
{
  "ok": true,
  "conflicts": [
    {
      "id": 10,
      "conflictKey": "policy:announcement-channel",
      "itemAId": "mem_old",
      "itemBId": "mem_new",
      "status": "open",
      "createdAt": "2026-03-12T09:00:00.000Z"
    }
  ]
}
```

## 5) 압축 잡 실행

### POST /api/bot/agent/memory/jobs/run

Body

```json
{
  "guildId": "123",
  "jobType": "short_summary",
  "windowStartedAt": "2026-03-12T00:00:00.000Z",
  "windowEndedAt": "2026-03-12T01:00:00.000Z"
}
```

Response 202

```json
{
  "ok": true,
  "job": {
    "id": "job_001",
    "status": "queued",
    "jobType": "short_summary"
  }
}
```

## 6) 잡/큐 운영 통계

### GET /api/bot/agent/memory/jobs/stats

Query

- guildId: string (optional)

Response 200

```json
{
  "ok": true,
  "runner": {
    "enabled": true,
    "inFlight": false,
    "pollIntervalMs": 20000,
    "maxRetries": 3,
    "backoffBaseMs": 15000,
    "backoffMaxMs": 1800000
  },
  "queue": {
    "queued": 2,
    "running": 0,
    "completed": 11,
    "failed": 1,
    "retryScheduled": 1,
    "deadlettered": 1,
    "total": 14
  }
}
```

## 7) 메모리 품질 지표

### GET /api/bot/agent/memory/quality/metrics

Query

- guildId: string (optional)
- days: number (optional, default 30, max 180)

Response 200

```json
{
  "ok": true,
  "scope": "123",
  "windowDays": 30,
  "memory": {
    "activeItems": 120,
    "withSource": 114,
    "citationRate": 0.95
  },
  "conflicts": {
    "open": 2,
    "unresolvedConflictRate": 0.0167
  },
  "jobs": {
    "total": 40,
    "failed": 3,
    "deadlettered": 1,
    "failureRate": 0.075
  }
}
```

## 8) 데드레터 조회/재처리

### GET /api/bot/agent/memory/jobs/deadletters

Query

- guildId: string (optional)
- limit: number (optional, default 30, max 200)

### POST /api/bot/agent/memory/jobs/deadletters/:deadletterId/requeue

Response 202

```json
{
  "ok": true,
  "requeued": true,
  "jobId": "mjob_xxx",
  "source": "existing_job"
}
```

## 9) 잡 취소

### POST /api/bot/agent/memory/jobs/:jobId/cancel

Response 202

```json
{
  "ok": true,
  "jobId": "mjob_001",
  "status": "canceled"
}
```

## 에러 규격

```json
{
  "ok": false,
  "error": "VALIDATION",
  "message": "guildId is required"
}
```

## 보안/정책 메모

- 모든 읽기/쓰기 요청은 guildId 범위로 제한
- 고위험 액션(deprecate/resolve)은 requireAdmin + rate limit 적용
- response에 citations가 없으면 confidence 상한을 0.60 이하로 제한
- memory domain 테이블은 guild_id 기반 RLS 정책을 적용
