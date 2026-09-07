// MCP 링이 던지는 에러 셋.
//
// **무엇을 던지고 무엇을 모델에게 돌려주는지가 이 링의 핵심 판단이다.** F2.2의 정책
// ("모델이 고칠 수 있는 건 메시지로, 우리 버그는 전파")에 MCP는 축을 하나 더 얹는다 —
// **연결이라는 실패 지점**이다. 그래서 셋은 전부 "모델이 고칠 수 없는 것"이다:
// 서버가 안 뜨거나(Connection), 규약을 어겼거나(Protocol), 스키마가 표현 불가(ToolSchema).
// 반대로 **툴 실행 실패(`isError: true`)는 안 던진다** — 그건 MCP가 모델에게 보여주라고
// 만든 필드다(tools.ts 참조).

/** 서버를 못 띄웠거나, 핸드셰이크 전에 죽었거나, 요청 중에 끊겼다. */
export class McpConnectionError extends Error {
  readonly stderr: string;
  constructor(message: string, stderr = "") {
    // stderr가 진짜 원인을 들고 있다(`command not found`, 파이썬 트레이스백…).
    // 안 실어주면 "서버가 죽었다"만 남아 디버깅이 불가능해진다.
    super(stderr.trim() === "" ? message : `${message}\n--- 서버 stderr ---\n${stderr.trim()}`);
    this.name = "McpConnectionError";
    this.stderr = stderr;
  }
}

/** 서버가 JSON-RPC 에러를 돌려줬거나, 응답 모양이 규약과 다르다. */
export class McpProtocolError extends Error {
  readonly code: number | undefined;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "McpProtocolError";
    this.code = code;
  }
}

/**
 * 서버가 준 `inputSchema`를 zod로 되돌리지 못했다.
 *
 * **어느 툴인지 이름을 말한다.** 서버 하나가 툴 20개를 주는데 "스키마 변환 실패"만 뜨면
 * 어디를 봐야 할지 알 수 없다. (F1.5의 `MissingApiKeyError`가 환경변수 이름을 말하는 것과
 * 같은 규칙 — 에러는 다음에 할 일을 알려줘야 한다.)
 */
export class McpToolSchemaError extends Error {
  readonly toolName: string;
  constructor(toolName: string, cause: unknown) {
    super(
      `MCP 툴 '${toolName}'의 inputSchema를 zod로 되돌리지 못했다: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "McpToolSchemaError";
    this.toolName = toolName;
  }
}
