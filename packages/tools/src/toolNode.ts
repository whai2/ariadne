// 툴 실행 노드 — 그래프 안에서 **모델이 요청한 툴들을 실제로 돌린다** (F2.2).
//
// 새 엔진 기능은 없다. `toolNode(TOOLS)`는 그냥 `NodeFn`이라 `addNode`에 그대로 꽂히고,
// `Promise.all`이 병렬 실행을, V7의 `Command`가 상태·제어흐름 갱신을 맡는다.
// 링이 하는 일은 **프로토콜을 지키는 것**이지 새 실행 개념을 만드는 게 아니다.
//
// langgraph 대응: prebuilt/tool_node.py 의 ToolNode / tools_condition.
// 안 옮긴 것(의도적): 주입 상태·스토어(+ 인자 강제 제거), 스트리밍, return_direct,
// remaining_steps, pre/post 훅, ValidationNode, 핸들러 어노테이션 추론, sync/async 이중화.

import {
  type BaseMessage,
  Command,
  END,
  isAIMessage,
  isToolMessage,
  type MessagesState,
  type NodeFn,
  type RouteTarget,
  type ToolCall,
  type ToolMessage,
  tool as toolMessage,
} from "@ariadne/core";
import { z } from "zod";
import { MissingToolMessageError } from "./errors";
import type { AnyTool, ToolContext } from "./tool";

/**
 * 마지막 AI 메시지의 툴 호출들.
 *
 * **뒤에서부터 AI 메시지를 찾는다** — `messages.at(-1)`이 아니다. 툴 결과가 뒤에 붙고 나면
 * 마지막 메시지는 tool이지 ai가 아니기 때문이다.
 */
export function lastToolCalls(messages: readonly BaseMessage[]): ToolCall[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg !== undefined && isAIMessage(msg)) return msg.toolCalls ?? [];
  }
  return [];
}

/**
 * 라우터: 툴 호출이 있으면 `"tools"`, 없으면 종료.
 *
 * **노드 이름이 `"tools"`로 고정이다**(langgraph도 같다). 설정 가능하게 만들지 않은 건
 * 두 번째 소비자가 아직 없어서다. 다른 이름을 쓰고 싶으면 람다로 감싸면 된다.
 *
 * ```ts
 * g.addConditionalEdges("model", toolsCondition, ["tools", END]);
 * ```
 * 세 번째 인자(path_map)는 S6에서 생긴 **그림 전용** 선언이다 — 적어야 점선이 그려진다.
 */
export function toolsCondition(state: MessagesState): "tools" | typeof END {
  return lastToolCalls(state.messages).length > 0 ? "tools" : END;
}

/**
 * 툴이 돌려준 값을 결과 메시지의 content로 만든다.
 *
 * 문자열이면 그대로, 아니면 JSON, 그것도 안 되면(순환 참조 등) `String()`.
 * 사소해 보이지만 **모델이 읽을 유일한 텍스트**라 조용히 `undefined`가 되면 안 된다.
 * langgraph 대응: tool_node.py 의 `msg_content_output`.
 */
export function coerceContent(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    const json = JSON.stringify(output);
    return json === undefined ? String(output) : json;
  } catch {
    return String(output); // 순환 참조
  }
}

/** 툴 하나를 돌린다. 결과 메시지 또는 (툴이 원하면) Command. */
async function runOne<S extends MessagesState>(
  call: ToolCall,
  byName: ReadonlyMap<string, AnyTool>,
  known: string,
): Promise<ToolMessage | Command<S>> {
  const found = byName.get(call.name);
  // 모르는 이름은 모델의 착각이다 — **쓸 수 있는 이름을 알려주면** 다음 턴에 스스로 고친다.
  if (found === undefined) {
    return toolMessage(call.id, `'${call.name}'라는 툴은 없다. 쓸 수 있는 툴: ${known}`, "error");
  }
  // JSON이 깨진 것과 스키마를 어긴 것은 **원인이 달라서 구분해 말해준다**.
  if (call.invalidArgs !== undefined) {
    return toolMessage(
      call.id,
      `인자가 올바른 JSON이 아니다. 받은 원문: ${call.invalidArgs}`,
      "error",
    );
  }
  const parsed = found.schema.safeParse(call.args);
  if (!parsed.success) {
    return toolMessage(
      call.id,
      `'${call.name}'의 인자가 스키마에 안 맞는다.\n${z.prettifyError(parsed.error)}`,
      "error",
    );
  }

  const ctx: ToolContext = { toolCallId: call.id };
  // **여기서 try/catch를 하지 않는다.** 에러 정책의 핵심 분기다:
  //   모델이 잘못 준 인자  → 위에서 에러 메시지로 (모델이 고칠 수 있다)
  //   툴 본문이 던짐       → 그대로 전파   (우리 버그다. 모델에게 사과시킬 일이 아니다)
  const output = await found.execute(parsed.data as Record<string, unknown>, ctx);

  if (output instanceof Command) {
    const command = output as Command<S>;
    // Command를 돌려주면 결과 메시지도 툴이 직접 만들어야 한다 — 없으면 답 없는 tool_use가 남는다.
    const answered = (command.update?.messages ?? []).some(
      (m) => isToolMessage(m) && m.toolCallId === call.id,
    );
    if (!answered) throw new MissingToolMessageError(call.name, call.id);
    return command;
  }
  return toolMessage(call.id, coerceContent(output));
}

/**
 * N개의 결과를 **노드 반환값 하나로 접는다.**
 *
 * `NodeReturn<S>`가 `Partial<S> | Command<S>` 단일 값이라(배열이 아니라) 여기서 합쳐야 한다.
 * langgraph는 Command **리스트**를 반환해 엔진이 합치게 하는데, 그 차이가 하나 드러난다:
 * **messages 밖의 같은 키를 두 툴이 쓰면 나중 것이 이긴다** — 채널 리듀서에 닿기 전에
 * 충돌하기 때문이다. messages는 순서대로 이어붙으므로 영향이 없다.
 */
function mergeOutcomes<S extends MessagesState>(
  outcomes: ReadonlyArray<ToolMessage | Command<S>>,
): Partial<S> | Command<S> {
  const messages: BaseMessage[] = [];
  const goto: RouteTarget[] = [];
  let update: Record<string, unknown> = {};
  let hasCommand = false;

  for (const outcome of outcomes) {
    if (!(outcome instanceof Command)) {
      messages.push(outcome);
      continue;
    }
    hasCommand = true;
    const { messages: own, ...rest } = (outcome.update ?? {}) as {
      messages?: BaseMessage[];
    } & Record<string, unknown>;
    messages.push(...(own ?? []));
    update = { ...update, ...rest };
    goto.push(...outcome.goto);
  }

  const merged = { ...update, messages } as Partial<S>;
  return hasCommand ? new Command<S>({ update: merged, goto }) : merged;
}

/**
 * 툴들을 실행하는 그래프 노드를 만든다.
 *
 * ```ts
 * g.addNode("tools", toolNode([add, multiply]));
 * g.addConditionalEdges("model", toolsCondition, ["tools", END]);
 * g.addEdge("tools", "model");
 * ```
 *
 * 계약:
 * - 호출들을 **병렬로** 돌리고(`Promise.all`), 결과는 **호출 순서대로** 낸다.
 * - **호출 id 하나당 결과 정확히 하나.** `calls.map(...)` 구조가 그걸 강제한다 —
 *   langgraph가 상류 세 곳에서 검사하는 불변식을 우리는 자료구조로 못박는다.
 * - 툴이 `Command`를 돌려주면 상태 갱신·행선지가 같이 반영된다.
 *   **주의: `goto`는 더하기다** — 정적 엣지를 취소하지 못한다(V7에서 제어흐름이 채널 쓰기라,
 *   쓰기가 합집합이기 때문). `goto: END`로 루프를 끊으려면 `tools`에 정적 엣지를 주지 마라.
 */
export function toolNode<S extends MessagesState>(tools: readonly AnyTool[]): NodeFn<S> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const known = tools.map((t) => t.name).join(", ");

  return async (state: S) => {
    const calls = lastToolCalls(state.messages);
    if (calls.length === 0) return {};
    return mergeOutcomes<S>(await Promise.all(calls.map((call) => runOne<S>(call, byName, known))));
  };
}
