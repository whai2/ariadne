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
  mcpServer?: string;
  mcpError?: string;
  approval?: string[];
  ready: boolean;
  need: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface Reply {
  messages: Message[];
  steps: StepUpdate[];
  pending?: ToolCall[];
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
  agentChat: (id: string, messages: Message[], decision?: "allow" | "deny") =>
    postJSON<Reply>("/api/agents/chat", { id, messages, decision }),
};
