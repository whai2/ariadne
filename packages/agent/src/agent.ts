// 에이전트 링 — model+tools 자율 루프를 **core 위의 그래프**로 조립한다 (F3.1).
//
// 이 파일이 F3의 논지 그 자체다: **에이전트에 새 실행 개념은 없다.** ReAct 루프는
// F2.3/F2.4가 네 곳에서 똑같이 손으로 쓰던 네 줄
//
//   g.addNode("tools", toolNode(TOOLS));
//   g.addEdge(START, "model");
//   g.addConditionalEdges("model", toolsCondition, ["tools", END]);
//   g.addEdge("tools", "model");
//
// 을 접은 것 이상도 이하도 아니다. 스케줄링·병렬·상태 갱신은 전부 core가 하던 그대로다.
//
// **이 링은 두 링을 다 안다**(model + tools). F2.2에서 tools와 model을 서로 모르게 뒀는데,
// 에이전트는 그 둘을 엮는 게 존재 이유라 링 규칙의 **첫 예외**다. 대신 그 접점(`toolSpecs()`의
// 결과를 `model.invoke({tools})`에 넘기는 자리)이 이제 이 링의 tsc로 상시 검사된다 —
// 전엔 apps/studio가 지던 몫이 제 집을 찾았다.

import {
  type BaseMessage,
  type CompiledGraph,
  END,
  isAIMessage,
  type MessagesState,
  messagesSchema,
  START,
  StateGraph,
  type StateSchema,
} from "@ariadne/core";
import type { ChatModel, ToolSpec } from "@ariadne/model";
import { type AnyTool, toolNode, toolSpecs, toolsCondition } from "@ariadne/tools";
import { type ApprovalPolicy, approvalEntry, approvalExit, gatedToolNode } from "./approval";
import { ApprovalWithoutToolsError, ModelCannotUseToolsError } from "./errors";

/** 한 run 안에서 모델에게 툴을 쥐여줄 최대 라운드 수의 기본값. */
const DEFAULT_MAX_TOOL_ROUNDS = 10;

export interface AgentConfig<S extends MessagesState = MessagesState> {
  /** 이미 만들어진 모델. `model("provider/id", ...)`로 짓고 넘긴다. */
  model: ChatModel;
  /** 이 에이전트가 부를 수 있는 툴들. 비우면 **단발 호출 그래프**(START→model→END)가 된다. */
  tools?: readonly AnyTool[];
  /** 시스템 지시. 매 모델 호출의 `invoke` 옵션으로 실린다. */
  system?: string;
  /**
   * 한 run에서 모델이 툴을 부를 수 있는 최대 라운드. 이걸 넘어서면 **마지막 호출엔 툴 선언을
   * 안 준다** — 못 부르니 산문으로 답하고 `toolsCondition`이 자연히 END를 골라 이력이 **답 없는
   * `tool_use` 없이** 끝난다. F2.3의 핵심 불변식(“조건부 엣지로 루프를 끊지 않는다”)을 이 링이 진다.
   */
  maxToolRounds?: number;
  /**
   * 커스텀 상태 스키마. 생략하면 순수 대화(`messagesSchema`).
   * 추가 채널을 쓰는 그래프(예: 스튜디오 챗의 `turns`/`tasks`)에 얹을 때만 준다.
   */
  schema?: StateSchema<S>;
  /**
   * 승인 게이트 (F3.3). 주면 툴이 돌기 **직전에** 이 정책에 물어본다.
   *
   * `"ask"`를 돌려주면 run이 **답 없는 `tool_use`를 남기고 끝난다** — 그게 이 저장소의 "멈춤"
   * 표현이다(core엔 인터럽트가 없다). 재개는 같은 이력으로 새 run을 도는 것이고, 그때
   * 진입이 `model`이 아니라 `tools`로 갈린다. 자세한 건 `approval.ts`.
   *
   * 툴이 없으면 걸 데가 없으므로 **구성 시점에 던진다**(`ApprovalWithoutToolsError`).
   */
  approval?: ApprovalPolicy;
}

/**
 * 이번 run에서 모델이 **이미 몇 번 툴을 불렀나** — 마지막 human 메시지 이후의
 * `toolCalls` 실린 AI 메시지 수.
 *
 * **run 경계가 마지막 human 메시지다.** 이게 이 링의 작은 발견이다. 스튜디오 챗은 매 턴 이력
 * 전체를 다시 싣는데, 라운드를 이력 전체에서 세면 지난 턴의 툴 호출까지 얹혀 **새 턴 첫 호출부터
 * 툴이 막힌다.** human 메시지를 앵커로 삼으면 “이번 요청 안에서 몇 번”이 정확히 나온다 —
 * 그리고 그 카운터가 **messages 채널 안에 이미 있으므로 별도 채널이 필요 없다.**
 * (“채널이 유일한 공유 가변 상태”와도 맞는다.) 그 덕에 기본 에이전트는 `MessagesState`
 * 하나로 돌고, 스튜디오가 쓰던 per-turn `turns` 카운터와 **동작이 정확히 같다.**
 *
 * human이 없으면(비정상 입력) 이력 전체를 센다.
 */
function toolRoundsSinceLastHuman(messages: readonly BaseMessage[]): number {
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    // `isHumanMessage`가 core에 없다(가드는 ai·tool만 있다) — 여기선 좁힐 필요 없이
    // role만 보면 되므로 그냥 비교한다. 링이 core를 넓히지 않는다는 F3 규칙과도 맞는다.
    const msg = messages[i];
    if (msg !== undefined && msg.role === "human") {
      start = i + 1;
      break;
    }
  }
  let rounds = 0;
  for (let i = start; i < messages.length; i++) {
    const msg = messages[i];
    if (msg !== undefined && isAIMessage(msg) && (msg.toolCalls?.length ?? 0) > 0) rounds += 1;
  }
  return rounds;
}

/**
 * model+tools ReAct 에이전트를 **컴파일된 그래프**로 만든다.
 *
 * ```ts
 * const agent = createAgent({ model: model("anthropic/claude-opus-5"), tools: [add, multiply] });
 * const out = await agent.invoke({ messages: [human("3+4랑 5×6")] });
 * ```
 *
 * 반환이 `CompiledGraph`인 게 요점이다 — 에이전트는 **특별한 실행기가 아니라 특별한 그래프**라,
 * 스튜디오의 `stream()`·`getGraph()` 관찰이 그대로 붙는다.
 *
 * **왜 `class Agent`가 아니라 함수인가:** 지금 에이전트는 담을 상태·수명주기가 없다
 * (불변 설정 → 불변 그래프, 루프 카운터마저 messages 채널에서 센다). 세션·MCP·승인 게이트가
 * 붙어 `this`에 얹을 게 처음 생기면 그래프를 감싼 객체로 승격한다 — 그때도 그래프는 계속
 * 노출한다(감추면 관찰이 깨진다). 자세한 판단·확장 경로: docs/notes/21-f3_1-agent-ring.md.
 */
export function createAgent<S extends MessagesState = MessagesState>(
  config: AgentConfig<S>,
): CompiledGraph<S> {
  const { model, system, approval } = config;
  const tools = config.tools ?? [];
  const maxToolRounds = config.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const schema = config.schema ?? (messagesSchema as StateSchema<S>);

  // 툴을 줬는데 못 싣는 모델이면 **지금 던진다** — 그래프가 조용히 툴 노드에 안 가는 걸 막는다.
  if (tools.length > 0 && !model.supportsTools) {
    throw new ModelCannotUseToolsError(model.provider);
  }
  // 승인 정책만 있고 툴이 없으면 게이트는 **영영 안 불린다**. 같은 이유로 여기서 세운다.
  if (approval !== undefined && tools.length === 0) {
    throw new ApprovalWithoutToolsError();
  }

  // 두 링이 만나는 유일한 자리: tools 링의 산출물을 model 링의 `invoke({tools})`에 넘긴다.
  // 구조적 타이핑이 여기서 tsc로 검사된다(두 타입은 이름만 다르고 모양이 같다).
  const specs: ToolSpec[] | undefined = tools.length > 0 ? toolSpecs(tools) : undefined;

  const g = new StateGraph<S>(schema);

  g.addNode("model", async (state: S) => {
    // 라운드 상한을 넘었으면 툴을 안 준다 → 모델이 산문으로 답하고 루프가 온전하게 끝난다.
    const offerTools =
      specs !== undefined && toolRoundsSinceLastHuman(state.messages) < maxToolRounds;
    const reply = await model.invoke(state.messages, {
      ...(system === undefined ? {} : { system }),
      ...(offerTools ? { tools: specs } : {}),
    });
    return { messages: [reply] } as Partial<S>;
  });

  if (specs === undefined) {
    // 툴이 없으면 에이전트는 단발 호출이다. tools 노드도 조건부 엣지도 지어봐야 죽은 가지다.
    g.addEdge(START, "model");
    g.addEdge("model", END);
  } else if (approval === undefined) {
    // 노드 이름이 "tools"인 건 toolsCondition이 그 문자열을 돌려주기 때문이다(langgraph도 같다).
    g.addEdge(START, "model");
    g.addNode("tools", toolNode<S>(tools));
    g.addConditionalEdges("model", toolsCondition, ["tools", END]);
    g.addEdge("tools", "model"); // 툴 결과를 들고 다시 model로 (루프)
  } else {
    // 승인 게이트가 붙은 모양 (F3.3). **노드는 그대로 둘이다** — 바뀐 건 두 엣지의 방향성뿐이고,
    // 그 둘을 **같은 술어**(`pendingToolCalls`)가 정한다:
    //
    //   START → tools  (대기 있음 = 재개)      tools → END  (대기 남음 = 멈춤)
    //   START → model  (대기 없음 = 새 요청)   tools → model (답 다 붙음 = 평소 루프)
    //
    // `tools → model`이 정적 엣지에서 조건부로 바뀐 게 요점이다. 정적 엣지는 **취소가 안 된다**
    // (제어흐름이 채널 쓰기라 쓰기는 합집합이다) — 멈추려면 애초에 안 써야 한다.
    g.addNode("tools", gatedToolNode<S>(tools, approval));
    g.addConditionalEdges(START, approvalEntry, ["tools", "model"]);
    g.addConditionalEdges("model", toolsCondition, ["tools", END]);
    g.addConditionalEdges("tools", approvalExit, ["model", END]);
  }

  return g.compile();
}
