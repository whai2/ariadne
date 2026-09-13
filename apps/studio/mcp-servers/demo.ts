export {};

interface Rpc {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

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
  {
    name: "write_note",
    description: "메모를 저장한다. 같은 제목이면 덮어쓴다.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "메모 제목" },
        body: { type: "string", description: "메모 내용" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
];

const notes = new Map<string, string>();

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fakeWeather(city: string): string {
  const conditions = ["맑음", "구름 조금", "흐림", "비", "눈"];
  let hash = 0;
  for (const ch of city) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const condition = conditions[hash % conditions.length];
  const temp = 5 + (hash % 26);
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
  if (name === "write_note") {
    const title = String(args.title ?? "");
    notes.set(title, String(args.body ?? ""));
    return {
      content: [{ type: "text", text: `메모 '${title}' 저장됨 (총 ${notes.size}개)` }],
    };
  }
  return { __error: { code: -32602, message: `그런 툴이 없다: ${String(name)}` } };
}

function handle(msg: Rpc): void {
  const { id, method } = msg;
  if (id === undefined) return;

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
      // 깨진 줄은 무시한다.
    }
  }
}
