// F5.1 · HITL을 반증한다 — 이력이 쥔 것과 놓친 것.
//
// F3.3은 체크포인터 없이 승인 게이트를 만들었고, 근거는 "이 에이전트의 유일한 상태가
// 대화 이력"이었다. 그 주장의 **확인되지 않은 두 곳**을 여기서 실측한다.
//
//   1. `approval.test.ts`의 주석이 괄호로 주장한 "(=프로세스가 죽었다 살아나도)" —
//      한 프로세스 안 테스트는 메모리를 공유해서 이걸 증명할 수 없다. → 자식 프로세스로.
//   2. "유일한 상태가 대화 이력"은 `createAgent`의 **기본값일 뿐**이다.
//      `AgentConfig.schema`가 이미 열려 있어 채널이 하나만 늘어도 전제가 깨진다.
//
// 이 파일은 **아무것도 고치지 않는다.** 현재 동작을 그대로 못 박아, F5.2(채널 serde)가
// 무엇을 뒤집어야 하는지 남긴다. 모델은 전부 가짜다. 자격증명 0 · 네트워크 0.

import { describe, expect, test } from "bun:test";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  END,
  human,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type StateSchema,
} from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { type Approval, askAlways, createAgent, pendingToolCalls } from "../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// 1. 프로세스를 죽였다 살린다
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE = `${import.meta.dir}/fixtures/turn.ts`;

interface TurnResult {
  messages: BaseMessage[];
  steps: string[][];
  pending: { name: string }[];
  ran: string[];
}

/**
 * 턴 하나를 **별도 프로세스**에서 돌린다.
 *
 * `process.execPath`를 쓰는 건 PATH에 기대지 않으려고 — mcp의 stdio 픽스처와 같은 이유다.
 * 넘기는 건 JSON 문자열 하나뿐이고, 돌아오는 것도 JSON 하나다. 프로세스가 끝나면
 * 그 안의 메모리는 전부 사라진다.
 */
async function turn(input: { history: BaseMessage[]; decision?: Approval }): Promise<TurnResult> {
  const proc = Bun.spawn({
    cmd: [process.execPath, FIXTURE, JSON.stringify(input)],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`turn.ts가 ${code}로 죽었다: ${err}`);
  }
  return JSON.parse(out) as TurnResult;
}

describe("재개 — 프로세스가 죽어도 이력만으로 이어진다", () => {
  test("멈춤과 재개 사이에 오가는 건 JSON 하나뿐이다", async () => {
    // 턴 1 — 이 프로세스는 멈춘 채로 죽는다.
    const paused = await turn({ history: [human("지워")] });

    expect(paused.ran).toEqual([]); // 툴이 안 돌았다 — 그 프로세스가 직접 증언한다
    expect(paused.steps).toEqual([["model"], ["tools"]]);
    expect(paused.pending.map((c) => c.name)).toEqual(["rm"]);
    expect(paused.messages.filter(isToolMessage)).toEqual([]);

    // 턴 2 — **완전히 새 프로세스.** 아는 건 위에서 받은 이력 JSON뿐이다.
    const resumed = await turn({ history: paused.messages, decision: "allow" });

    // model로 먼저 안 들어간다. 답 없는 tool_use를 실은 이력을 모델에게 되보내면
    // 양쪽 프로바이더 포맷 다 400이라, 이 순서는 취향이 아니라 정확성 문제다.
    expect(resumed.steps).toEqual([["tools"], ["model"]]);
    expect(resumed.ran).toEqual(["a.txt"]);
    expect(resumed.pending).toEqual([]);

    // 두 턴을 합쳐 툴 결과가 **정확히 하나** — 툴이 두 번 돌지 않았다.
    expect(resumed.messages.filter(isToolMessage)).toHaveLength(1);
  });

  test("거부 재개도 tools부터 들어간다", async () => {
    const paused = await turn({ history: [human("지워")] });
    const resumed = await turn({ history: paused.messages, decision: "deny" });

    expect(resumed.steps).toEqual([["tools"], ["model"]]);
    expect(resumed.ran).toEqual([]); // 거부는 툴을 안 돌린다
    expect(resumed.messages.filter(isToolMessage)).toHaveLength(1); // 거부도 툴 결과다
    expect(resumed.pending).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 반례 — 대화 말고 다른 상태는 run 경계에서 사라진다
// ─────────────────────────────────────────────────────────────────────────────

/** 대화 이력 **말고도** 상태가 있는 에이전트. `AgentConfig.schema`가 이미 열어둔 길이다. */
interface Stateful extends MessagesState {
  plan: string;
  budget: number;
}

const statefulSchema: StateSchema<Stateful> = {
  ...messagesSchema,
  plan: {}, // 리듀서 없음 → LastValue
  budget: { reducer: (a, b) => a + b }, // 누적 채널
};

function spyTool() {
  const ran: string[] = [];
  const tool = defineTool({
    name: "rm",
    description: "rm 데모",
    schema: z.object({ path: z.string() }),
    execute: ({ path }) => {
      ran.push(path);
      return `rm:${path}`;
    },
  });
  return { tool, ran };
}

const CALL = [{ id: "c1", name: "rm", args: { path: "a.txt" } }];

function fakeModel(): ChatModel {
  return {
    provider: "fake",
    modelId: "test",
    supportsTools: true,
    async invoke(messages: BaseMessage[]): Promise<AIMessage> {
      return messages.some(isToolMessage) ? ai("done") : ai("", undefined, CALL);
    },
  };
}

function statefulAgent(decision?: Approval) {
  const { tool, ran } = spyTool();
  const agent = createAgent<Stateful>({
    model: fakeModel(),
    tools: [tool],
    approval: decision === undefined ? askAlways : () => decision,
    schema: statefulSchema,
  });
  return { agent, ran };
}

async function runStateful(
  agent: ReturnType<typeof statefulAgent>["agent"],
  input: Stateful,
): Promise<{ final: Partial<Stateful>; steps: string[][] }> {
  const steps: string[][] = [];
  let final: Partial<Stateful> = input;
  for await (const step of agent.stream(input)) {
    steps.push(step.nodes);
    final = step.state;
  }
  return { final, steps };
}

describe("반례 — 상태가 대화 이력뿐이 아닐 때", () => {
  test("승인 왕복은 멀쩡히 도는데 다른 채널은 키째 사라진다", async () => {
    // 턴 1 — 세 채널을 전부 싣는다.
    const first = statefulAgent();
    const paused = await runStateful(first.agent, {
      messages: [human("지워")],
      plan: "notes.md를 지운다",
      budget: 5,
    });

    expect(paused.final.plan).toBe("notes.md를 지운다");
    expect(paused.final.budget).toBe(5);
    expect(pendingToolCalls(paused.final.messages ?? [])).toHaveLength(1);

    // 턴 2 — **실제 재개 경로가 하는 그대로.** 스튜디오의 `agentTurn`은
    // `graph.stream({ messages: history })`로 대화 이력만 되돌려준다. 타입은
    // 전체 상태를 요구하지만 실제 경로는 `MessagesState`로 타이핑돼 있어 이 구멍이 안 보인다.
    const second = statefulAgent("allow");
    const resumed = await runStateful(second.agent, {
      messages: paused.final.messages,
    } as Stateful);

    // 게이트는 완벽히 작동한다 — 이어 돌고, 툴이 한 번 돌고, 대기가 없다.
    expect(resumed.steps).toEqual([["tools"], ["model"]]);
    expect(second.ran).toEqual(["a.txt"]);
    expect(pendingToolCalls(resumed.final.messages ?? [])).toEqual([]);

    // **그런데 상태만 사라졌다.** `undefined`가 들어간 게 아니라 키 자체가 없다 —
    // `readChannels`가 값 없는 채널을 아예 안 담기 때문이다. 아무도 안 알려준다.
    expect("plan" in resumed.final).toBe(false);
    expect("budget" in resumed.final).toBe(false);
  });

  test("전부 다시 실으면 살아남는다 — 지금의 숨은 계약", async () => {
    const first = statefulAgent();
    const paused = await runStateful(first.agent, {
      messages: [human("지워")],
      plan: "notes.md를 지운다",
      budget: 5,
    });

    // 클라이언트가 **모든 채널을 손으로 이월**하면 정확하다. 대화 이력만 그 의무를
    // 면제받은 건 id 덕분이 아니라 늘 전부 다시 싣기 때문이다.
    const second = statefulAgent("allow");
    const resumed = await runStateful(second.agent, {
      messages: paused.final.messages as BaseMessage[],
      plan: paused.final.plan as string,
      budget: paused.final.budget as number,
    });

    expect(resumed.final.plan).toBe("notes.md를 지운다");
    expect(resumed.final.budget).toBe(5); // 두 배가 아니다 — 빈 채널이라 seed된다
  });

  test("대화 이력이 안 늘어나는 건 id 교체가 아니라 seed 덕이다", async () => {
    const first = statefulAgent();
    const paused = await runStateful(first.agent, {
      messages: [human("지워")],
      plan: "p",
      budget: 5,
    });

    // 가짜 모델의 `ai("", undefined, CALL)`은 id를 안 단다 — 이력에 id가 하나도 없다.
    const history = paused.final.messages ?? [];
    expect(history.every((m) => m.id === undefined)).toBe(true);

    // 그런데도 재개 후 이력이 중복되지 않는다. `addMessages`의 id 교체가 일한 게 아니라,
    // 채널이 새로 만들어져 입력이 **그대로 놓였을** 뿐이다.
    const second = statefulAgent("allow");
    const resumed = await runStateful(second.agent, { messages: history } as Stateful);
    const after = resumed.final.messages ?? [];

    expect(after.slice(0, history.length)).toEqual(history);
    expect(after.length).toBe(history.length + 2); // 툴 결과 + 모델 답
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. F5.2가 리듀서를 우회해야 하는 이유
// ─────────────────────────────────────────────────────────────────────────────

describe("누적 채널 — 비면 seed, 차면 접는다", () => {
  test("값이 한 번 생기면 리듀서가 돈다", async () => {
    const g = new StateGraph<{ budget: number }>({ budget: { reducer: (a, b) => a + b } });
    g.addNode("a", () => ({ budget: 1 }));
    g.addNode("b", () => ({ budget: 1 }));
    g.addEdge(START, "a");
    g.addEdge("a", "b");
    g.addEdge("b", END);
    const graph = g.compile();

    // 5는 빈 채널에 **그냥 놓이고**(리듀서 안 탐), 그 뒤 두 번의 쓰기만 접힌다.
    expect((await graph.invoke({ budget: 5 })).budget).toBe(7);

    // 같은 컴파일 그래프를 다시 돌려도 7이다 — `stream()`마다 채널이 새로 만들어지므로
    // run 사이에 값이 이월되지 않는다. **이게 지금 증발이 일어나는 메커니즘이다.**
    expect((await graph.invoke({ budget: 5 })).budget).toBe(7);
  });
});
