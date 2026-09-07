// 등록된 에이전트들 (S9). **Mastra 플레이그라운드 대응** — 여기 배열에 얹으면 사이드바에 뜬다.
//
// 각 항목은 `@ariadne/agent`의 `createAgent`가 받는 설정 그대로다. "에이전트 등록"이란
// 결국 model+tools+system 한 벌을 이름 붙여 두는 것뿐이고, 스튜디오는 고를 때마다
// `createAgent`로 **그래프를 세워** 대화·관찰한다(F3.1이 준 표면).

import { createAgent } from "@ariadne/agent";
import type { BaseMessage, CompiledGraph, MessagesState, StepUpdate } from "@ariadne/core";
import { type ChatModel, model } from "@ariadne/model";
import { type AnyTool, add, multiply, now } from "@ariadne/tools";
import { statusOf } from "./chat";

/** 사이드바에 등록되는 에이전트 하나. `createAgent`의 설정 + 이름/설명. */
export interface AgentDef {
  id: string;
  name: string;
  description: string;
  /** 모델 스펙. `"provider/model"`. 기본은 claude-code라 API 키 없이 돈다. */
  model: string;
  /** 부를 수 있는 툴. 비우면 단발 호출 에이전트가 된다. */
  tools: AnyTool[];
  system?: string;
  maxToolRounds?: number;
}

/**
 * 등록 목록. **claude-code/sonnet이 기본**이라 스튜디오를 열자마자 API 키 없이 대화가 된다.
 * 세 개를 골라 `createAgent`의 서로 다른 얼굴을 보여준다 — 툴 여럿 · 툴 없음 · 툴 하나.
 */
export const agents: AgentDef[] = [
  {
    id: "calculator",
    name: "계산기 에이전트",
    description:
      "add·multiply·now 툴을 든 ReAct 에이전트. '3+4랑 5×6'을 물으면 한 턴에 툴 둘을 병렬로 부르고, 결과를 받아 정리한다. 툴 루프가 우리 그래프 안에서 돈다.",
    model: "claude-code/sonnet",
    tools: [add, multiply, now],
    system: "너는 계산 비서다. 필요하면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 3,
  },
  {
    id: "assistant",
    name: "일반 비서 (툴 없음)",
    description:
      "툴이 없는 에이전트. 같은 createAgent가 단발 호출 그래프(START→model→END)로 접힌다. 툴 유무만으로 그래프 모양이 갈리는 걸 보라.",
    model: "claude-code/sonnet",
    tools: [],
    system: "너는 친절한 한국어 비서다. 두세 문장으로 간결하게 답한다.",
  },
  {
    id: "timekeeper",
    name: "시계 에이전트",
    description:
      "now 툴 하나만 든 에이전트. '지금 몇 시야?'는 모델이 혼자 답할 수 없어 툴을 부를 수밖에 없다 — 툴이 왜 필요한지 가장 또렷하게 보여준다.",
    model: "claude-code/sonnet",
    tools: [now],
    system: "너는 시간을 알려주는 비서다. 시각을 물으면 now 툴을 쓴다.",
    maxToolRounds: 2,
  },
];

/** 사이드바·상세 패널이 읽을 직렬화 가능한 설정. 그래프를 안 세우고도 알 수 있는 것만. */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: string[];
  system?: string;
  maxToolRounds?: number;
  /** 이 프로바이더가 툴을 **네이티브로** 실을 수 있나(claude-code면 false=프롬프트 흉내). */
  toolsNative: boolean;
  /** 지금 이 환경에서 모델을 바로 부를 수 있나. */
  ready: boolean;
  /** 준비가 안 됐다면 무엇이 필요한지. */
  need: string;
}

export function agentInfo(
  def: AgentDef,
  env: Record<string, string | undefined> = process.env,
): AgentInfo {
  // 모델 스펙의 프로바이더로 상태를 본다 — 챗 드롭다운과 같은 판정을 재사용한다.
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
    ready: status?.ready ?? false,
    need: status?.need ?? "알 수 없는 프로바이더",
  };
}

/** 그림용 자리표시자 모델 — 자격증명을 안 만진다. 그래프 구조는 모델과 무관하다. */
const previewModel: ChatModel = {
  provider: "preview",
  modelId: "preview",
  supportsTools: true,
  async invoke() {
    return { role: "ai", content: "(미리보기)" };
  },
};

/**
 * 에이전트를 그래프로 세운다. `preview`면 자리표시자 모델로(자격증명 없이 구조만),
 * 아니면 진짜 모델로. **툴이 있으면 promptedTools를 켠다** — 네이티브 어댑터는 무시하고
 * claude-code만 프롬프트로 흉내 낸다(그래서 claude-code 에이전트도 툴을 쓴다, F2.4).
 */
export function buildAgentGraph(def: AgentDef, preview = false): CompiledGraph<MessagesState> {
  const chatModel = preview
    ? previewModel
    : model(def.model, { promptedTools: def.tools.length > 0 });
  return createAgent({
    model: chatModel,
    tools: def.tools,
    ...(def.system === undefined ? {} : { system: def.system }),
    ...(def.maxToolRounds === undefined ? {} : { maxToolRounds: def.maxToolRounds }),
  });
}

export interface AgentReply {
  messages: BaseMessage[];
  steps: StepUpdate<MessagesState>[];
}

/**
 * 이 에이전트로 한 턴. 챗과 같은 규약 — 이력 전체를 받고 **새로 생긴 메시지만** 돌려준다
 * (클라이언트가 이어붙인다). 스텝을 같이 실어 오른쪽에 엔진이 한 일을 그린다.
 */
export async function agentTurn(def: AgentDef, history: BaseMessage[]): Promise<AgentReply> {
  const graph = buildAgentGraph(def);
  const steps: StepUpdate<MessagesState>[] = [];
  for await (const step of graph.stream({ messages: history })) {
    steps.push(step);
  }
  const final = steps.at(-1)?.state.messages ?? history;
  return { messages: final.slice(history.length), steps };
}
