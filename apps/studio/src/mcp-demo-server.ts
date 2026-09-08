// 스튜디오 데모용 **진짜 MCP 서버**. stdio 트랜스포트, JSON-RPC 2.0.
//
//   bun run src/mcp-demo-server.ts   (직접 띄워볼 수도 있다)
//
// 스튜디오가 시작할 때 이 파일을 자식 프로세스로 띄우고(`connectMcpAgents`), 여기가 주는 툴을
// MCP 에이전트의 툴 배열에 채운다. 그 뒤로는 로컬 툴과 **구분이 없다** — 그게 이 데모의 전부다.
//
// `@ariadne/mcp`의 테스트 픽스처(demo-server.ts)와 판박이지만 **일부러 따로 둔다**: 남의 패키지
// test/ 안을 런타임에 spawn하면 그 파일이 사라지거나 옮겨질 때 스튜디오가 조용히 깨진다.
// 스튜디오의 예제는 스튜디오가 소유한다. **네트워크 0 · 자격증명 0**이라 오프라인에서도 돈다.

// `export {}`는 이 파일을 모듈로 만든다 — 최상위 `for await`가 모듈에서만 허용된다.
export {};

interface Rpc {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

// 서버가 주는 툴 선언. inputSchema가 **JSON Schema 원본**이다 — 클라이언트는 이걸 그대로
// 모델에게 보내고, 검증용 zod만 z.fromJSONSchema로 되돌려 만든다(왕복 안 시킴).
const TOOLS = [
  {
    name: "get_weather",
    description: "도시 이름을 받아 현재 날씨를 알려준다(데모용 결정론적 값).",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string", description: "도시 이름" } },
      required: ["city"],
      additionalProperties: false,
    },
  },
  {
    name: "word_count",
    description: "문장에 든 단어 수를 센다.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "셀 문장" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
];

function send(message: unknown): void {
  // stdout은 **오직 프레임만** 나가는 통로다. 로그 한 줄이 섞이면 클라이언트가 파싱에 실패한다.
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** 도시 이름을 결정론적 날씨로. 진짜 API가 아니라 데모라 관찰이 재현된다. */
function fakeWeather(city: string): string {
  const conditions = ["맑음", "구름 조금", "흐림", "비", "눈"];
  let hash = 0;
  for (const ch of city) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const condition = conditions[hash % conditions.length];
  const temp = 5 + (hash % 26); // 5~30도
  return `${city}: ${condition}, ${temp}°C`;
}

function callTool(params: Record<string, unknown>): unknown {
  const name = params.name;
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  if (name === "get_weather") {
    return { content: [{ type: "text", text: fakeWeather(String(args.city ?? "")) }] };
  }
  if (name === "word_count") {
    const words = String(args.text ?? "")
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "");
    return { content: [{ type: "text", text: String(words.length) }] };
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
        serverInfo: { name: "ariadne-studio-demo", version: "0.0.0" },
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
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
      // 깨진 줄은 무시한다. 여기서 죽으면 클라이언트는 원인을 stderr로만 본다.
    }
  }
}
// stdin이 닫히면 나간다 — 클라이언트의 `close()`가 기대하는 정중한 종료다.
