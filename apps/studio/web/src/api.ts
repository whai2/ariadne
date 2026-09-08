// 서버 API 래퍼 + UI-로컬 타입. **서버 코드를 import하지 않는다** — UI는 브라우저에서 돌고
// 서버는 Bun에서 돈다. 응답 모양만 여기 다시 적는다(경계에서 타입을 지운 값).

export interface Message {
  role: "human" | "ai" | "system" | "tool";
  content: string;
  id?: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown>; invalidArgs?: string }[];
  toolCallId?: string;
  status?: "error";
}

export interface GraphView {
  nodes: string[];
  edges: { from: string; to: string; kind: "static" | "conditional" }[];
}

export interface ChannelSnapshot {
  key: string;
  type: string;
  available: boolean;
  value: unknown;
}

export interface StepUpdate {
  step: number;
  nodes: string[];
  channels: ChannelSnapshot[];
  state: Record<string, unknown>;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  system?: string;
  maxToolRounds?: number;
  toolsNative: boolean;
  /** 툴이 온 MCP 서버 이름(있으면). 툴이 외부 서버에서 왔음을 표시한다. */
  mcpServer?: string;
  /** MCP 서버 연결이 실패했다면 그 이유(있으면). */
  mcpError?: string;
  ready: boolean;
  need: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  format: string;
  ready: boolean;
  need: string;
  tools: boolean;
  suggested?: string;
}

export interface ShapeInfo {
  id: string;
  name: string;
  description: string;
  calls: number;
}

export interface ExampleInfo {
  id: string;
  name: string;
  description: string;
  sampleInput: Record<string, unknown>;
  live: boolean;
}

export interface Reply {
  messages: Message[];
  steps: StepUpdate[];
  error?: string;
}

async function getJSON<T>(path: string): Promise<T> {
  return (await fetch(path)).json() as Promise<T>;
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

export const api = {
  agents: () => getJSON<AgentInfo[]>("/api/agents"),
  agentGraph: (id: string) =>
    getJSON<GraphView | { error: string }>(`/api/agents/graph?id=${encodeURIComponent(id)}`),
  agentChat: (id: string, messages: Message[]) =>
    postJSON<Reply>("/api/agents/chat", { id, messages }),

  providers: () => getJSON<ProviderInfo[]>("/api/providers"),
  shapes: () => getJSON<ShapeInfo[]>("/api/shapes"),
  chatGraph: (shape: string) =>
    getJSON<GraphView | { error: string }>(`/api/chat/graph?shape=${encodeURIComponent(shape)}`),
  chat: (body: { spec: string; messages: Message[]; shape: string; system?: string }) =>
    postJSON<Reply>("/api/chat", body),

  examples: () => getJSON<ExampleInfo[]>("/api/examples"),
  exampleGraph: (id: string) =>
    getJSON<GraphView | { error: string }>(`/api/graph?id=${encodeURIComponent(id)}`),
  runExample: (id: string, input: Record<string, unknown>, model?: string) =>
    postJSON<{ steps: StepUpdate[]; error?: string }>("/api/run", { id, input, model }),
};
