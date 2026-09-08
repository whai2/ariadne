// 등록된 에이전트들 (S9). **Mastra 플레이그라운드 대응** — 여기 배열에 얹으면 사이드바에 뜬다.
//
// 각 항목은 `@ariadne/agent`의 `createAgent`가 받는 설정 그대로다. "에이전트 등록"이란
// 결국 model+tools+system 한 벌을 이름 붙여 두는 것뿐이고, 스튜디오는 고를 때마다
// `createAgent`로 **그래프를 세워** 대화·관찰한다(F3.1이 준 표면).

import {
  type Approval,
  type ApprovalPolicy,
  askFor,
  createAgent,
  pendingToolCalls,
} from "@ariadne/agent";
import type {
  BaseMessage,
  CompiledGraph,
  MessagesState,
  StepUpdate,
  ToolCall,
} from "@ariadne/core";
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
  /**
   * 사람의 승인이 있어야 도는 툴 이름들 (F3.3). 여기 이름이 하나라도 낀 묶음은 **실행 전에
   * 멈추고** 사용자에게 물어본다.
   *
   * **문자열 배열인 게 판단이다.** 링의 `ApprovalPolicy`는 함수인데, 등록 목록은 사이드바로
   * 직렬화돼 나가야 하므로(`AgentInfo`) 여기선 **선언**만 둔다. 함수로 바꾸는 건
   * `buildAgentGraph` 한 곳뿐이다 — `mcp` 필드가 선언이고 `connectMcpAgents`가 연결로 바꾸는
   * 것과 같은 모양(S11).
   */
  approval?: string[];
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
    system: "너는 비서다. 날씨·단어 수·메모 저장이 필요하면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 3,
    // 읽기(get_weather·word_count)는 조용히 돌고 **쓰기만 사람을 부른다.** "메모 저장해줘"라고
    // 하면 툴 직전에 멈추는 걸 오프라인에서 볼 수 있다.
    approval: ["write_note"],
  },
  {
    id: "filesystem",
    name: "파일시스템 에이전트 (진짜 기성 MCP)",
    description:
      "우리 데모가 아니라 **남이 만든 진짜 서버** `@modelcontextprotocol/server-filesystem`(공식 레퍼런스)에 npx로 붙는다. 여기 뜨는 read_text_file·list_directory·edit_file 등은 전부 그 서버가 준 것이고, 우리 클라이언트가 진짜 세상의 MCP 생태계에 그대로 붙는다는 증거다. **파일을 바꾸는 툴은 승인 게이트가 잡는다**(F3.3) — 모델이 write_file·edit_file을 부르면 실행 직전에 멈추고 여기 승인 버튼이 뜬다. 승인 전에는 디스크에 아무 일도 안 일어난다. 범위는 여전히 `apps/studio/mcp-sample/` 폴더로 좁혀둔다(게이트가 생겼어도 이중 방어는 남긴다). **첫 실행은 npx가 서버를 내려받아 몇 초 걸리고 네트워크가 필요하다.**",
    model: "claude-code/sonnet",
    tools: [], // connectMcpAgents가 시작 시 채운다(서버가 14개쯤 준다).
    mcp: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", `${import.meta.dir}/../mcp-sample`],
    },
    system: "너는 파일 비서다. 파일을 읽거나 쓰려면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 4,
    // 이 서버가 주는 **쓰기 계열 전부**. 목록을 손으로 적는 게 정직하다 — 서버가 어느 툴이
    // 위험한지 안 알려주므로(MCP에 그런 필드가 없다) 판단은 우리 몫이다.
    approval: ["write_file", "edit_file", "create_directory", "move_file"],
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
  /** 승인이 필요한 툴 이름들. UI가 그 툴 칩에 자물쇠를 단다. */
  approval?: string[];
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
    // 실제로 붙은 툴 중에서만 추린다 — MCP 서버가 안 떠서 툴이 비면 "승인 필요"도 거짓말이 된다.
    ...(def.approval === undefined
      ? {}
      : { approval: def.approval.filter((n) => def.tools.some((t) => t.name === n)) }),
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
 * 선언(`def.approval`)을 링이 받는 정책 함수로 바꾼다 (F3.3).
 *
 * **`decision`은 대기 중이던 그 묶음에만 쓰고 버린다.** 재개하면 START가 `tools`로 들어가므로
 * 게이트의 **첫 호출이 곧 사람이 답한 그 묶음**이다. 계속 물려두면 같은 run 안에서 모델이 또
 * 위험한 툴을 불러도 안 물어보게 된다 — 한 번의 승인이 그 뒤를 전부 열어주는 건 게이트가 아니다.
 *
 * 클로저 상태가 요청 사이에 새지 않는 건 `agentTurn`이 **매 턴 그래프를 새로 세우기** 때문이다.
 */
function approvalPolicy(names: string[], decision?: Approval): ApprovalPolicy {
  const gate = askFor(names);
  let once = decision;
  return (calls) => {
    if (once === undefined) return gate(calls);
    const answer = once;
    once = undefined;
    return answer;
  };
}

/**
 * 에이전트를 그래프로 세운다. `preview`면 자리표시자 모델로(자격증명 없이 구조만),
 * 아니면 진짜 모델로. **툴이 있으면 promptedTools를 켠다** — 네이티브 어댑터는 무시하고
 * claude-code만 프롬프트로 흉내 낸다(그래서 claude-code 에이전트도 툴을 쓴다, F2.4).
 *
 * `decision`은 승인/거부로 **재개**할 때만 준다.
 */
export function buildAgentGraph(
  def: AgentDef,
  preview = false,
  decision?: Approval,
): CompiledGraph<MessagesState> {
  const chatModel = preview
    ? previewModel
    : model(def.model, { promptedTools: def.tools.length > 0 });
  // 승인 선언은 있는데 툴이 안 붙었으면(MCP 서버가 안 뜬 경우) 게이트를 안 건다 —
  // 링이 `ApprovalWithoutToolsError`로 던지기 때문이고, 그게 맞다(감쌀 게 없다).
  const gated = def.tools.length > 0 && (def.approval?.length ?? 0) > 0;
  return createAgent({
    model: chatModel,
    tools: def.tools,
    ...(def.system === undefined ? {} : { system: def.system }),
    ...(def.maxToolRounds === undefined ? {} : { maxToolRounds: def.maxToolRounds }),
    ...(gated ? { approval: approvalPolicy(def.approval ?? [], decision) } : {}),
  });
}

export interface AgentReply {
  messages: BaseMessage[];
  steps: StepUpdate<MessagesState>[];
  /**
   * 승인을 기다리며 멈춘 툴 호출들 (F3.3). 비어 있지 않으면 UI가 승인/거부 버튼을 띄운다.
   *
   * **이게 "멈춤"의 유일한 신호다.** 멈추면 새 메시지가 하나도 안 늘어나므로, 이 필드가 없으면
   * 클라이언트는 빈 응답과 구별할 수 없다.
   */
  pending: ToolCall[];
}

/**
 * 이 에이전트로 한 턴. 챗과 같은 규약 — 이력 전체를 받고 **새로 생긴 메시지만** 돌려준다
 * (클라이언트가 이어붙인다). 스텝을 같이 실어 오른쪽에 엔진이 한 일을 그린다.
 *
 * **재개도 같은 함수다.** `decision`을 주면 이력 끝에 걸린 대기 묶음을 승인/거부하고 이어 돈다 —
 * 새 엔드포인트도, 세션 id도, 서버 쪽 상태도 없다. 그럴 수 있는 건 이 에이전트의 상태가
 * 전부 `messages`이고 그걸 **클라이언트가 쥐고 있어서**다(F3.3 노트).
 */
export async function agentTurn(
  def: AgentDef,
  history: BaseMessage[],
  decision?: Approval,
): Promise<AgentReply> {
  const graph = buildAgentGraph(def, false, decision);
  const steps: StepUpdate<MessagesState>[] = [];
  for await (const step of graph.stream({ messages: history })) {
    steps.push(step);
  }
  const final = steps.at(-1)?.state.messages ?? history;
  return { messages: final.slice(history.length), steps, pending: pendingToolCalls(final) };
}
