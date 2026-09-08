// F3.3 · 승인 게이트 — 멈춤과 재개.
//
// 검증 대상은 **불변식 셋**이다.
//   1. `"ask"`면 툴이 **안 돈다**(부수효과 배열이 증언한다) + 답 없는 tool_use가 남는다.
//   2. 재개는 **같은 이력 + 다른 정책**뿐이다 — 새 실행 API도, 채널도, 체크포인터도 없다.
//   3. 게이트가 없는 에이전트는 **한 글자도 안 달라진다**(회귀 안전망).
//
// 모델은 전부 가짜다. 자격증명 0 · 네트워크 0.

import { describe, expect, test } from "bun:test";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  human,
  isToolMessage,
  type MessagesState,
  tool as toolMessage,
} from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import {
  type Approval,
  type ApprovalPolicy,
  ApprovalWithoutToolsError,
  askAlways,
  askFor,
  createAgent,
  pendingToolCalls,
} from "../src/index";

/** 실행되면 흔적이 남는 툴 — "안 돌았다"를 말이 아니라 관찰로 확인하려고. */
function spyTool(name: string) {
  const ran: string[] = [];
  const tool = defineTool({
    name,
    description: `${name} 데모`,
    schema: z.object({ path: z.string() }),
    execute: ({ path }) => {
      ran.push(path);
      return `${name}:${path}`;
    },
  });
  return { tool, ran };
}

/** 툴 결과가 없으면 `calls`를 부르고, 있으면 산문으로 답하는 가짜 모델. */
function fakeModel(calls: AIMessage["toolCalls"]): ChatModel {
  return {
    provider: "fake",
    modelId: "test",
    supportsTools: true,
    async invoke(messages: BaseMessage[]): Promise<AIMessage> {
      return messages.some(isToolMessage) ? ai("done") : ai("", undefined, calls);
    },
  };
}

async function runAgent(
  agent: ReturnType<typeof createAgent>,
  input: MessagesState,
): Promise<{ messages: BaseMessage[]; steps: string[][] }> {
  const steps: string[][] = [];
  let final: MessagesState = input;
  for await (const step of agent.stream(input)) {
    steps.push(step.nodes);
    final = step.state;
  }
  return { messages: final.messages, steps };
}

const CALL = [{ id: "c1", name: "rm", args: { path: "a.txt" } }];

describe("pendingToolCalls — 대기의 정의", () => {
  test("답 없는 호출만 센다", () => {
    const messages: BaseMessage[] = [
      human("지워"),
      ai("", undefined, [
        { id: "c1", name: "rm", args: {} },
        { id: "c2", name: "ls", args: {} },
      ]),
      toolMessage("c2", "ok"),
    ];
    expect(pendingToolCalls(messages).map((c) => c.id)).toEqual(["c1"]);
  });

  test("툴 호출이 없거나 다 답했으면 비어 있다", () => {
    expect(pendingToolCalls([human("안녕"), ai("반갑다")])).toEqual([]);
    expect(pendingToolCalls([ai("", undefined, CALL), toolMessage("c1", "ok")])).toEqual([]);
    expect(pendingToolCalls([])).toEqual([]);
  });

  test("**이전 턴의** 답 없는 호출은 안 센다 — 마지막 AI 메시지만 본다", () => {
    // 이 규칙이 없으면 옛 이력의 흔적 하나가 새 요청을 영영 '대기'로 만든다.
    const messages: BaseMessage[] = [
      ai("", undefined, [{ id: "old", name: "rm", args: {} }]),
      human("다른 얘기"),
      ai("답"),
    ];
    expect(pendingToolCalls(messages)).toEqual([]);
  });
});

describe("승인 게이트 — 멈춤", () => {
  test('"ask"면 툴이 안 돌고, 답 없는 tool_use를 남기고 끝난다', async () => {
    const { tool, ran } = spyTool("rm");
    const agent = createAgent({ model: fakeModel(CALL), tools: [tool], approval: askAlways });
    const { messages, steps } = await runAgent(agent, { messages: [human("지워")] });

    // **툴은 안 돌았다.** 게이트의 존재 이유가 이 한 줄이다.
    expect(ran).toEqual([]);
    // tools 노드는 돌았지만(정책에 물어보느라) 아무것도 안 썼다 → 그 뒤로 model이 없다.
    expect(steps).toEqual([["model"], ["tools"]]);
    expect(messages.filter(isToolMessage)).toEqual([]);
    expect(pendingToolCalls(messages).map((c) => c.name)).toEqual(["rm"]);
  });

  test("멈춤은 새 메시지를 하나도 안 남긴다 — 호출자가 이력만 들고 재개할 수 있게", async () => {
    const { tool } = spyTool("rm");
    const before: BaseMessage[] = [human("지워")];
    const agent = createAgent({ model: fakeModel(CALL), tools: [tool], approval: askAlways });
    const { messages } = await runAgent(agent, { messages: before });
    // model의 툴 호출 한 개만 늘었다(게이트는 침묵).
    expect(messages.length).toBe(before.length + 1);
  });
});

describe("승인 게이트 — 재개", () => {
  test('같은 이력 + "allow" → START가 tools로 들어가 이어 돈다', async () => {
    const { tool, ran } = spyTool("rm");
    const paused = await runAgent(
      createAgent({ model: fakeModel(CALL), tools: [tool], approval: askAlways }),
      { messages: [human("지워")] },
    );
    expect(ran).toEqual([]);

    // **재개에 필요한 건 이력뿐이다.** 새 그래프를 세워도(=프로세스가 죽었다 살아나도) 이어진다.
    const resumed = await runAgent(
      createAgent({ model: fakeModel(CALL), tools: [tool], approval: () => "allow" }),
      { messages: paused.messages },
    );

    // model을 다시 안 부르고 **tools부터** 시작한다 — 답 없는 tool_use를 실은 이력을
    // 모델에게 되보내면 양쪽 와이어 포맷 다 400이라, 이 순서가 정확성 문제다.
    expect(resumed.steps).toEqual([["tools"], ["model"]]);
    expect(ran).toEqual(["a.txt"]);
    expect(pendingToolCalls(resumed.messages)).toEqual([]);
  });

  test('"deny"는 멈춤이 아니다 — 거부 결과를 읽고 모델이 계속 돈다', async () => {
    const { tool, ran } = spyTool("rm");
    const agent = createAgent({ model: fakeModel(CALL), tools: [tool], approval: () => "deny" });
    const { messages, steps } = await runAgent(agent, { messages: [human("지워")] });

    expect(ran).toEqual([]); // 안 돌았다
    expect(steps).toEqual([["model"], ["tools"], ["model"]]); // 그래도 끝까지 갔다
    const results = messages.filter(isToolMessage);
    expect(results.length).toBe(1); // 호출 id 하나당 결과 하나 — 거부도 툴 결과다
    expect(results[0]?.toolCallId).toBe("c1");
    expect(results[0]?.status).toBe("error");
    expect(pendingToolCalls(messages)).toEqual([]);
  });

  test("정책이 비동기여도 된다 — 터미널 앱은 여기서 사람을 기다리고 멈추지 않는다", async () => {
    const { tool, ran } = spyTool("rm");
    const slow: ApprovalPolicy = async (): Promise<Approval> => {
      await Promise.resolve();
      return "allow";
    };
    const agent = createAgent({ model: fakeModel(CALL), tools: [tool], approval: slow });
    const { steps } = await runAgent(agent, { messages: [human("지워")] });
    expect(steps).toEqual([["model"], ["tools"], ["model"]]);
    expect(ran).toEqual(["a.txt"]);
  });
});

describe("askFor — 위험한 것만 세운다", () => {
  test("묶음에 위험한 호출이 하나라도 있으면 묶음 전체가 멈춘다", async () => {
    const rm = spyTool("rm");
    const ls = spyTool("ls");
    const agent = createAgent({
      model: fakeModel([
        { id: "c1", name: "ls", args: { path: "." } },
        { id: "c2", name: "rm", args: { path: "a.txt" } },
      ]),
      tools: [rm.tool, ls.tool],
      approval: askFor(["rm"]),
    });
    const { messages } = await runAgent(agent, { messages: [human("정리해")] });

    // **안전한 쪽도 안 돈다.** 절반만 돌리면 나머지 tool_use가 답 없이 남아 이력이 깨진다.
    expect(ls.ran).toEqual([]);
    expect(rm.ran).toEqual([]);
    expect(pendingToolCalls(messages).map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  test("위험한 이름이 없으면 그냥 돈다", async () => {
    const ls = spyTool("ls");
    const agent = createAgent({
      model: fakeModel([{ id: "c1", name: "ls", args: { path: "." } }]),
      tools: [ls.tool],
      approval: askFor(["rm"]),
    });
    const { steps } = await runAgent(agent, { messages: [human("목록")] });
    expect(steps).toEqual([["model"], ["tools"], ["model"]]);
    expect(ls.ran).toEqual(["."]);
  });
});

describe("구성 시점 검사", () => {
  test("툴 없이 승인 정책만 주면 만들 때 던진다", () => {
    // 그대로 두면 정책이 영영 안 불리는데, 승인 게이트에서 조용한 무효화는 가장 나쁜 실패다.
    expect(() => createAgent({ model: fakeModel(CALL), approval: askAlways })).toThrow(
      ApprovalWithoutToolsError,
    );
  });

  test("게이트가 없으면 그래프 모양이 F3.1 그대로다 (회귀)", () => {
    const { tool } = spyTool("rm");
    const plain = createAgent({ model: fakeModel(CALL), tools: [tool] }).getGraph();
    // 정적 엣지 START→model 과 tools→model 이 그대로 있다(게이트가 붙으면 둘 다 조건부가 된다).
    expect(plain.edges).toContainEqual({ from: "__start__", to: "model", kind: "static" });
    expect(plain.edges).toContainEqual({ from: "tools", to: "model", kind: "static" });
  });

  test("게이트가 붙으면 그 두 엣지가 조건부로 바뀐다 — 노드는 그대로 둘", () => {
    const { tool } = spyTool("rm");
    const gated = createAgent({
      model: fakeModel(CALL),
      tools: [tool],
      approval: askAlways,
    }).getGraph();

    expect(gated.nodes.sort()).toEqual(["model", "tools"]);
    expect(gated.edges).toContainEqual({ from: "__start__", to: "tools", kind: "conditional" });
    expect(gated.edges).toContainEqual({ from: "tools", to: "__end__", kind: "conditional" });
    // 정적 엣지는 하나도 없다 — 멈추려면 취소 가능한 제어흐름이어야 하기 때문.
    expect(gated.edges.filter((e) => e.kind === "static")).toEqual([]);
  });
});
