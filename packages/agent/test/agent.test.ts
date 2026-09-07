// F3.1 · 에이전트 링 — createAgent가 접은 ReAct 루프.
//
// 검증 대상은 **루프의 성질**이다(모델의 똑똑함이 아니라). 그래서 모델은 전부 가짜다 —
// messages만 보고 결정론적으로 답하는 `ChatModel`을 꽂는다. 자격증명 0 · 네트워크 0.

import { describe, expect, test } from "bun:test";
import {
  type AIMessage,
  ai,
  type BaseMessage,
  human,
  isAIMessage,
  isToolMessage,
  type MessagesState,
  tool as toolMessage,
} from "@ariadne/core";
import type { ChatModel, ChatOptions } from "@ariadne/model";
import { add, multiply } from "@ariadne/tools";
import { createAgent, ModelCannotUseToolsError } from "../src/index";

/**
 * 각 `invoke`가 받은 옵션을 기록하는 가짜 모델을 만든다. `reply`는 messages와 **이번 호출의
 * 옵션**(툴이 실렸는지 등)을 보고 다음 AI 메시지를 정한다 — 상태를 안 들고 결정론적으로.
 */
function fakeModel(
  reply: (messages: BaseMessage[], options: ChatOptions) => AIMessage,
  opts: { supportsTools?: boolean } = {},
): { model: ChatModel; calls: ChatOptions[] } {
  const calls: ChatOptions[] = [];
  const model: ChatModel = {
    provider: "fake",
    modelId: "test",
    supportsTools: opts.supportsTools ?? true,
    async invoke(messages: BaseMessage[], options: ChatOptions = {}): Promise<AIMessage> {
      calls.push(options);
      return reply(messages, options);
    },
  };
  return { model, calls };
}

/** messages를 끝까지 흘려 최종 상태만. */
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

describe("createAgent — 툴 루프", () => {
  test("한 턴에 툴 둘 → 병렬 실행 → 모델이 정리하고 끝난다", async () => {
    // 툴 결과가 없으면 add·multiply 둘을 부르고, 있으면 산문으로 답한다.
    const { model } = fakeModel((messages) =>
      messages.some(isToolMessage)
        ? ai("done")
        : ai("", undefined, [
            { id: "c1", name: "add", args: { a: 3, b: 4 } },
            { id: "c2", name: "multiply", args: { a: 5, b: 6 } },
          ]),
    );
    const agent = createAgent({ model, tools: [add, multiply] });
    const { messages, steps } = await runAgent(agent, { messages: [human("계산")] });

    // 스텝: model → tools → model
    expect(steps).toEqual([["model"], ["tools"], ["model"]]);

    // 툴 메시지 둘, 호출 id와 짝이 맞는다.
    const toolMsgs = messages.filter(isToolMessage);
    expect(toolMsgs.map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
    expect(toolMsgs.map((m) => m.content)).toEqual(["7", "30"]);

    // 이력이 답 없는 tool_use 없이 끝난다 — 마지막은 산문 AI.
    const last = messages.at(-1);
    expect(last?.role).toBe("ai");
    expect(last?.content).toBe("done");
    expect(isAIMessage(last as BaseMessage) && (last as AIMessage).toolCalls).toBeUndefined();
  });

  test("스키마 위반 인자 → 에러 메시지 → 다음 턴에 자가 수정 (에러 정책이 루프로 흐른다)", async () => {
    const { model } = fakeModel((messages) => {
      const last = messages.filter(isToolMessage).at(-1);
      if (last === undefined)
        return ai("", undefined, [{ id: "c1", name: "add", args: { a: "셋", b: 4 } }]);
      if (last.status === "error")
        return ai("", undefined, [{ id: "c2", name: "add", args: { a: 3, b: 4 } }]);
      return ai(`답: ${last.content}`);
    });
    const agent = createAgent({ model, tools: [add, multiply] });
    const { messages, steps } = await runAgent(agent, { messages: [human("3+4")] });

    // model·tools·model·tools·model — 다섯 스텝.
    expect(steps).toEqual([["model"], ["tools"], ["model"], ["tools"], ["model"]]);
    const toolMsgs = messages.filter(isToolMessage);
    expect(toolMsgs[0]?.status).toBe("error"); // toolNode가 던지지 않고 에러 메시지로
    expect(toolMsgs[1]?.status).toBeUndefined(); // 고친 뒤엔 정상
    expect(messages.at(-1)?.content).toBe("답: 7");
  });
});

describe("createAgent — 종료 불변식", () => {
  test("maxToolRounds를 넘으면 마지막 호출엔 툴을 안 줘 루프가 온전히 끝난다", async () => {
    // **툴이 실려 있을 때만** 툴을 부르는 모델. 안 주면 산문으로 답한다. 이게 없으면(모델이
    // 무한히 툴을 부르면) 그래프가 안 끝난다 — 상한이 마지막 호출에 툴을 빼서 그걸 막는다.
    const { model, calls } = fakeModel((messages, options) =>
      options.tools !== undefined
        ? ai("", undefined, [{ id: `c${messages.length}`, name: "add", args: { a: 1, b: 1 } }])
        : ai("멈춤"),
    );
    const agent = createAgent({ model, tools: [add], maxToolRounds: 2 });
    const { messages, steps } = await runAgent(agent, { messages: [human("계속")] });

    // 라운드 2번 후 종료: model·tools·model·tools·model.
    expect(steps).toEqual([["model"], ["tools"], ["model"], ["tools"], ["model"]]);
    // 툴 라운드는 정확히 2번(AI-with-toolCalls 2개).
    const toolRounds = messages.filter((m) => isAIMessage(m) && (m as AIMessage).toolCalls).length;
    expect(toolRounds).toBe(2);
    // 마지막 model 호출엔 툴이 안 실렸다.
    expect(calls.at(-1)?.tools).toBeUndefined();
    // 이력이 산문으로 온전히 끝난다.
    expect(messages.at(-1)?.content).toBe("멈춤");
  });

  test("run 경계는 마지막 human 메시지 — 지난 턴 툴 호출이 상한을 안 깎는다", async () => {
    // 지난 턴에 이미 툴을 2번 쓴 이력을 들고 새 human으로 다시 부른다.
    const priorHistory: BaseMessage[] = [
      human("이전 질문"),
      ai("", undefined, [{ id: "p1", name: "add", args: { a: 1, b: 1 } }]),
      toolMessage("p1", "2"),
      ai("", undefined, [{ id: "p2", name: "add", args: { a: 2, b: 2 } }]),
      toolMessage("p2", "4"),
      ai("이전 답"),
      human("새 질문"), // ← run 경계. 여기 이후로만 라운드를 센다.
    ];
    // **이번 턴에** 툴 결과가 들어왔나는 마지막 메시지로 본다(지난 턴 tool 메시지에 안 속게).
    const { model, calls } = fakeModel((messages) =>
      messages.at(-1)?.role === "tool"
        ? ai("새 답")
        : ai("", undefined, [{ id: "n1", name: "add", args: { a: 3, b: 3 } }]),
    );
    const agent = createAgent({ model, tools: [add], maxToolRounds: 2 });
    const { messages } = await runAgent(agent, { messages: priorHistory });

    // 지난 턴 라운드(2)를 셌다면 첫 호출부터 툴이 막혀 새 질문에 툴을 못 쓴다.
    // 마지막 human 이후로만 세므로 첫 호출에 툴이 실린다.
    expect(calls[0]?.tools).not.toBeUndefined();
    expect(messages.at(-1)?.content).toBe("새 답");
    expect(messages.filter(isToolMessage).map((m) => m.toolCallId)).toEqual(["p1", "p2", "n1"]);
  });
});

describe("createAgent — 툴 없는 에이전트 / 구성 가드", () => {
  test("툴이 없으면 단발 호출(START→model→END)", async () => {
    const { model } = fakeModel(() => ai("바로 답"));
    const agent = createAgent({ model });
    const { messages, steps } = await runAgent(agent, { messages: [human("안녕")] });
    expect(steps).toEqual([["model"]]);
    expect(messages.at(-1)?.content).toBe("바로 답");
  });

  test("system은 매 호출 invoke 옵션으로 실린다", async () => {
    const { model, calls } = fakeModel(() => ai("답"));
    const agent = createAgent({ model, system: "너는 친절하다" });
    await runAgent(agent, { messages: [human("안녕")] });
    expect(calls[0]?.system).toBe("너는 친절하다");
  });

  test("툴을 줬는데 모델이 못 실으면 구성 시점에 던진다", () => {
    const { model } = fakeModel(() => ai("x"), { supportsTools: false });
    expect(() => createAgent({ model, tools: [add] })).toThrow(ModelCannotUseToolsError);
    // 툴이 없으면 supportsTools=false여도 문제없다(단발 호출).
    expect(() => createAgent({ model })).not.toThrow();
  });
});
