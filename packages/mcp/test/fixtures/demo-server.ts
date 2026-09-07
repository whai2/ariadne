// 테스트·예제용 **진짜 MCP 서버**. stdio 트랜스포트, JSON-RPC 2.0.
//
//   bun run test/fixtures/demo-server.ts
//
// 가짜 클라이언트로 우리 클라이언트를 테스트하면 우리가 상상한 서버만 통과한다. 그래서 여기
// 서버를 **스펙대로** 한 벌 짰다 — 프로세스 경계·프레이밍·핸드셰이크가 전부 진짜로 일어난다.
// 그러면서도 **네트워크 0 · 자격증명 0**이라 오프라인에서 `verify`가 그린이다.
// (F2.2의 "가짜 모델" 판단과 같은 이유: 검증 대상이 프로토콜이라 결정론적이어야 관찰이 된다.)
//
// `MCP_FIXTURE_PAGINATE=1`이면 tools/list를 **두 페이지로 쪼개** 커서 순회를 시험한다.

// `export {}`는 이 파일을 모듈로 만든다 — 최상위 `for await`가 모듈에서만 허용된다.
export {};

interface Rpc {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: "echo",
    description: "받은 문자열을 그대로 돌려준다",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "돌려줄 문자열" },
        upper: { type: "boolean", description: "대문자로 바꿀지" },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "divide",
    description: "a를 b로 나눈다. b가 0이면 툴이 실패한다(isError).",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
      additionalProperties: false,
    },
  },
];

const paginate = process.env.MCP_FIXTURE_PAGINATE === "1";

function send(message: unknown): void {
  // stdout은 **오직 프레임만** 나가는 통로다. 로그 한 줄이 섞이면 클라이언트가 파싱에 실패한다.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function listTools(cursor: unknown): unknown {
  if (!paginate) return { tools: TOOLS };
  return cursor === "page2"
    ? { tools: TOOLS.slice(1) }
    : { tools: TOOLS.slice(0, 1), nextCursor: "page2" };
}

function callTool(params: Record<string, unknown>): unknown {
  const name = params.name;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (name === "echo") {
    const text = String(args.text ?? "");
    return {
      content: [{ type: "text", text: args.upper === true ? text.toUpperCase() : text }],
    };
  }
  if (name === "divide") {
    const a = Number(args.a);
    const b = Number(args.b);
    // **툴 실패는 JSON-RPC 에러가 아니다.** 스펙이 정한 자리 — 모델이 보고 고치라고 결과에 싣는다.
    if (b === 0) return { content: [{ type: "text", text: "0으로 나눌 수 없다" }], isError: true };
    return { content: [{ type: "text", text: String(a / b) }] };
  }
  // 모르는 툴 이름은 **프로토콜 에러**다(우리가 준 목록 밖이므로 클라이언트 잘못).
  return { __error: { code: -32602, message: `그런 툴이 없다: ${String(name)}` } };
}

function handle(msg: Rpc): void {
  const { id, method } = msg;
  if (id === undefined) return; // 통보(notifications/initialized 등) — 답하지 않는다

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ariadne-demo", version: "0.0.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: listTools(msg.params?.cursor) });
    return;
  }
  if (method === "tools/call") {
    const result = callTool(msg.params ?? {});
    const failure = (result as { __error?: unknown }).__error;
    send(
      failure === undefined
        ? { jsonrpc: "2.0", id, result }
        : { jsonrpc: "2.0", id, error: failure },
    );
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: `모르는 메서드: ${method}` } });
}

let buffer = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim() === "") continue;
    try {
      handle(JSON.parse(line) as Rpc);
    } catch {
      // 깨진 줄은 무시한다. 서버가 여기서 죽으면 클라이언트는 원인을 못 본다.
    }
  }
}
// stdin이 닫히면 나간다 — 클라이언트의 `close()`가 기대하는 정중한 종료다.
