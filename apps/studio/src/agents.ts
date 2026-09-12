import {
  type Approval,
  type ApprovalPolicy,
  askFor,
  createAgent,
  pendingToolCalls,
} from "@ariadne/agent";
import type {
  BaseMessage,
  CompiledGraph,
  MessagesState,
  StepUpdate,
  ToolCall,
} from "@ariadne/core";
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
  return createAgent({
    model: chatModel,
    tools: def.tools,
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
}

export async function agentTurn(
  def: AgentDef,
  history: BaseMessage[],
  decision?: Approval,
  memory?: MemoryStore,
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
  const steps: StepUpdate<MessagesState>[] = [];
  let produced: BaseMessage[] = [];
  let pending: ToolCall[] = [];
  // run이 깨지면 undefined로 남는다 — 그게 "판정 못 했다"의 표현이고, DB에도 응답에도 같은 뜻이다.
  // (예전엔 `finished` 플래그로 갈랐는데, 판정을 성공 경로에서 미리 내니 그 플래그가 필요 없어졌다.)
  let outcome: InjectionOutcome | undefined;
  try {
    for await (const step of graph.stream({ messages: history })) {
      steps.push(step);
    }
    const final = steps.at(-1)?.state.messages ?? history;
    produced = final.slice(history.length);
    pending = pendingToolCalls(final);
    if (fact !== undefined) outcome = judge(fact.target, produced, pending);
    return {
      messages: produced,
      steps,
      pending,
      ...(fact === undefined ? {} : { injected: { fact, outcome: outcome ?? null } }),
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
