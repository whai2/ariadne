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
  /** 대화 말고 채널이 하나 더 있는 에이전트의 초기 예산 (F5.2). */
  budget?: number;
  ready: boolean;
  need: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** `@ariadne/memory`의 `ScoredFact` — 경계 밖이라 여기 다시 적는다(파일 첫 줄의 규약). */
export interface ScoredFact {
  id: number;
  agent: string;
  text: string;
  target: string;
  level: "episodic" | "preference" | "rule";
  /** 왜 이 사실이 생겼나. 예: `"deny 2 / allow 0"`. */
  origin: string;
  created_at: number;
  /** 판정이 끝난 주입 횟수. `neutral`도 시행으로 센다. */
  trials: number;
  /** `reinforce` +1 · `decay` -1 · `neutral` 0의 합. */
  strength: number;
}

export type InjectionOutcome = "reinforce" | "decay" | "neutral";

export interface EpisodeRow {
  id: number;
  agent: string;
  started_at: number;
  ended_at: number | null;
  input_count: number;
  messages: string;
  status: "running" | "completed" | "paused";
}

export interface ValueEventRow {
  id: number;
  episode_id: number;
  agent: string;
  kind: "allow" | "deny";
  target: string;
  at: number;
}

export interface MemoryView {
  episodes: EpisodeRow[];
  events: ValueEventRow[];
  facts: ScoredFact[];
}

/** 이번 턴에 시험한 기억 하나. 사실이 없으면 **키 자체가 없다.** */
export interface Injected {
  fact: ScoredFact;
  outcome: InjectionOutcome | null;
}

/** `@ariadne/core`의 `ChannelCheckpoint` — 경계 밖이라 여기 다시 적는다(파일 첫 줄의 규약). */
export type Checkpoint = Record<string, unknown>;

export interface Reply {
  messages: Message[];
  steps: StepUpdate[];
  pending?: ToolCall[];
  injected?: Injected;
  /** 이 턴이 끝난 자리의 실행 상태. 다음 턴에 그대로 되돌려주면 이어진다. */
  checkpoint?: Checkpoint;
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
  agentChat: (
    id: string,
    messages: Message[],
    decision?: "allow" | "deny",
    checkpoint?: Checkpoint,
  ) => postJSON<Reply>("/api/agents/chat", { id, messages, decision, checkpoint }),
  memory: (agent: string) => getJSON<MemoryView>(`/api/memory?agent=${encodeURIComponent(agent)}`),
};
