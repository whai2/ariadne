// MCP 와이어 — stdio 트랜스포트의 JSON-RPC 2.0 프레이밍 (F3.2).
//
// **프레이밍이 LSP와 다르다.** LSP는 `Content-Length:` 헤더로 길이를 앞세우지만 MCP stdio는
// **개행으로 나뉜 JSON 한 줄**이다(메시지 안에 개행이 없어야 한다는 게 스펙의 요구다).
// 이 파일은 그 규칙만 **순수 함수**로 담는다 — spawn도 스트림도 모른다. 그래서 프로토콜
// 테스트가 프로세스를 안 띄우고 돈다(F1.5의 `resolveSpec`을 순수하게 뗀 것과 같은 이유).
//
// 우리가 쓰는 메서드는 셋뿐이다: `initialize` · `tools/list` · `tools/call`.
// 리소스·프롬프트·샘플링·구독은 안 다룬다 — 이 단계가 사는 이유가 **툴**이라서다.

/** JSON-RPC 에러 객체. `code`는 스펙 값(-32601 등)이거나 서버가 정한 값. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** 우리가 기다리는 것 — id가 달린 응답. */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

/** 한 프레임으로 만든다. 개행이 곧 경계라 **줄 끝에 `\n`이 반드시 붙는다.** */
export function encodeFrame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * 누적 버퍼를 완성된 프레임들과 **남은 꼬리**로 가른다. 순수 함수.
 *
 * 스트림은 프레임 경계에서 끊어주지 않는다 — 한 chunk에 응답 세 개가 오기도 하고, JSON 하나가
 * 반으로 잘려 오기도 한다. 그래서 호출자가 `rest`를 들고 다음 chunk 앞에 붙인다.
 * 빈 줄은 버린다(서버가 개행을 덧붙여도 무해하도록).
 */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n");
  // 마지막 조각은 개행을 아직 못 만난 미완성분이다 — 버퍼에 남긴다.
  const rest = parts.pop() ?? "";
  return { frames: parts.filter((line) => line.trim() !== ""), rest };
}

/**
 * 프레임 하나를 **응답이면** 응답으로, 아니면 `undefined`로.
 *
 * 서버는 응답 말고도 알림(`notifications/tools/list_changed`)이나 역방향 요청(샘플링·elicitation)을
 * 보낼 수 있다. 우리는 그 능력을 `initialize`에서 선언하지 않으므로 **조용히 흘린다** —
 * 모르는 걸 받았다고 연결을 끊으면 툴만 쓰려는 서버 연동이 서버 취향에 따라 깨진다.
 */
export function asResponse(frame: string): JsonRpcResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch {
    return undefined; // 깨진 줄. 서버가 stdout에 로그를 흘리는 사고가 흔하다.
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const msg = parsed as Record<string, unknown>;
  const id = msg.id;
  if (typeof id !== "number" && typeof id !== "string") return undefined; // 알림
  if (!("result" in msg) && !("error" in msg)) return undefined; // 역방향 요청
  return msg as unknown as JsonRpcResponse;
}
