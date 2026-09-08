// 등록된 에이전트들 (S9). **Mastra 플레이그라운드 대응** — 여기 배열에 얹으면 사이드바에 뜬다.
//
// 각 항목은 `@ariadne/agent`의 `createAgent`가 받는 설정 그대로다. "에이전트 등록"이란
// 결국 model+tools+system 한 벌을 이름 붙여 두는 것뿐이고, 스튜디오는 고를 때마다
// `createAgent`로 **그래프를 세워** 대화·관찰한다(F3.1이 준 표면).

import { createAgent } from "@ariadne/agent";
import type { BaseMessage, CompiledGraph, MessagesState, StepUpdate } from "@ariadne/core";
import { connectStdio, type McpClient, mcpTools, type StdioServerConfig } from "@ariadne/mcp";
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
  /**
   * 부를 수 있는 툴. 비우면 단발 호출 에이전트가 된다.
   * **MCP 에이전트는 여기가 처음엔 비어 있다** — `connectMcpAgents`가 시작 시 채운다.
   */
  tools: AnyTool[];
  system?: string;
  maxToolRounds?: number;
  /**
   * 붙을 MCP 서버(있으면). 스튜디오가 시작할 때 `connectMcpAgents`가 이 서버에 붙어
   * `tools`를 채운다 — 채운 뒤로는 로컬 툴과 구분이 없다(툴 정의의 두 번째 입구).
   */
  mcp?: StdioServerConfig;
  /** `connectMcpAgents`가 채운다 — 실제로 붙은 서버 이름(serverInfo). UI가 출처를 보여줄 때 쓴다. */
  mcpServerName?: string;
  /** `connectMcpAgents`가 채운다 — 붙기 실패했다면 그 이유(네트워크·npx 없음 등). */
  mcpError?: string;
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
  {
    id: "mcp",
    name: "MCP 에이전트 (데모 서버)",
    description:
      "툴이 **로컬이 아니라 외부 MCP 서버**에서 온다. 스튜디오가 시작할 때 우리 데모 서버(자식 프로세스, JSON-RPC)에 붙어 get_weather·word_count를 끌어왔다 — 우리가 zod로 한 줄도 안 적은 툴이다. 값은 결정론적 가짜라 오프라인·키 없이 돈다(검증 대상이 데이터가 아니라 프로토콜이라서). 그래프도, 툴 칩도, 실행도 계산기 에이전트와 똑같다: model ⇄ tools 루프가 우리 엔진 안에서 돌고, 툴이 원격인 걸 노드도 엔진도 모른다.",
    model: "claude-code/sonnet",
    tools: [], // connectMcpAgents가 시작 시 채운다.
    mcp: { command: process.execPath, args: [`${import.meta.dir}/mcp-demo-server.ts`] },
    system: "너는 비서다. 날씨나 단어 수가 필요하면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 3,
  },
  {
    id: "filesystem",
    name: "파일시스템 에이전트 (진짜 기성 MCP)",
    description:
      "우리 데모가 아니라 **남이 만든 진짜 서버** `@modelcontextprotocol/server-filesystem`(공식 레퍼런스)에 npx로 붙는다. 여기 뜨는 read_text_file·list_directory·edit_file 등은 전부 그 서버가 준 것이고, 우리 클라이언트가 진짜 세상의 MCP 생태계에 그대로 붙는다는 증거다. 안전을 위해 `apps/studio/mcp-sample/` 폴더만 열어준다(그 서버는 파일을 바꾸는 툴도 주는데 아직 승인 게이트가 없다 — ROADMAP의 다음 단계). **첫 실행은 npx가 서버를 내려받아 몇 초 걸리고 네트워크가 필요하다.**",
    model: "claude-code/sonnet",
    tools: [], // connectMcpAgents가 시작 시 채운다(서버가 14개쯤 준다).
    mcp: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", `${import.meta.dir}/../mcp-sample`],
    },
    system: "너는 파일 비서다. 파일을 읽거나 목록이 필요하면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 4,
  },
];

/**
 * 시작 시 한 번. `mcp`가 걸린 에이전트마다 서버에 붙어 그 툴을 `tools`에 채운다.
 *
 * **핵심은 "채운 뒤로는 아무것도 안 바뀐다"이다.** `agentInfo`·`buildAgentGraph`·`agentTurn`은
 * MCP를 전혀 모르고 그냥 `def.tools`를 읽는다 — 그래서 여기만 두 링(mcp·agent)을 다 안다.
 *
 * **연결 수명은 스튜디오가 쥔다.** 반환된 함수를 종료 시 부르면 서버 프로세스가 정리된다.
 * 이 상태(살아있는 자식 프로세스)가 에이전트가 아니라 **연결**에 있다는 걸 그대로 보여준다 —
 * 그래서 `createAgent`는 여전히 상태 없는 함수로 남는다.
 */
export async function connectMcpAgents(): Promise<() => Promise<void>> {
  const clients: McpClient[] = [];
  for (const def of agents) {
    if (def.mcp === undefined) continue;
    // **한 서버가 안 떠도 스튜디오는 뜬다.** 기성 서버는 npx 다운로드·네트워크가 필요해서
    // 오프라인이면 여기서 던진다 — 그 하나만 건너뛰고(에러를 UI에 남기고) 나머지는 살린다.
    // 데모 서버는 로컬이라 거의 안 실패하지만, 규칙은 둘에 똑같이 건다.
    try {
      const client = await connectStdio(def.mcp);
      clients.push(client);
      def.tools.push(...(await mcpTools(client)));
      def.mcpServerName = client.serverInfo.name;
    } catch (e) {
      def.mcpError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn(`[mcp] '${def.id}' 붙기 실패 — 이 에이전트는 툴 없이 뜬다.\n${def.mcpError}`);
    }
  }
  return async () => {
    for (const client of clients) await client.close();
  };
}

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
  /** 툴이 온 MCP 서버 이름(있으면). 툴이 외부에서 왔음을 UI가 배지로 표시한다. */
  mcpServer?: string;
  /** MCP 서버 연결이 실패했다면 그 이유(있으면). UI가 경고로 보여준다. */
  mcpError?: string;
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
    ...(def.mcpServerName === undefined ? {} : { mcpServer: def.mcpServerName }),
    ...(def.mcpError === undefined ? {} : { mcpError: def.mcpError }),
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
