# S11 · 스튜디오 × MCP — 툴이 외부에서 오는 걸 눈으로 본다

## 왜 이 커밋이 생겼나

F3.2가 `@ariadne/mcp`를 세웠지만 "안 한 것"에 **스튜디오 연동**을 남겼다. 링만 있고 화면이 없으면
"툴 정의의 두 번째 입구"라는 논지가 테스트 안에만 산다. 이 커밋은 그걸 **관찰 층으로 회수**한다 —
S9~S10이 세운 에이전트 사이드바에 MCP 에이전트 둘을 얹고, 툴 칩에 출처를 붙인다.

도착점 한 줄: **사이드바에서 고르면, 남의 서버가 준 툴로 우리 루프가 돈다.**

## 무엇이 도는가

`bun run --filter '@ariadne/studio' dev` → 사이드바에 에이전트 둘이 늘었다.

| 에이전트 | 서버 | 툴 | 조건 |
|---|---|---|---|
| `mcp` | `src/mcp-demo-server.ts` (우리 것, 자식 프로세스) | `get_weather` · `word_count` | **네트워크 0 · 키 0** |
| `filesystem` | `@modelcontextprotocol/server-filesystem` (남이 만든 공식 레퍼런스) | `read_text_file` · `list_directory` · `edit_file` … 14개쯤 | npx 다운로드 + 네트워크 |

둘째가 이 커밋의 진짜 증거다. 우리 데모 서버만 붙으면 **우리가 상상한 MCP**만 검증한 셈이라
(F3.2 노트가 픽스처를 진짜 서버로 짠 이유와 같다), 기성 서버에 붙어야 프로토콜 구현이 세상과
맞물린다는 게 보인다. 실제로 `serverInfo.name`이 `secure-filesystem-server`로 돌아온다.

## 발견 · 화면 쪽은 거의 안 바뀌었다

`agentInfo`·`buildAgentGraph`·`agentTurn`은 **한 글자도 안 바뀌었다.** 전부 그냥 `def.tools`를
읽는데, 그 배열이 언제 어디서 채워졌는지 관심이 없기 때문이다. 바뀐 건 딱 둘:

1. `AgentDef`에 `mcp?: StdioServerConfig` 한 필드 — **선언**.
2. `connectMcpAgents()` — 시작 시 붙어 `def.tools`를 **채운다**.

즉 MCP를 아는 파일이 `agents.ts` 하나로 갇힌다. 그래프도, 스텝 뷰도, 실행 경로도 계산기
에이전트와 물리적으로 같은 코드다. **"채운 뒤로는 구분이 없다"가 diff의 모양으로 증명된다.**

UI에 새로 생긴 건 출처 표식뿐이다 — `🛰 MCP: <서버이름>` 칩과, 툴 칩의 아이콘(`🔧`→`🛰`).
이건 기능이 아니라 **정직**이다. 원격 툴이 로컬 툴과 실행상 구분이 없다는 게 이 링의 논지인데,
사람에게까지 구분이 없으면 그건 논지가 아니라 사고다.

## 판단 · 연결 수명은 스튜디오가 쥔다

`connectMcpAgents()`는 **정리 함수를 반환**한다. `server.ts`가 서빙 전에 부르고 SIGINT에서
정리한다. F3.2 노트의 결론("가변 상태는 에이전트가 아니라 연결에 있다")이 앱 층에서 다시
확인되는 자리다 — 살아있는 자식 프로세스를 **앱이** 들고 있으므로 `createAgent`는 계속
상태 없는 함수로 남는다.

## 판단 · 한 서버가 안 떠도 스튜디오는 뜬다

`filesystem`은 npx 다운로드와 네트워크가 필요해서 **오프라인이면 반드시 실패한다.** 그걸
치명적으로 다루면 인터넷 없는 자리에서 스튜디오 전체가 안 뜬다. 그래서 서버마다 try/catch로
감싸 실패는 `def.mcpError`에 남기고 그 에이전트만 툴 없이 띄운다. 규칙은 데모 서버에도 똑같이
건다 — 로컬이라 거의 안 죽지만, 예외를 두면 "왜 저건 되고 이건 안 되나"가 코드에 생긴다.

화면은 이 실패를 **감추지 않는다.** `mcpError`가 있으면 경고 박스에 원문 그대로 뜬다.

## 판단 · 데모 서버를 픽스처에서 복사해 왔다

`apps/studio/src/mcp-demo-server.ts`는 `@ariadne/mcp`의 `test/fixtures/demo-server.ts`와
판박이다. 공유하지 않고 **일부러 복제했다**: 남의 패키지 `test/` 안을 런타임에 spawn하면
그 파일이 옮겨지거나 사라질 때 스튜디오가 조용히 깨진다. 테스트 픽스처는 그 패키지의 사유물이고,
스튜디오의 예제는 스튜디오가 소유한다.

## 검증

- 스튜디오 테스트 +3: 툴 목록이 `["get_weather","word_count"]`로 오고 `mcpServer`가
  `ariadne-studio-demo`인지 · MCP 에이전트의 `/api/agents/graph`가 model⇄tools 루프인지 ·
  `filesystem`이 **붙었으면** `secure-filesystem-server`인지(못 붙었으면 `mcpError`를 확인하고
  통과 — 오프라인 CI에서 그린).
- `bun run verify` 그린: **296 pass / 4 skip / 0 fail** (core 81 · tools 28 · mcp 37 · model 97 ·
  agent 7 · **studio 46**). 스튜디오 밖 다섯 패키지 **무수정**.

## 벽 → 다음

`filesystem` 에이전트가 이 커밋의 벽을 그대로 들고 있다. 그 서버는 `edit_file`·`write_file`처럼
**파일을 바꾸는 툴**을 준다. 지금 우리에겐 사람이 그 실행을 막을 자리가 없어서, 임시로
`apps/studio/mcp-sample/` 한 폴더만 열어주는 걸로 범위를 좁혔다 — **정책이 아니라 회피다.**

다음은 F3.3 **승인 게이트(human-in-the-loop)**: 툴 실행 직전에 멈추고, 사람이 승인해야 재개한다.
core가 "인터럽트는 범위 밖"이라 미뤄둔 지점과 정면으로 만난다.
