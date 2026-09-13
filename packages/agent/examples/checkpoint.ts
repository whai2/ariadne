// 체크포인트로 멈춤과 재개를 잇는다 (F5.2).
//
// 실행: `bun run --filter '@ariadne/agent' example:checkpoint`
// 자격증명 0 · 네트워크 0 · 파일 0.
//
// F3.3의 재개는 **호출자가 이력 전체를 되돌려주는 것**에 기대고 있었다. 대화 말고
// 다른 상태가 하나라도 있으면 그게 조용히 사라진다(F5.1이 실측). 이제 채널이 자기 값을
// 내놓을 수 있으니, 되돌려줄 게 이력이 아니라 **문자열 하나**다.
//
// 네 장면이 보여주는 것:
//   1. 체크포인트 없이  — 이력을 다 실어야 하고, 그래도 `budget`은 사라진다
//   2. 체크포인트로     — 입력은 비우고 값 하나만 넘긴다. 전부 살아남는다
//   3. 함정            — 복원 위에 같은 걸 또 실으면 두 번 접힌다
//   4. 무엇이 담기나   — 상태 채널만. 제어 채널은 안 담겨서 진입은 늘 START부터다

import {
  type AIMessage,
  ai,
  type BaseMessage,
  type ChannelCheckpoint,
  human,
  isToolMessage,
  type MessagesState,
  messagesSchema,
  type StateSchema,
} from "@ariadne/core";
import type { ChatModel } from "@ariadne/model";
import { defineTool } from "@ariadne/tools";
import { z } from "zod";
import { type Approval, askFor, createAgent, pendingToolCalls } from "../src/index";

// ── 대화 말고도 상태가 있는 에이전트 ─────────────────────────────────────────

/** `plan`은 세워둔 계획(마지막 값만), `budget`은 남은 예산(합계로 누적). */
interface Assistant extends MessagesState {
  plan: string;
  budget: number;
}

const schema: StateSchema<Assistant> = {
  ...messagesSchema,
  plan: {},
  budget: { reducer: (a, b) => a + b },
};

/** 실행되면 흔적이 남는 툴 — "안 돌았다"를 말이 아니라 관찰로 확인하려고. */
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

const CALL = [{ id: "call_1", name: "delete_file", args: { path: "notes.md" } }];

/** 툴 결과가 없으면 호출하고, 있으면 산문으로 답한다. **이력만 보고 결정론적으로.** */
const model: ChatModel = {
  provider: "fake",
  modelId: "demo",
  supportsTools: true,
  async invoke(messages: BaseMessage[]): Promise<AIMessage> {
    return messages.some(isToolMessage) ? ai("지웠다. 더 도울 일 있나?") : ai("", undefined, CALL);
  },
};

function agent(decision?: Approval) {
  return createAgent<Assistant>({
    model,
    tools: [deleteFile],
    approval: decision === undefined ? askFor(["delete_file"]) : () => decision,
    schema,
  });
}

// ── 한 턴 ────────────────────────────────────────────────────────────────────

interface Turn {
  state: Partial<Assistant>;
  steps: string[][];
  checkpoint: ChannelCheckpoint;
}

/**
 * 한 턴을 돌리고 **최종 상태와 체크포인트를 함께** 돌려준다.
 *
 * 체크포인트는 매 스텝에 실려 오므로 마지막 것만 들면 된다 — 스튜디오가 `channels`로
 * 사람에게 그리는 그 순간을, 이쪽은 기계가 되받을 형태로 말한다.
 */
async function turn(
  graph: ReturnType<typeof agent>,
  input: Partial<Assistant>,
  checkpoint?: ChannelCheckpoint,
): Promise<Turn> {
  const steps: string[][] = [];
  let state: Partial<Assistant> = input;
  let cp: ChannelCheckpoint = {};
  const opts = checkpoint === undefined ? undefined : { checkpoint };
  for await (const step of graph.stream(input as Assistant, opts)) {
    steps.push(step.nodes);
    state = step.state;
    cp = step.checkpoint;
  }
  return { state, steps, checkpoint: cp };
}

function report(label: string, t: Turn): void {
  const msgs = t.state.messages ?? [];
  const pending = pendingToolCalls(msgs);
  console.log(`\n${label}`);
  console.log(`  스텝      ${JSON.stringify(t.steps)}`);
  console.log(`  상태 키   [${Object.keys(t.state).join(", ")}]`);
  console.log(`  plan      ${t.state.plan ?? "(없음)"}`);
  console.log(`  budget    ${t.state.budget ?? "(없음)"}`);
  console.log(`  메시지    ${msgs.length}개 (툴 결과 ${msgs.filter(isToolMessage).length}개)`);
  console.log(
    pending.length > 0 ? `  ⏸  승인 대기: ${pending[0]?.name}` : "  ▶  대기 없음 (끝까지 돌았다)",
  );
  console.log(`  🗑  지워진 파일: [${deleted.join(", ")}]`);
}

/** 저장소를 거쳤다고 치고 **실제로 JSON을 건넌다** — 여기서 안 죽는 게 요점이다. */
function store(cp: ChannelCheckpoint): ChannelCheckpoint {
  return JSON.parse(JSON.stringify(cp)) as ChannelCheckpoint;
}

// ── 장면 ─────────────────────────────────────────────────────────────────────

console.log("═".repeat(70));
console.log("턴 1 · 승인 대기로 멈춘다");
console.log("═".repeat(70));

const first = await turn(agent(), {
  messages: [human("notes.md 지워줘")],
  plan: "notes.md를 지운다",
  budget: 5,
});
report("입력: { messages, plan, budget: 5 }", first);

const saved = store(first.checkpoint);
console.log(`\n  💾 저장된 체크포인트: ${JSON.stringify(saved).slice(0, 60)}…`);
console.log(`     키 = [${Object.keys(saved).join(", ")}]`);

console.log(`\n${"═".repeat(70)}`);
console.log("장면 1 · 체크포인트 없이 재개 — 이력을 다 실어도 나머지는 사라진다");
console.log("═".repeat(70));

const noCheckpoint = await turn(agent("allow"), { messages: first.state.messages });
report("입력: { messages } (실제 재개 경로가 하는 그대로)", noCheckpoint);
console.log("  → 승인 왕복은 멀쩡한데 plan·budget이 키째 없다. **아무도 안 알려준다.**");

deleted.length = 0; // 다음 장면을 위해 흔적 초기화

console.log(`\n${"═".repeat(70)}`);
console.log("장면 2 · 체크포인트로 재개 — 넘기는 건 문자열 하나");
console.log("═".repeat(70));

const resumed = await turn(agent("allow"), { budget: -1 }, saved);
report("입력: { budget: -1 } ← 이번 턴 비용만. 이력은 복원에서 온다", resumed);
console.log("  → plan이 살아 있고, budget은 5에서 1을 쓴 4다. 이력은 한 번도 다시 안 실었다.");

deleted.length = 0;

console.log(`\n${"═".repeat(70)}`);
console.log("장면 3 · 함정 — 복원 위에 같은 걸 또 실으면");
console.log("═".repeat(70));

const doubled = await turn(agent("allow"), { messages: first.state.messages, budget: 5 }, saved);
report("입력: { messages, budget: 5 } + 같은 체크포인트", doubled);
console.log("  → budget이 10이다. 복원은 대입(리듀서 우회), 입력은 applyWrites(리듀서 통과)라");
console.log("     두 경로가 겹치면 접힌다. 메시지도 id가 없어 교체 대신 덧붙었다.");
console.log("     **계약: 복원했으면 입력엔 새것만 싣는다.**");

console.log(`\n${"═".repeat(70)}`);
console.log("장면 4 · 무엇이 담기나 — 상태 채널만");
console.log("═".repeat(70));

console.log(`\n  컴파일된 채널 : [${agent().getChannelNames().join(", ")}]`);
console.log(`  체크포인트 키 : [${Object.keys(saved).join(", ")}]`);
console.log("\n  → branch:to:* 와 __tasks__ 는 안 담긴다. 우리 멈춤은 늘 정지점이라 그 자리에선");
console.log("     어차피 비어 있고, 실어 보내면 진입 writer와 겹쳐 같은 노드가 두 번 깨어난다.");
console.log("     그래서 **복원은 스텝이 아니라 상태만 이어받는다** — 진입은 늘 START부터다.");
console.log(
  `     장면 2의 스텝이 ${JSON.stringify(resumed.steps)}인 게 그 증거다(model이 아니라 tools부터).`,
);
