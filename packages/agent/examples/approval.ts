// 승인 게이트 데모 — **자격증명 0, 네트워크 0.** (F3.3)
//
//   bun run --filter '@ariadne/agent' example:approval
//
// 볼 것은 하나다: **core에 인터럽트가 없는데도 멈췄다 재개된다.**
// 멈춤은 "답 없는 tool_use를 남기고 run이 끝난 것"이고, 재개는 "같은 이력으로 새 run"이다.
// 그 사이에 프로세스가 죽어도 되는 건 상태가 전부 `messages` 배열 안에 있기 때문이다.
//
// 네 장면:
//   1. ask   — 툴 직전에 멈춘다. 새 메시지 0개, 대기 호출 1개.
//   2. 재개(allow) — 같은 이력 + 다른 정책. START가 model이 아니라 tools로 들어간다.
//   3. 재개(deny)  — 거부는 멈춤이 아니다. 거부 결과를 읽고 모델이 다른 길을 찾는다.
//   4. allow 정책  — 안 물어보는 툴(read)은 조용히 돈다. askFor가 위험한 것만 세운다.

import { type AIMessage, ai, type BaseMessage, human, isAIMessage } from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { type ApprovalPolicy, askFor, createAgent, pendingToolCalls } from "../src/index";

// **부수효과가 진짜로 있는 툴**이라야 게이트가 뭘 막는지 보인다. 지웠는지 안 지웠는지
// 배열이 증언한다 — "승인 안 했으면 안 돌았다"를 말이 아니라 관찰로 확인한다.
const deleted: string[] = [];

const deleteFile = defineTool({
  name: "delete_file",
  description: "파일을 지운다(데모라 배열에 이름만 남긴다).",
  schema: z.object({ path: z.string() }),
  execute: ({ path }) => {
    deleted.push(path);
    return `지웠다: ${path}`;
  },
});

const readFile = defineTool({
  name: "read_file",
  description: "파일을 읽는다(데모라 고정 내용).",
  schema: z.object({ path: z.string() }),
  execute: ({ path }) => `${path}의 내용: (데모)`,
});

/**
 * 대본 없는 가짜 모델. **messages만 보고 정한다**(클로저 카운터를 두면 run을 여러 번 돌릴 때
 * 두 번째가 다르게 굴러버린다 — F2.3의 교훈, react.ts와 같은 이유).
 * 아직 툴 결과가 없으면 지우자고 하고, 있으면 그 결과를 읽고 정리한다.
 */
function scriptedModel(call: { name: string; args: Record<string, unknown> }): ChatModel {
  return {
    provider: "fake",
    modelId: "files",
    supportsTools: true,
    async invoke(messages: BaseMessage[]): Promise<AIMessage> {
      const results = messages.filter((m) => m.role === "tool");
      if (results.length === 0) return ai("", undefined, [{ id: "call_1", ...call }]);
      const denied = results.some((m) => (m as { status?: string }).status === "error");
      return ai(denied ? "알겠다, 지우지 않고 목록만 보여주겠다." : `완료. ${results[0]?.content}`);
    },
  };
}

function dump(messages: BaseMessage[]) {
  for (const msg of messages) {
    const calls = isAIMessage(msg) ? (msg.toolCalls ?? []) : [];
    const label = calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ");
    console.log(`  ${msg.role}: ${msg.content}${label === "" ? "" : ` 🔧 ${label}`}`);
  }
}

/** 한 run. 최종 이력을 돌려준다 — **그게 곧 재개에 필요한 전부**다. */
async function run(
  title: string,
  history: BaseMessage[],
  approval: ApprovalPolicy,
  call = { name: "delete_file", args: { path: "notes.md" } as Record<string, unknown> },
): Promise<BaseMessage[]> {
  console.log(`━━━ ${title} ━━━`);
  const agent = createAgent({
    model: scriptedModel(call),
    tools: [deleteFile, readFile],
    approval,
  });
  let final: BaseMessage[] = history;
  for await (const step of agent.stream({ messages: history })) {
    console.log(`  step ${step.step}: ${step.nodes.join(" · ")}`);
    final = step.state.messages;
  }
  dump(final);
  const pending = pendingToolCalls(final);
  console.log(
    pending.length > 0
      ? `  ⏸  승인 대기: ${pending.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(", ")}`
      : "  ▶  대기 없음 (끝까지 돌았다)",
  );
  console.log(`  🗑  지워진 파일: [${deleted.join(", ")}]\n`);
  return final;
}

// 1. 위험한 툴은 묻는다 → 멈춘다. **새 AI 답이 없고 tool_use가 답 없이 남는다.**
const paused = await run(
  "장면 1 · ask — 툴 직전에 멈춘다",
  [human("notes.md 지워줘")],
  askFor(["delete_file"]),
);

// 2. 같은 멈춤에서 거부. **거부는 멈춤이 아니다** — 툴 결과 하나라 모델이 읽고 방향을 튼다.
//    끝까지 돌았는데도 `deleted`가 비어 있는 게 게이트가 실제로 막았다는 증거다.
await run("장면 2 · 재개(deny) — 거부도 그냥 툴 결과다", paused, () => "deny");

// 3. **같은 멈춤**을 이번엔 승인. 재개 = **같은 이력 + 결정을 아는 정책**뿐이라, 장면 2를
//    돌린 뒤에도 `paused`만 있으면 그대로 다시 갈린다(새 엔드포인트도·세션도·체크포인터도 없다).
//    START 라우터가 대기를 보고 model이 아니라 tools로 들어간다 — 안 그러면 답 없는 tool_use를
//    실은 이력을 모델에게 다시 보내게 되고, 그건 양쪽 와이어 포맷 다 400이다.
await run("장면 3 · 재개(allow) — 이력 그대로 다시 돈다", paused, () => "allow");

// 4. 같은 정책, 안 위험한 툴. askFor가 이름으로 갈라 **읽기는 조용히** 돈다.
await run(
  "장면 4 · allow — 위험하지 않은 툴은 안 묻는다",
  [human("notes.md 읽어줘")],
  askFor(["delete_file"]),
  { name: "read_file", args: { path: "notes.md" } },
);
