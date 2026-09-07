// @ariadne/mcp — MCP 링의 공개 배럴.
//
// **툴 정의의 두 번째 입구다.** `@ariadne/tools`의 입구는 `defineTool`(zod) 하나뿐이었는데,
// 여기서 "우리 프로세스 밖에서 남이 이미 정의해 둔 툴"이 같은 `Tool` 모양으로 들어온다.
//
//   defineTool(zod)  ─┐
//                     ├→ AnyTool ─┬→ toolSpecs() → model.invoke({tools})
//   mcpTools(server) ─┘           └→ toolNode()  → 실행
//                                    ↑ 여기부터 한 글자도 안 바뀐다
//
// 두 층이다:
//   protocol.ts · client.ts  **프로토콜** — stdio JSON-RPC. 툴 링을 모른다.
//   tools.ts                 **다리** — 서버 툴 선언을 `Tool`로. 여기만 두 링을 다 안다.
//
// **왜 tools 링에 안 넣었나:** 그러면 순수했던 툴 링이 자식 프로세스·JSON-RPC·연결 수명을 지게
// 된다. 툴을 zod로 적는 사람은 그걸 몰라도 된다. 의존 방향은 `mcp → tools` 한 방향이고,
// tools는 mcp를 모른다(F2.2가 정한 링 규칙 그대로).
//
// **왜 루프가 우리 안에 남나:** 같은 "MCP"라도 `claude --mcp-config`는 툴 루프를 claude 프로세스
// 안으로 넘긴다 — 스텝이 안 보이고 제어를 놓친다(F2.4가 거부한 길). 여기선 **우리가 클라이언트**라
// 호출 결정은 모델이, 실행은 `toolNode`가, 라우팅은 우리 엔진이 한다.

export type {
  McpContentBlock,
  McpServerInfo,
  McpToolDef,
  McpToolResult,
  StdioServerConfig,
} from "./client";
export { connectStdio, McpClient, PROTOCOL_VERSION } from "./client";
export { McpConnectionError, McpProtocolError, McpToolSchemaError } from "./errors";
export type { JsonRpcError, JsonRpcResponse } from "./protocol";
export { asResponse, encodeFrame, splitFrames } from "./protocol";
export { mcpTools, renderContent } from "./tools";
