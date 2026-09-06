// 챗 플레이그라운드의 서버 쪽. 프로바이더 목록과 한 턴 대화를 담당한다.
//
// **대화도 그래프로 돈다.** 모델을 직접 부르지 않고 `messagesSchema` 그래프를 세워
// `stream()`으로 돌린다 — 그래야 스텝·채널 관찰이 챗에서도 그대로 붙는다.
// (그게 이 스튜디오가 일반 챗 UI와 다른 점이다.)

import {
  ai,
  type BaseMessage,
  END,
  human,
  type MessagesState,
  messagesSchema,
  Send,
  START,
  StateGraph,
  type StateSchema,
  type StepUpdate,
} from "@ariadne/core";
import { listProviders, model, PROVIDERS } from "@ariadne/model";
import {
  DEMO_TOOLS,
  type ToolSpecShape,
  toolNode,
  toolSpecs,
  toolsCondition,
} from "@ariadne/tools";

/** 드롭다운 한 줄. 키가 있는지까지 알려줘서 고르기 전에 알 수 있게 한다. */
export interface ProviderInfo {
  id: string;
  name: string;
  /** 어느 어댑터가 맡나 — UI가 그룹을 나눈다. */
  format: string;
  /** 지금 이 환경에서 바로 쓸 수 있나. */
  ready: boolean;
  /** 준비가 안 됐다면 무엇이 필요한지. */
  need: string;
  /**
   * **툴 선언을 와이어에 실을 수 있나**(`ChatModel.supportsTools`와 같은 뜻).
   *
   * 모델을 만들어 보지 않고 `format`만으로 안다 — 자격증명이 없어도 UI가 미리 경고할 수 있게.
   * 안 그러면 사용자가 claude-code로 tools 모양을 고르고 **보낸 뒤에야** 예외를 본다.
   */
  tools: boolean;
  /** 모델 입력칸의 placeholder. 없으면 사용자가 직접 적어야 한다. */
  suggested?: string;
}

/**
 * 자주 쓰는 프로바이더의 **기본 모델 제안**. 순전히 UI 편의다 —
 * 레지스트리에는 모델 목록을 넣지 않기로 했으므로(7,560개), 여기 몇 개만 손으로 둔다.
 * 틀리거나 낡아도 사용자가 입력칸에서 고치면 그만이다.
 */
const SUGGESTED: Record<string, string> = {
  "claude-code": "sonnet",
  anthropic: "claude-opus-5",
  openai: "gpt-5.5",
  google: "gemini-3-pro",
  openrouter: "anthropic/claude-sonnet-4.5",
  groq: "llama-3.3-70b-versatile",
  deepseek: "deepseek-chat",
  xai: "grok-4",
  mistral: "mistral-large-latest",
  togetherai: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  cerebras: "llama-3.3-70b",
  minimax: "MiniMax-M2",
  ollama: "qwen3",
};

/** 눈에 먼저 띄어야 하는 것들. 나머지는 알파벳 순으로 뒤에 붙는다. */
const POPULAR = Object.keys(SUGGESTED);

/** `claude` CLI가 있나 — claudeCode 프로바이더의 준비 조건이다. */
function hasClaudeCli(): boolean {
  try {
    return Bun.spawnSync(["which", "claude"]).exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * 프로바이더 하나가 **지금 쓸 수 있는지** 본다.
 * 레지스트리가 env 이름을 아니까 "무엇이 필요한지"까지 말해줄 수 있다.
 */
export function statusOf(id: string, env: Record<string, string | undefined>): ProviderInfo | null {
  const entry = PROVIDERS[id];
  if (entry === undefined || entry.format === "unsupported") return null;

  const base = {
    id,
    name: entry.name,
    format: entry.format,
    // claude-code만 못 한다 — `-p`는 result 문자열 하나뿐이라 툴 선언을 실을 자리가 없다(F2.1).
    tools: entry.format !== "claudeCode",
    ...(SUGGESTED[id] === undefined ? {} : { suggested: SUGGESTED[id] }),
  };

  if (entry.format === "claudeCode") {
    const ready = hasClaudeCli();
    return { ...base, ready, need: ready ? "" : "`claude` CLI 설치 + 로그인" };
  }

  const apiVars = entry.apiVars ?? [];
  const keyNames = entry.env.filter((n) => !apiVars.includes(n));
  const missingKey = !keyNames.some((n) => env[n]);
  const missingCfg = apiVars.filter((n) => !env[n]);

  // 본가는 키가 없어도 SDK가 OAuth 프로필 등을 찾을 수 있다(F1.6) — 단정하지 않는다.
  const sdkMayResolve = (id === "anthropic" || id === "openai") && entry.api === undefined;

  const need = [
    ...(missingKey && !sdkMayResolve ? [keyNames.join(" 또는 ")] : []),
    ...missingCfg,
  ].join(" · ");
  return { ...base, ready: need === "", need };
}

/** 드롭다운에 넣을 전체 목록. 준비된 것 → 자주 쓰는 것 → 나머지 순. */
export function providerList(
  env: Record<string, string | undefined> = process.env,
): ProviderInfo[] {
  const all = [
    ...listProviders("claudeCode"),
    ...listProviders("anthropic"),
    ...listProviders("openai"),
  ]
    .map((id) => statusOf(id, env))
    .filter((p): p is ProviderInfo => p !== null);

  const rank = (p: ProviderInfo) => {
    const pop = POPULAR.indexOf(p.id);
    return (p.ready ? 0 : 1000) + (pop === -1 ? 500 : pop);
  };
  return all.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export interface ChatReply {
  /** 새로 붙은 AI 메시지들. 모양에 따라 여럿일 수 있다(병렬은 둘). */
  messages: BaseMessage[];
  /** 그래프가 실제로 뭘 했는지 — 챗에서도 스텝·채널을 볼 수 있게. */
  steps: StepUpdate<ChatState>[];
}

/** 챗 그래프의 상태. `turns`는 루프, `tasks`는 분업 모양에서만 쓰인다. */
interface ChatState extends MessagesState {
  turns: number;
  tasks: string[];
}

const chatSchema: StateSchema<ChatState> = {
  ...messagesSchema,
  turns: { reducer: (a: number, b: number) => a + b },
};

export type ShapeId = "single" | "chain" | "parallel" | "loop" | "dispatch" | "tools";

/**
 * 챗에서 모델이 쓸 수 있는 툴. 데모 셋(`add`·`multiply`·`now`)을 그대로 쓴다.
 *
 * `now`가 있는 게 중요하다 — **모델이 혼자서는 못 하는 일**이라 "지금 몇 시야?"를 물으면
 * 툴을 안 부르고는 답할 수가 없다. 산술 둘은 한 턴에 호출 여럿이 나가는 걸 보여준다.
 */
const CHAT_TOOL_SPECS: ToolSpecShape[] = toolSpecs(DEMO_TOOLS);

/**
 * 몇 번째 모델 호출까지 툴을 쥐여줄 것인가.
 *
 * **조건부 엣지로 루프를 끊지 않는 이유가 여기 있다.** 툴 호출이 실린 AI 메시지를 남긴 채
 * 끊으면 답 없는 `tool_use`가 이력에 남고, 그 이력을 그대로 싣는 **다음 턴이 400**이다.
 * 대신 마지막 호출에는 툴 선언을 **안 준다** — 못 부르니 산문으로 답하고, `toolsCondition`이
 * 자연히 END를 골라 이력이 항상 온전한 상태로 끝난다.
 */
const MAX_TOOL_ROUNDS = 2;

/**
 * 챗이 돌 수 있는 **그래프 모양들**.
 *
 * 대화 내용이 아니라 **엔진 개념**을 하나씩 보여주려고 골랐다. 같은 질문을 던져도
 * 오른쪽 패널의 스텝 수와 병렬 여부가 달라지는 걸 눈으로 보라는 취지다.
 */
export const SHAPES: Array<{ id: ShapeId; name: string; description: string; calls: number }> = [
  {
    id: "single",
    name: "단일 호출",
    description: "START→model→END. 가장 단순한 모양. 스텝 1개.",
    calls: 1,
  },
  {
    id: "chain",
    name: "초안 → 다듬기",
    description:
      "draft→revise. 모델을 두 번 부르는 **선형 다단계**. 스텝이 2개로 늘고, 두 번째 노드는 첫 번째의 출력을 이미 반영된 상태로 읽는다(BSP).",
    calls: 2,
  },
  {
    id: "parallel",
    name: "병렬 두 관점",
    description:
      "START→{plain, critical}→END. 두 노드가 **한 슈퍼스텝에 병렬**로 돌고, 두 쓰기를 messages 리듀서가 합친다(V4). 패널에 'Step 0: plain · critical'로 뜬다.",
    calls: 2,
  },
  {
    id: "loop",
    name: "자기 루프 (2턴)",
    description:
      "model이 자기 자신을 가리키는 조건부 엣지(V5). 매 턴 이전 대화 전체가 실려 가고 messages가 누적된다.",
    calls: 2,
  },
  {
    id: "dispatch",
    name: "분업 (Send 팬아웃)",
    description:
      "dispatch가 요청을 하위 작업 N개로 쪼개고, **각 워커가 자기 몫만** 받아 처리한다(V6 Send). 병렬과 다른 점: 병렬은 '같은 질문에 두 관점', 이건 '다른 작업을 각자 담당'이다. 워커 수는 런타임에 정해진다.",
    calls: 3,
  },
  {
    id: "tools",
    name: "툴 사용 (ReAct)",
    description:
      "model ⇄ tools 루프(F2). 모델에게 add·multiply·now 선언을 실어 보내면 **모델이 필요한 걸 직접 골라** 부르고, toolNode가 zod로 인자를 검증해 실행한 뒤 결과를 들려 다시 model로 보낸다. 몇 번 도는지는 모델이 정한다 — 툴을 안 쓰면 스텝 1개로 끝난다. '지금 몇 시야?'나 '3+4랑 5×6'을 물어보라. **claude-code는 못 쓴다**(와이어에 툴 선언을 실을 자리가 없다).",
    calls: 2,
  },
];

/**
 * 디스패처가 내놓은 텍스트에서 하위 작업 목록을 꺼낸다.
 * 모델이 JSON을 안 줄 수 있으므로 **실패하면 통째로 하나**로 취급한다(조용히 죽지 않게).
 */
export function parseTasks(text: string, fallback: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const parsed: unknown = JSON.parse(match[0]);
      const items = Array.isArray(parsed)
        ? parsed.filter((t): t is string => typeof t === "string" && t.trim() !== "")
        : [];
      if (items.length > 0) return items.slice(0, 4); // 폭주 방지
    } catch {
      // 아래 폴백으로
    }
  }
  return [fallback];
}

/** 모양 하나를 그래프로 세운다. `spec`이 없으면 노드가 없는 **구조만** 필요한 경우다. */
export function buildChatGraph(shape: ShapeId, spec?: string, options: { system?: string } = {}) {
  // spec이 없으면 그림용이다 — 진짜 모델 대신 자리표시자를 꽂는다(자격증명이 필요 없게).
  const ask = async (msgs: BaseMessage[], sys: string, tools?: ToolSpecShape[]) =>
    spec === undefined
      ? ai("(미리보기)")
      : model(spec, sys === "" ? {} : { system: sys }).invoke(
          msgs,
          // 툴을 쓰는 모양에서만 선언을 싣는다. **여기가 두 링이 실제로 만나는 유일한 자리**다 —
          // `@ariadne/tools`의 ToolSpecShape가 `@ariadne/model`의 ToolSpec로 통하는지
          // 기계적으로 검사하는 게 이 파일의 tsc다(둘은 서로를 import하지 않는다).
          tools === undefined ? {} : { tools },
        );

  /** **답변하는** 노드용. 사용자 System 프롬프트를 물려받는다. */
  const call = (msgs: BaseMessage[], nudge?: string, tools?: ToolSpecShape[]) =>
    ask(msgs, [options.system, nudge].filter(Boolean).join("\n\n"), tools);

  /**
   * **제어하는** 노드용(디스패처 등). 답변이 아니라 **계획**을 받아낸다.
   *
   * 사용자 System을 **안 물려받는다** — "두 문장 이내" 같은 답변 지시가 계획 형식과
   * 충돌해 실제로 계획이 깨졌다.
   *
   * (한때는 지시를 사용자 턴에 넣어야 먹혔다. claude-code 어댑터가 하네스 컨텍스트를
   * 1만 토큰이나 싣고 있어 지시가 묻혔기 때문인데, `--tools ""`로 격리한 뒤로는
   * system에 넣어도 3/3으로 듣는다. 증상이 아니라 원인이 고쳐졌으므로 되돌렸다.)
   */
  const plan = (instruction: string, subject: string) => ask([human(subject)], instruction);

  const g = new StateGraph<ChatState>(chatSchema);

  if (shape === "single") {
    g.addNode("model", async (s) => ({ messages: [await call(s.messages)], turns: 1 }));
    g.addEdge(START, "model");
    g.addEdge("model", END);
  } else if (shape === "chain") {
    g.addNode("draft", async (s) => ({ messages: [await call(s.messages)], turns: 1 }));
    g.addNode("revise", async (s) => ({
      messages: [await call(s.messages, "바로 앞 답변을 더 정확하고 간결하게 다시 쓴다.")],
      turns: 1,
    }));
    g.addEdge(START, "draft");
    g.addEdge("draft", "revise");
    g.addEdge("revise", END);
  } else if (shape === "parallel") {
    g.addNode("plain", async (s) => ({ messages: [await call(s.messages)], turns: 1 }));
    g.addNode("critical", async (s) => ({
      messages: [await call(s.messages, "반대 관점이나 놓친 점을 지적한다.")],
      turns: 1,
    }));
    g.addEdge(START, "plain");
    g.addEdge(START, "critical");
    g.addEdge("plain", END);
    g.addEdge("critical", END);
  } else if (shape === "loop") {
    g.addNode("model", async (s) => ({ messages: [await call(s.messages)], turns: 1 }));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", (s) => (s.turns < 2 ? "model" : END), ["model", END]);
  } else if (shape === "tools") {
    // 위 'loop'와 그래프 모양이 거의 같은데 **누가 루프를 끝낼지**가 다르다.
    // loop는 우리가 turns로 세고, 여기선 **모델이 툴을 그만 부르면** 끝난다(그게 ReAct다).
    g.addNode("model", async (s) => ({
      messages: [
        await call(s.messages, undefined, s.turns < MAX_TOOL_ROUNDS ? CHAT_TOOL_SPECS : undefined),
      ],
      turns: 1,
    }));
    // 노드 이름이 "tools"인 건 toolsCondition이 그 문자열을 돌려주기 때문이다.
    g.addNode("tools", toolNode<ChatState>(DEMO_TOOLS));
    g.addEdge(START, "model");
    g.addConditionalEdges("model", toolsCondition, ["tools", END]);
    g.addEdge("tools", "model");
  } else {
    // 분업: dispatch가 일을 쪼개고, Send가 **워커마다 다른 payload**를 실어 보낸다(V6).
    // 병렬 모양과의 차이가 여기다 — 저긴 두 노드가 같은 s.messages를 읽는다.
    g.addNode("dispatch", async (s) => {
      const request = s.messages.at(-1)?.content ?? "";
      const split = await plan(
        "위 요청을 독립적으로 처리할 수 있는 하위 작업 2~3개로 쪼개라. " +
          '설명 없이 JSON 문자열 배열로만 답하라. 예: ["A 조사", "B 조사"]',
        request,
      );
      // 모델이 JSON을 안 줄 수도 있다 — 그때는 통째로 하나(조용히 죽지 않게).
      return { tasks: parseTasks(split.content, request), turns: 1 };
    });

    // **워커는 상태 전체가 아니라 자기 작업만 받는다** — addNode<string>이 그 표시다.
    g.addNode<string>("worker", async (task) => {
      const answer = await call([human(task)], "맡은 작업만 간결하게 처리한다.");
      return { messages: [ai(`[${task}]\n${answer.content}`)], turns: 1 };
    });

    g.addEdge(START, "dispatch");
    g.addConditionalEdges("dispatch", (s) => s.tasks.map((t) => new Send("worker", t)), ["worker"]);
    g.addEdge("worker", END);
  }

  return g.compile();
}

/**
 * 한 턴 대화. **그래프로 돈다.**
 *
 * 이력 전체를 매번 받는다(API가 stateless인 것과 같은 이유). 새로 생긴 메시지만
 * 골라 돌려주므로 클라이언트는 그걸 이어붙이면 된다.
 */
export async function chatTurn(
  spec: string,
  history: BaseMessage[],
  options: { system?: string; shape?: ShapeId } = {},
): Promise<ChatReply> {
  const graph = buildChatGraph(
    options.shape ?? "single",
    spec,
    options.system === undefined ? {} : { system: options.system },
  );

  const steps: StepUpdate<ChatState>[] = [];
  for await (const step of graph.stream({ messages: history, turns: 0, tasks: [] })) {
    steps.push(step);
  }

  const final = steps.at(-1)?.state.messages ?? history;
  return { messages: final.slice(history.length), steps };
}
