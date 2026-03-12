# MCP Tool Spec (Muel v1)

This document defines the initial MCP tool contract for Muel.

## Scope

Server: `muel-mcp-server`
Protocol style: JSON-RPC over stdio (line-delimited bootstrap implementation)
Methods:

- `initialize`
- `tools/list`
- `tools/call`

## Tools

Worker tools (lightweight crawler worker):

- `youtube.search.first`
- `youtube.search.webhook`
- `youtube.monitor.latest`
- `news.google.search`
- `news.monitor.candidates`
- `community.search`
- `web.fetch`

### 1) stock.quote

- Purpose: 티커 심볼 시세 조회
- Input:
  - `symbol: string` (required)
- Output:
  - JSON text of quote fields

### 2) stock.chart

- Purpose: 티커 심볼 차트 URL 생성
- Input:
  - `symbol: string` (required)
- Output:
  - chart URL string

### 3) investment.analysis

- Purpose: 텍스트 기반 투자 분석 생성
- Input:
  - `query: string` (required)
- Output:
  - analysis text

### 4) action.catalog

- Purpose: 현재 등록된 액션 카탈로그 조회
- Input: none
- Output:
  - JSON array string of action names

### 5) action.execute.direct

- Purpose: 등록된 액션 직접 실행 (운영 점검/개발용)
- Input:
  - `actionName: string` (required)
  - `goal: string` (required)
  - `args: object` (optional)
- Output:
  - JSON text of action result

## Safety Notes

- 정책형 실행(allowlist/approval)은 backend action runner path에서 강제합니다.
- `action.execute.direct`는 운영 노출 범위를 최소화하고 내부 네트워크/권한 제어 하에서만 사용해야 합니다.
- 향후 정식 MCP 릴리즈에서는 Content-Length framing, auth context, tenant scoping을 추가해야 합니다.
