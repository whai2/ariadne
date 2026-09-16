import { pendingToolCalls, runWithCheckpoint } from "@ariadne/agent";
import {
  type BaseMessage,
  human,
  type MessagesState,
  type StepUpdate,
  type ToolCall,
} from "@ariadne/core";
import { chooseFact, type InjectionOutcome, judge, type MemoryStore } from "@ariadne/memory";
import { buildAgentGraph, type TurnHooks } from "../domain/graph";
import { statusOf } from "../domain/providers";
import { type AgentDef, agents } from "../domain/registry";
import { NotFoundError } from "../errors";
import type { AgentInfo, AgentReply, AgentService, TurnInput } from "./types";

/**
 * 에이전트 서비스 — **HTTP를 모르는** 유스케이스 셋: 목록 · 그래프 구조 · 한 턴.
 *
 * memory를 아는 마지막 자리다. 아래(`domain/graph`)로는 값(`ScoredFact[]`)과 콜백(`TurnHooks`)만
 * 내려가고, 기록은 콜백을 타고 거슬러 올라온다 — agent 링도 core도 그 일이 벌어지는 걸 모른다.
 */

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

export interface AgentServiceOptions {
  definitions?: AgentDef[];
  buildGraph?: typeof buildAgentGraph;
}

export function createAgentService(
  store: MemoryStore,
  memory?: MemoryStore,
  options: AgentServiceOptions = {},
): AgentService {
  const definitions = options.definitions ?? agents;
  const build = options.buildGraph ?? buildAgentGraph;
  const byId = new Map(definitions.map((a) => [a.id, a]));

  function find(id: string): AgentDef {
    const def = byId.get(id);
    if (def === undefined) throw new NotFoundError("에이전트가 없다");
    return def;
  }

  return {
    list: () => definitions.map((a) => agentInfo(a)),
    graph: (id) => build(find(id), true).getGraph(),
    turn: (id, threadId, input) => runTurn(find(id), threadId, input, store, build, memory),
  };
}

async function runTurn(
  def: AgentDef,
  threadId: string,
  { message, decision }: TurnInput,
  store: MemoryStore,
  build: typeof buildAgentGraph,
  memory?: MemoryStore,
): Promise<AgentReply> {
  const checkpoint = store.getLatest(threadId)?.channels;
  const history = message === undefined ? [] : [human(message)];
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

  // 복원했으면 입력엔 **새것만** 싣는다 — 복원은 대입(리듀서 우회), 입력은 리듀서 통과라
  // 둘이 겹치면 접힌다(누적 채널은 두 배, 이력은 두 벌).
  const restored = Array.isArray(checkpoint?.messages)
    ? (checkpoint.messages as BaseMessage[]).length
    : 0;
  const before = restored + history.length;
  // 첫 턴은 초기 예산에서 이번 턴 비용을 뺀 값을 놓고, 이어지는 턴은 비용만 얹는다.
  const cost = def.budget === undefined ? {} : { budget: restored === 0 ? def.budget - 1 : -1 };
  const input = { messages: history, ...cost } as MessagesState;

  const steps: StepUpdate<MessagesState>[] = [];
  let produced: BaseMessage[] = [];
  let pending: ToolCall[] = [];
  // run이 깨지면 undefined로 남는다 — 그게 "판정 못 했다"의 표현이고, DB에도 응답에도 같은 뜻이다.
  let outcome: InjectionOutcome | undefined;
  try {
    const graph = build(def, false, decision, hooks, fact === undefined ? [] : [fact]);
    const observed: Pick<typeof graph, "stream"> = {
      async *stream(input, opts) {
        const stream = graph.stream(input, opts);
        try {
          let result = await stream.next();
          while (!result.done) {
            // UI의 스텝 관찰은 유지하고 저장·복원은 공용 래퍼에 맡긴다.
            steps.push(JSON.parse(JSON.stringify(result.value)) as StepUpdate<MessagesState>);
            yield result.value;
            result = await stream.next();
          }
          return result.value;
        } finally {
          await stream.return({ messages: [] });
        }
      },
    };
    const state = await runWithCheckpoint(observed, threadId, input, store);
    const final = state.messages;
    produced = final.slice(before);
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
