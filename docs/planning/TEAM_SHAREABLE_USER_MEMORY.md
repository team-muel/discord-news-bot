# Team Shareable User Memory

Status: Share-safe extract (2026-04-12)

목적:

- persistent user memory 전체를 그대로 복사하지 않고, 팀 협업에 도움이 되는 항목만 추린다.
- raw private memory의 정본은 repo 밖 persistent memory에 남겨 두고, 이 문서는 repo-shareable subset만 유지한다.

## Collaboration Preferences

- 좋은 agent는 모호하거나 덜 정제된 질문도 개선해서 답해야 한다.
- 프롬프트 템플릿을 사용자의 필수 준비물로 요구하지 않는다.
- shared Obsidian promotion은 control-plane hardening과 분리된 별도 업무가 아니라, operator-visible change의 same-window close-out 또는 definition-of-done으로 다룬다.
- 이 저장소에서는 graph-first Obsidian retrieval을 기본으로 두고, chunk-first RAG는 fallback으로만 취급한다.

## Output And Safety Preferences

- Discord user-facing 응답에서는 raw result뿐 아니라 Deliverable block 내부 텍스트도 sanitize해야 한다.
- planning, release gate, 운영 설명에서 Obsidian CLI와 headless 또는 remote-mcp 역할 구분을 흐리지 않는다.

## External Tool Terminology To Keep Stable

- OpenClaw: 항상 켜져 있는 personal AI assistant이자 agent 본체로 취급한다.
- NVIDIA NemoClaw: OpenClaw를 OpenShell 위에서 운영하는 reference stack으로 본다. 독립 AI로 부르지 않는다.
- NVIDIA OpenShell: sandbox runtime이다.
- OpenJarvis: OpenClaw/NemoClaw와 별개의 local-first personal AI framework이다.
- OpenCode: OSS coding agent로 취급한다.

## Selected Share-Safe Recurring Gotchas

- Windows에서는 `Set-Content`나 `Copy-Item`으로 UTF-8 Korean text 파일을 다루면 cp949 인코딩 손상이 날 수 있다. repo 파일 복사/쓰기에는 safer path를 쓴다.
- VS Code MCP stdio 프로세스는 오래된 코드를 붙잡고 있을 수 있다. shared MCP behavior가 안 바뀌면 stale stdio or node process부터 의심한다.
- remote shared MCP Obsidian write path에서는 `allowHighLinkDensity` 같은 sanitizer 관련 flag가 전체 hop을 끝까지 살아야 한다. 바깥 adapter만 고쳐서는 충분하지 않을 수 있다.
- LiteLLM에 `master_key`가 있으면 공개 health probe는 `/health`가 아니라 `/health/liveliness`를 써야 한다.
- `tsx` ad-hoc eval은 `.env`를 자동 로드하지 않을 수 있다. runtime snapshot 확인 스크립트는 env loading 여부를 항상 의식한다.

## Usage Guidance

- 이 문서는 팀 협업과 agent behavior alignment에 필요한 항목만 유지한다.
- 개인 전용 메모, 실험 중인 임시 습관, 아직 team-wide rule로 굳지 않은 항목은 넣지 않는다.
- 새 항목을 추가할 때는 "team shareable인가", "repo 또는 운영 품질에 재사용 가치가 있는가"를 먼저 확인한다.
