// 승인 게이트 — 툴이 돌기 전에 **사람에게 묻는다** (F3.3).
//
// F3.2가 남긴 벽이 이걸 불렀다: MCP로 남의 서버 툴이 붙는데(`edit_file`·`write_file`),
// 사람이 그 실행을 막을 자리가 없었다. 스튜디오가 폴더 하나로 범위를 좁힌 건 정책이 아니라 회피였다.
//
// **core엔 인터럽트가 없다**(범위 밖 — ROADMAP). 그래서 "멈췄다 재개"를 엔진 기능으로 만들지
// 않고, 이미 있는 것으로 표현한다:
//
//   멈춤 = **답 없는 `tool_use`를 이력에 남기고 run을 끝낸다.**
//   재개 = 같은 이력으로 **새 run**을 시작하되, START가 model이 아니라 tools로 들어간다.
//
// 성립하는 이유는 F3.1의 발견이다 — **이 에이전트의 유일한 상태가 messages 채널**이라,
// 대화만 되돌려주면 체크포인터 없이도 정확히 그 자리에서 이어진다. 스튜디오가 매 턴 이력
// 전체를 다시 싣는 무상태 규약이 그대로 재개 규약이 된다(새 엔드포인트도, 세션도 필요 없다).
//
// langgraph 대응: prebuilt의 human-in-the-loop(`interrupt()` + checkpointer). 우리는 그 둘 다
// 없이 같은 관찰을 만든다 — 대신 **재개 사이에 프로세스가 죽어도 되는 건 이력을 쥔 쪽이
// 클라이언트라서**이지, 우리가 영속성을 가져서가 아니다(그건 F4).

import {
  type BaseMessage,
  END,
  isAIMessage,
  isToolMessage,
  type MessagesState,
  type NodeFn,
  type ToolCall,
  tool as toolMessage,
} from "@ariadne/core";
import { type AnyTool, lastToolCalls, toolNode } from "@ariadne/tools";

/**
 * 이 툴 호출 묶음을 어떻게 할 것인가.
 *
 * - `"allow"` — 그대로 실행한다.
 * - `"deny"` — 실행하지 않고 **거부 결과 메시지**로 답한다. 모델은 그걸 읽고 다른 길을 찾는다.
 *   (거부는 멈춤이 아니다 — run은 계속 돈다. 그래서 새 개념이 필요 없다: 그냥 툴 결과다.)
 * - `"ask"` — **멈춘다.** 아무것도 안 쓰고 run을 끝내, 답 없는 `tool_use`가 이력에 남는다.
 */
export type Approval = "allow" | "deny" | "ask";

/**
 * 승인 정책. **호출 하나가 아니라 묶음 전체**를 받는다.
 *
 * 묶음 단위인 게 판단이다. 한 묶음은 모델의 **한 번의 결정**이고, 절반만 돌리면 나머지
 * `tool_use`가 답 없이 남아 이력이 깨진다(F2.3의 종료 불변식). 그리고 사람에게도 "이 세 개를
 * 할까요"가 "이건 되고 저건 안 되고"보다 대답하기 쉽다. 호출별 정책이 필요하면 {@link askFor}
 * 처럼 **가장 위험한 호출이 묶음의 등급을 정하게** 올려 붙인다.
 *
 * **비동기인 게 두 모양을 한 인터페이스로 덮는다.**
 * - 터미널 앱: `await confirm(...)`을 정책 안에서 기다렸다 `"allow"`/`"deny"`를 돌려준다.
 *   `"ask"`를 아예 안 쓰므로 **run이 안 멈춘다** — 사람이 루프 안에 서 있다.
 * - HTTP 앱(스튜디오): 요청 안에서 사람을 기다릴 수 없으니 `"ask"`로 **멈추고**, 사람이 누른
 *   결정을 다음 요청의 정책이 돌려준다 — 사람이 루프 **사이**에 선다.
 */
export type ApprovalPolicy = (calls: readonly ToolCall[]) => Approval | Promise<Approval>;

/** 거부됐을 때 모델이 읽을 결과 본문. 모델이 다른 길을 찾을 수 있게 **이유를 사람 말로** 준다. */
const DENIED = "사용자가 이 툴 실행을 승인하지 않았다. 툴 없이 답하거나 다른 방법을 제안해라.";

/**
 * 아직 **답이 없는** 툴 호출들 — 이 저장소에서 "승인 대기 중"의 정의다.
 *
 * 마지막 AI 메시지의 `toolCalls` 중, 그 뒤에 짝(`toolCallId`)이 안 붙은 것. 비어 있지 않다는 건
 * 곧 "run이 사람을 기다리다 끝났다"는 뜻이라, 호출자는 이걸로 승인 UI를 그린다.
 *
 * **이 술어 하나가 진입과 이탈을 둘 다 정한다.** 시작할 때 대기가 있으면 model이 아니라
 * tools로 들어가고(재개), 끝낼 때 대기가 남았으면 model로 안 가고 멈춘다. 방향만 반대다.
 */
export function pendingToolCalls(messages: readonly BaseMessage[]): ToolCall[] {
  let lastAi = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg !== undefined && isAIMessage(msg)) {
      lastAi = i;
      break;
    }
  }
  if (lastAi === -1) return [];
  const calls = (messages[lastAi] as { toolCalls?: ToolCall[] }).toolCalls ?? [];
  if (calls.length === 0) return [];

  const answered = new Set<string>();
  for (let i = lastAi + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg !== undefined && isToolMessage(msg)) answered.add(msg.toolCallId);
  }
  return calls.filter((c) => !answered.has(c.id));
}

/** 항상 사람에게 묻는다. 가장 보수적인 기본값 — 데모·학습용. */
export const askAlways: ApprovalPolicy = () => "ask";

/**
 * 이름이 목록에 든 툴이 **하나라도** 있으면 묻고, 아니면 통과시킨다.
 *
 * ```ts
 * createAgent({ model, tools, approval: askFor(["write_file", "edit_file"]) });
 * ```
 * 읽기는 조용히 돌고 쓰기만 사람을 부른다 — 승인 게이트를 실제로 쓰는 모양이다.
 * **가장 위험한 호출이 묶음의 등급을 정한다**(호출별 정책을 묶음 정책으로 올리는 규칙).
 */
export function askFor(names: readonly string[]): ApprovalPolicy {
  const risky = new Set(names);
  return (calls) => (calls.some((c) => risky.has(c.name)) ? "ask" : "allow");
}

/**
 * `toolNode`를 **감싼** 노드. 정책에 물어보고 통과할 때만 진짜 실행에 넘긴다.
 *
 * **`@ariadne/tools`는 한 글자도 안 바뀐다**(F3.2에서 MCP가 그랬듯). 게이트는 실행의 변형이
 * 아니라 실행 **앞의 결정**이라, 감싸기로 충분하고 툴 링은 승인이라는 개념을 몰라도 된다.
 *
 * 세 갈래가 전부 **이력에 쓰는 것**으로 갈린다 — 별도 채널도, 엔진 신호도 없다:
 * | 결정 | 이 노드가 쓰는 것 | 그래서 라우터가 |
 * |---|---|---|
 * | allow | 툴 결과 메시지 (toolNode가) | 대기 없음 → `model` |
 * | deny  | 거부 결과 메시지 | 대기 없음 → `model` |
 * | ask   | **아무것도 안 쓴다** | 대기 남음 → `END` (멈춤) |
 */
export function gatedToolNode<S extends MessagesState>(
  tools: readonly AnyTool[],
  policy: ApprovalPolicy,
): NodeFn<S> {
  const run = toolNode<S>(tools);
  return async (state: S) => {
    const calls = lastToolCalls(state.messages);
    if (calls.length === 0) return {};

    const decision = await policy(calls);
    if (decision === "ask") {
      // 아무것도 안 쓴다. 답 없는 `tool_use`가 그대로 남는 게 **멈춤의 표현**이다.
      return {};
    }
    if (decision === "deny") {
      // 호출 id마다 결과 하나 — 거부도 툴 결과다(F2.2의 "id 하나당 결과 하나"를 지킨다).
      const denials: BaseMessage[] = calls.map((c) => toolMessage(c.id, DENIED, "error"));
      return { messages: denials } as Partial<S>;
    }
    return run(state);
  };
}

/**
 * 진입 라우터: 대기 중인 호출이 있으면 **`tools`부터**(재개), 없으면 평소대로 `model`.
 *
 * 재개가 `model`로 들어가면 안 되는 이유가 프로바이더 쪽에 있다 — 답 없는 `tool_use`를 실은
 * 이력을 그대로 다시 보내면 양쪽 와이어 포맷 다 400이다. 그래서 재개는 **툴부터** 시작한다.
 */
export function approvalEntry(state: MessagesState): "tools" | "model" {
  return pendingToolCalls(state.messages).length > 0 ? "tools" : "model";
}

/**
 * 이탈 라우터: 대기가 남았으면 **멈추고**(END), 답이 다 붙었으면 `model`로 돌아간다.
 *
 * 승인 게이트가 붙은 그래프에서 `tools → model`이 정적 엣지가 아닌 이유가 이것뿐이다.
 * (정적 엣지는 취소가 안 된다 — 제어흐름이 채널 쓰기라 쓰기는 합집합이다, F2.2 주석.)
 */
export function approvalExit(state: MessagesState): "model" | typeof END {
  return pendingToolCalls(state.messages).length > 0 ? END : "model";
}
