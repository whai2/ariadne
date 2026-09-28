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

export type SpanKind = "run" | "superstep" | "node" | "model" | "tool";
export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  kind: SpanKind;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "ok" | "error";
  attributes: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  error?: { name: string; message: string };
}
export interface TraceRecord {
  traceId: string;
  threadId?: string;
  startedAt: number;
  endedAt: number;
  status: "ok" | "error";
  spans: Span[];
}

export interface EvalSuiteCase {
  id: string;
  prompt: string;
  tools: string[];
  expectedTools: string[];
}

export interface EvalSuite {
  name: string;
  version: string;
  model: string;
  cases: EvalSuiteCase[];
}

export interface EvalRecord {
  caseId: string;
  trial: number;
  startedAt: number;
  endedAt: number;
  messages: Message[];
  spans: Span[];
  error?: { name: string; message: string };
}

export interface EvalReport {
  caseCount: number;
  trialCount: number;
  completed: number;
  failed: number;
  records: EvalRecord[];
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
  pending?: ToolCall[];
  injected?: Injected;
  thread: ThreadView;
  error?: string;
}

export interface ThreadView {
  id: string;
  agentId: string;
  createdAt: number;
  messages: Message[];
  pending: ToolCall[];
  state: Checkpoint;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function responseJSON<T>(res: Response): Promise<T> {
  const value = await res.json();
  if (!res.ok) throw new ApiError(value.error ?? `요청 실패 (${res.status})`, res.status);
  return value as T;
}
async function getJSON<T>(path: string): Promise<T> {
  return responseJSON<T>(await fetch(path));
}
async function postJSON<T>(path: string, body: unknown): Promise<T> {
  return responseJSON<T>(
    await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export const api = {
  agents: () => getJSON<AgentInfo[]>("/api/agents"),
  agentGraph: (id: string) =>
    getJSON<GraphView | { error: string }>(`/api/agents/graph?id=${encodeURIComponent(id)}`),
  createThread: (agentId: string) => postJSON<ThreadView>("/api/threads", { agentId }),
  thread: (id: string) => getJSON<ThreadView>(`/api/threads/${encodeURIComponent(id)}`),
  traces: (id: string) => getJSON<TraceRecord[]>(`/api/threads/${encodeURIComponent(id)}/traces`),
  send: (id: string, input: { message: string } | { decision: "allow" | "deny" }) =>
    postJSON<Reply>(`/api/threads/${encodeURIComponent(id)}/messages`, input),
  memory: (agent: string) => getJSON<MemoryView>(`/api/memory?agent=${encodeURIComponent(agent)}`),
  evalSuite: () => getJSON<EvalSuite>("/api/evals/bfcl"),
  runEvals: () => postJSON<EvalReport>("/api/evals/bfcl/runs", {}),
};

// 브라우저에는 화면 선택에 필요한 ID만 남긴다. 상태와 이력은 서버에서 읽는다.
export function readSelection(key: string): string | null {
  try {
    return localStorage.getItem(`ariadne:v1:${key}`);
  } catch {
    return null;
  }
}
export function saveSelection(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(`ariadne:v1:${key}`);
    else localStorage.setItem(`ariadne:v1:${key}`, value);
  } catch {
    /* 저장소가 막혀도 현재 탭에서 대화할 수 있다. */
  }
}
