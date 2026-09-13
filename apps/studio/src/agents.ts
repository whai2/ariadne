import {
  type Approval,
  type ApprovalPolicy,
  askFor,
  createAgent,
  pendingToolCalls,
} from "@ariadne/agent";
import type {
  BaseMessage,
  ChannelCheckpoint,
  CompiledGraph,
  MessagesState,
  StateSchema,
  StepUpdate,
  ToolCall,
} from "@ariadne/core";
import { messagesSchema } from "@ariadne/core";
import { connectStdio, type McpClient, mcpTools, type StdioServerConfig } from "@ariadne/mcp";
import {
  chooseFact,
  type InjectionOutcome,
  judge,
  type MemoryStore,
  type ScoredFact,
} from "@ariadne/memory";
import { type ChatModel, model } from "@ariadne/model";
import type { AnyTool } from "@ariadne/tools";
import { statusOf } from "./providers";

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: AnyTool[];
  system?: string;
  maxToolRounds?: number;
  mcp?: StdioServerConfig;
  mcpServerName?: string;
  mcpError?: string;
  approval?: string[];
  /**
   * 대화 말고 **채널을 하나 더** 두는 데모 (F5.2). 매 턴 1씩 쓴다.
   *
   * 숫자만 적는다 — 리듀서를 만드는 건 `buildAgentGraph`다(`approval`이 문자열 배열이고
   * `askFor`가 부팅 코드에 있는 것, `mcp`가 선언이고 연결이 `connectMcpAgents`인 것과 같은 모양).
   */
  budget?: number;
}

export const agents: AgentDef[] = [
  {
    id: "mcp",
    name: "MCP 에이전트 (데모 서버)",
    description:
      "툴이 로컬이 아니라 외부 MCP 서버에서 온다. 스튜디오가 시작할 때 우리 데모 서버(자식 프로세스, JSON-RPC)에 붙어 get_weather·word_count·write_note를 끌어왔다. 값은 결정론적 가짜라 오프라인·키 없이 돈다. 쓰기(write_note)만 승인 게이트가 잡는다 — 그 거부가 기억의 재료가 된다.",
    model: "claude-code/sonnet",
    tools: [],
    mcp: { command: process.execPath, args: [`${import.meta.dir}/mcp-demo-server.ts`] },
    system: "너는 비서다. 날씨·단어 수·메모 저장이 필요하면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 3,
    approval: ["write_note"],
    budget: 5,
  },
  {
    id: "filesystem",
    name: "파일시스템 에이전트 (진짜 기성 MCP)",
    description:
      "남이 만든 진짜 서버 `@modelcontextprotocol/server-filesystem`(공식 레퍼런스)에 npx로 붙는다. 파일을 바꾸는 툴은 승인 게이트가 잡고, 승인 전에는 디스크에 아무 일도 안 일어난다. 범위는 `apps/studio/mcp-sample/` 폴더로 좁혀둔다. 첫 실행은 npx가 서버를 내려받아 몇 초 걸리고 네트워크가 필요하다.",
    model: "claude-code/sonnet",
    tools: [],
    mcp: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", `${import.meta.dir}/../mcp-sample`],
    },
    system: "너는 파일 비서다. 파일을 읽거나 쓰려면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 4,
    approval: ["write_file", "edit_file", "create_directory", "move_file"],
  },
];

export async function connectMcpAgents(): Promise<() => Promise<void>> {
  const clients: McpClient[] = [];
  for (const def of agents) {
    if (def.mcp === undefined) continue;
    try {
      const client = await connectStdio(def.mcp);
      clients.push(client);
      def.tools.push(...(await mcpTools(client)));
      def.mcpServerName = client.serverInfo.name;
    } catch (e) {
      def.mcpError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn(`[mcp] '${def.id}' 붙기 실패 — 이 에이전트는 툴 없이 뜬다.\n${def.mcpError}`);
    }
  }
  return async () => {
    for (const client of clients) await client.close();
  };
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

export function agentInfo(
  def: AgentDef,
  env: Record<string, string | undefined> = process.env,
): AgentInfo {
  const provider = def.model.split("/")[0] ?? def.model;
  const status = statusOf(provider, env);
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    model: def.model,
    tools: def.tools.map((t) => t.name),
    ...(def.system === undefined ? {} : { system: def.system }),
    ...(def.maxToolRounds === undefined ? {} : { maxToolRounds: def.maxToolRounds }),
    toolsNative: status?.tools ?? true,
    ...(def.mcpServerName === undefined ? {} : { mcpServer: def.mcpServerName }),
    ...(def.mcpError === undefined ? {} : { mcpError: def.mcpError }),
    ...(def.approval === undefined
      ? {}
      : { approval: def.approval.filter((n) => def.tools.some((t) => t.name === n)) }),
    ...(def.budget === undefined ? {} : { budget: def.budget }),
    ready: status?.ready ?? false,
    need: status?.need ?? "알 수 없는 프로바이더",
  };
}

const previewModel: ChatModel = {
  provider: "preview",
  modelId: "preview",
  supportsTools: true,
  async invoke() {
    return { role: "ai", content: "(미리보기)" };
  },
};

export interface TurnHooks {
  onDecision?(kind: "allow" | "deny", targets: readonly string[]): void;
}

export function approvalPolicy(
  names: string[],
  decision?: Approval,
  hooks?: TurnHooks,
): ApprovalPolicy {
  const gate = askFor(names);
  const risky = new Set(names);
  let once = decision;
  return async (calls) => {
    const targets = calls.map((c) => c.name).filter((n) => risky.has(n));
    const verdict = once ?? (await gate(calls));
    once = undefined;
    if (verdict !== "ask") hooks?.onDecision?.(verdict, targets);
    return verdict;
  };
}

export function composeSystem(
  base: string | undefined,
  facts: readonly ScoredFact[],
): string | undefined {
  if (facts.length === 0) return base;
  const block = ["[기억한 것]", ...facts.map((f) => `- ${f.text}`)].join("\n");
  return [base, block].filter((x): x is string => x !== undefined && x !== "").join("\n\n");
}

/** 대화 말고도 채널이 있는 에이전트의 상태 (F5.2). */
export interface BudgetState extends MessagesState {
  budget: number;
}

export function buildAgentGraph(
  def: AgentDef,
  preview = false,
  decision?: Approval,
  hooks?: TurnHooks,
  facts: readonly ScoredFact[] = [],
): CompiledGraph<MessagesState> {
  const chatModel = preview
    ? previewModel
    : model(def.model, { promptedTools: def.tools.length > 0 });
  const gated = def.tools.length > 0 && (def.approval?.length ?? 0) > 0;
  // 선언(숫자)을 여기서 살아있는 것(리듀서)으로 바꾼다. 합계 리듀서라 입력이 **델타**가 된다.
  const schema: StateSchema<BudgetState> | undefined =
    def.budget === undefined
      ? undefined
      : { ...messagesSchema, budget: { reducer: (a, b) => a + b } };
  return createAgent({
    model: chatModel,
    tools: def.tools,
    ...(schema === undefined ? {} : { schema: schema as StateSchema<MessagesState> }),
    ...(() => {
      const system = composeSystem(def.system, facts);
      return system === undefined ? {} : { system };
    })(),
    ...(def.maxToolRounds === undefined ? {} : { maxToolRounds: def.maxToolRounds }),
    ...(gated ? { approval: approvalPolicy(def.approval ?? [], decision, hooks) } : {}),
  });
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

export interface AgentReply {
  messages: BaseMessage[];
  steps: StepUpdate<MessagesState>[];
  pending: ToolCall[];
  /** 사실이 없으면 **키 자체가 없다**(F2.1의 규칙 — 비면 안 싣는다). */
  injected?: Injected;
  /**
   * 이 턴이 끝난 자리의 실행 상태 (F5.2).
   *
   * **무상태 규약은 안 깨진다** — 클라이언트가 쥐는 것이 *이력*에서 *체크포인트*로 바뀔 뿐이다.
   * (S12의 `pending`·S13의 `injected`와 같은 모양: 안쪽에선 상태, 경계 밖에선 필드.)
   */
  checkpoint?: ChannelCheckpoint;
}

export async function agentTurn(
  def: AgentDef,
  history: BaseMessage[],
  decision?: Approval,
  memory?: MemoryStore,
  checkpoint?: ChannelCheckpoint,
): Promise<AgentReply> {
  memory?.consolidate(def.id);
  const fact = chooseFact(memory?.scoredFacts(def.id) ?? []);

  const episode = memory?.beginEpisode(def.id, history);
  const injection =
    memory !== undefined && episode !== undefined && fact !== undefined
      ? memory.beginInjection(fact.id, episode)
      : undefined;
  const hooks: TurnHooks | undefined =
    memory === undefined || episode === undefined
      ? undefined
      : { onDecision: (kind, targets) => memory.recordValueEvent(episode, def.id, kind, targets) };

  const graph = buildAgentGraph(def, false, decision, hooks, fact === undefined ? [] : [fact]);

  // 복원했으면 입력엔 **새것만** 싣는다 — 복원은 대입(리듀서 우회), 입력은 리듀서 통과라
  // 둘이 겹치면 접힌다(누적 채널은 두 배, 이력은 두 벌).
  const restored = Array.isArray(checkpoint?.messages)
    ? (checkpoint.messages as BaseMessage[]).length
    : 0;
  const before = restored + history.length;
  // 첫 턴은 초기 예산에서 이번 턴 비용을 뺀 값을 놓고, 이어지는 턴은 비용만 얹는다.
  const cost = def.budget === undefined ? {} : { budget: restored === 0 ? def.budget - 1 : -1 };
  const input = { messages: history, ...cost } as MessagesState;
  const opts = checkpoint === undefined ? undefined : { checkpoint };

  const steps: StepUpdate<MessagesState>[] = [];
  let produced: BaseMessage[] = [];
  let pending: ToolCall[] = [];
  // run이 깨지면 undefined로 남는다 — 그게 "판정 못 했다"의 표현이고, DB에도 응답에도 같은 뜻이다.
  // (예전엔 `finished` 플래그로 갈랐는데, 판정을 성공 경로에서 미리 내니 그 플래그가 필요 없어졌다.)
  let outcome: InjectionOutcome | undefined;
  try {
    for await (const step of graph.stream(input, opts)) {
      steps.push(step);
    }
    const last = steps.at(-1);
    const final = last?.state.messages ?? history;
    produced = final.slice(before);
    pending = pendingToolCalls(final);
    if (fact !== undefined) outcome = judge(fact.target, produced, pending);
    return {
      messages: produced,
      steps,
      pending,
      ...(fact === undefined ? {} : { injected: { fact, outcome: outcome ?? null } }),
      ...(last === undefined ? {} : { checkpoint: last.checkpoint }),
    };
  } finally {
    if (memory !== undefined && episode !== undefined) {
      memory.endEpisode(episode, produced, pending.length > 0 ? "paused" : "completed");
    }
    if (memory !== undefined && injection !== undefined) {
      memory.endInjection(injection, outcome);
    }
  }
}
