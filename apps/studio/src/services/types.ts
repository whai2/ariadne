import type {
  BaseMessage,
  ChannelCheckpoint,
  GraphView,
  MessagesState,
  StepUpdate,
  ToolCall,
} from "@ariadne/core";
import type { InjectionOutcome, MemoryStore, ScoredFact } from "@ariadne/memory";

/**
 * 서비스 계층의 **계약**. 구현(`agents.ts` · `memory.ts`)과 갈라 둔다 —
 * 컨트롤러는 이 파일만 알고, 누가 어떻게 구현했는지는 `studio.ts`의 조립만 안다.
 */

// ── 에이전트 ─────────────────────────────────────────────

export interface AgentService {
  list(): AgentInfo[];
  graph(id: string): GraphView;
  turn(id: string, threadId: string, input: TurnInput): Promise<AgentReply>;
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
  budget?: number;
  ready: boolean;
  need: string;
}

/** 한 턴의 입력. 위치 인자 대신 이름으로 — 필드가 늘어도 호출부가 `undefined`로 자리를 안 채운다. */
export type TurnInput =
  | { message: string; decision?: never }
  | { decision: "allow" | "deny"; message?: never };

export interface ThreadView {
  id: string;
  agentId: string;
  createdAt: number;
  messages: BaseMessage[];
  pending: ToolCall[];
  state: ChannelCheckpoint;
}

export interface ThreadService {
  create(agentId: string): ThreadView;
  get(id: string): ThreadView;
  send(id: string, input: TurnInput): Promise<AgentReply & { thread: ThreadView }>;
}

export interface AgentReply {
  messages: BaseMessage[];
  steps: StepUpdate<MessagesState>[];
  pending: ToolCall[];
  injected?: Injected;
}

/**
 * 이번 턴에 시험한 기억 하나 (S13).
 *
 * **이게 없으면 주입은 관찰이 안 된다.** 사실은 `system`에 접혀 들어가 모델만 보고,
 * `/api/memory`는 "쌓인 것"을 보여줄 뿐 *이번 턴에 어느 것을 썼는지*는 말하지 않는다.
 * 그 사실은 `injections` 행에만 남는데 그걸 에피소드로 되짚는 조회가 없다 —
 * 그래서 **응답에 싣는다**(S12의 `pending`과 같은 모양: 안쪽에선 상태, 경계 밖에선 필드).
 */
export interface Injected {
  fact: ScoredFact;
  /** 이 턴의 판정. run이 깨져 판정 못 했으면 `null`. */
  outcome: InjectionOutcome | null;
}

// ── 메모리 ───────────────────────────────────────────────

export interface MemoryService {
  view(agent?: string): MemoryView;
}

export interface MemoryView {
  episodes: ReturnType<MemoryStore["episodes"]>;
  events: ReturnType<MemoryStore["valueEvents"]>;
  facts: ReturnType<MemoryStore["scoredFacts"]>;
}
