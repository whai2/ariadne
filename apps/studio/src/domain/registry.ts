import { connectStdio, type McpClient, mcpTools, type StdioServerConfig } from "@ariadne/mcp";
import type { AnyTool } from "@ariadne/tools";

/**
 * 에이전트 선언. **등록 목록엔 데이터만, 살아있는 것은 부팅 코드에** (S12) —
 * `approval`은 문자열 배열이고 `askFor`는 `buildAgentGraph`에서, `mcp`는 선언이고 연결은
 * `connectMcpAgents`에서 생긴다.
 */
export interface AgentDef {
  id: string;
  name: string;
  description: string;
  model: string;
  tools: AnyTool[];
  system?: string;
  maxToolRounds?: number;
  mcp?: StdioServerConfig;
  mcpServerName?: string;
  mcpError?: string;
  approval?: string[];
  /**
   * 대화 말고 **채널을 하나 더** 두는 데모 (F5.2). 매 턴 1씩 쓴다.
   *
   * 숫자만 적는다 — 리듀서를 만드는 건 `buildAgentGraph`다(`approval`이 문자열 배열이고
   * `askFor`가 부팅 코드에 있는 것, `mcp`가 선언이고 연결이 `connectMcpAgents`인 것과 같은 모양).
   */
  budget?: number;
}

export const agents: AgentDef[] = [
  {
    id: "mcp",
    name: "MCP 에이전트 (데모 서버)",
    description:
      "툴이 로컬이 아니라 외부 MCP 서버에서 온다. 스튜디오가 시작할 때 우리 데모 서버(자식 프로세스, JSON-RPC)에 붙어 get_weather·word_count·write_note를 끌어왔다. 값은 결정론적 가짜라 오프라인·키 없이 돈다. 쓰기(write_note)만 승인 게이트가 잡는다 — 그 거부가 기억의 재료가 된다.",
    model: "claude-code/sonnet",
    tools: [],
    mcp: { command: process.execPath, args: [`${import.meta.dir}/../../mcp-servers/demo.ts`] },
    system: "너는 비서다. 날씨·단어 수·메모 저장이 필요하면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 3,
    approval: ["write_note"],
    budget: 5,
  },
  {
    id: "filesystem",
    name: "파일시스템 에이전트 (진짜 기성 MCP)",
    description:
      "남이 만든 진짜 서버 `@modelcontextprotocol/server-filesystem`(공식 레퍼런스)에 npx로 붙는다. 파일을 바꾸는 툴은 승인 게이트가 잡고, 승인 전에는 디스크에 아무 일도 안 일어난다. 범위는 `apps/studio/mcp-sample/` 폴더로 좁혀둔다. 첫 실행은 npx가 서버를 내려받아 몇 초 걸리고 네트워크가 필요하다.",
    model: "claude-code/sonnet",
    tools: [],
    mcp: {
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        `${import.meta.dir}/../../mcp-sample`,
      ],
    },
    system: "너는 파일 비서다. 파일을 읽거나 쓰려면 툴을 쓰고, 답은 간결하게 한국어로.",
    maxToolRounds: 4,
    approval: ["write_file", "edit_file", "create_directory", "move_file"],
  },
];

export async function connectMcpAgents(): Promise<() => Promise<void>> {
  const clients: McpClient[] = [];
  for (const def of agents) {
    if (def.mcp === undefined) continue;
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
