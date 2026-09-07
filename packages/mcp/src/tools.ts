// MCP 서버의 툴 → 우리 툴 링의 `Tool` (F3.2). **이 파일이 이 링의 전부다.**
//
// 여기서 드러난 게 이 단계의 발견이다: **`Tool` 인터페이스가 한 글자도 안 바뀐다.**
// 계획 단계에선 전제 둘이 깨질 줄 알았는데, 재보니 하나만 깨진다.
//
//   ① 파생 방향 — `defineTool`은 zod에서 JSON Schema를 뽑는다. MCP는 **거꾸로**다.
//      서버가 준 JSON Schema가 원본이고, zod는 검증용으로 **되돌려 만든다**(`z.fromJSONSchema`).
//      그래서 `Tool`의 두 필드(`schema`·`spec`)를 이 파일은 `defineTool`을 안 거치고 직접 채운다 —
//      그게 두 필드가 애초에 따로 있는 이유이기도 하다.
//   ② 실행 위치 — 로컬 함수가 아니라 다른 프로세스로 가는 RPC다. 그런데 `execute`의 반환이
//      `unknown`이고 toolNode가 `await`하므로 **비동기 원격 호출이 계약에 이미 들어맞았다.**
//      깨질 줄 알았던 전제가 안 깨진 자리다.
//
// 그 결과 `toolNode`·`toolsCondition`·`createAgent`·엔진이 **전부 무수정**이다. MCP 툴은
// 로컬 툴과 구분 없이 같은 배열에 담긴다 — 그게 "툴 정의의 두 번째 입구"라는 말의 뜻이다.

import { Command, type MessagesState, tool as toolMessage } from "@ariadne/core";
import type { AnyTool, JSONSchemaObject, ToolContext } from "@ariadne/tools";
import { z } from "zod";
import type { McpClient, McpContentBlock, McpToolDef } from "./client";
import { McpToolSchemaError } from "./errors";

/**
 * content 블록들을 **모델이 읽을 문자열 하나**로 편다.
 *
 * `ToolMessage.content`가 string이라(F2.1이 넓히지 않기로 한 그 결정) 여기서 접어야 한다.
 * 텍스트가 아닌 블록은 **버리지 않고 표식을 남긴다** — 조용히 사라지면 모델은 툴이 빈 답을
 * 줬다고 믿고 같은 툴을 다시 부른다. 이미지가 진짜로 필요해지면 그때 `content`를 넓힌다
 * (F2.1이 적어둔 멀티모달 빚이 여기서 두 번째로 청구된다).
 */
export function renderContent(blocks: readonly McpContentBlock[] | undefined): string {
  if (blocks === undefined || blocks.length === 0) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }
    // 내장 리소스는 텍스트를 들고 있을 때가 많다 — 있으면 그건 진짜 내용이다.
    if (block.type === "resource") {
      const resource = block.resource;
      if (typeof resource === "object" && resource !== null) {
        const text = (resource as Record<string, unknown>).text;
        if (typeof text === "string") {
          parts.push(text);
          continue;
        }
      }
    }
    const mime = typeof block.mimeType === "string" ? ` ${block.mimeType}` : "";
    parts.push(`[${String(block.type)}${mime}]`);
  }
  return parts.join("\n");
}

/**
 * 서버가 준 JSON Schema → 검증용 zod.
 *
 * **왕복시키지 않는다.** 되돌린 zod에서 JSON Schema를 다시 뽑으면 원본과 달라진다 —
 * 예컨대 `{type:"integer", minimum:1}`이 `maximum: 9007199254740991`을 달고 나온다(실측).
 * 모델에게 보낼 선언은 **서버 원본 그대로**여야 서버가 의도한 계약이 전달된다. zod는 오직
 * "모델이 보낸 인자가 그 계약에 맞나"를 우리 쪽에서 확인하는 데만 쓴다.
 */
function toValidator(def: McpToolDef): z.ZodObject {
  let parsed: unknown;
  try {
    parsed = z.fromJSONSchema(def.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
  } catch (cause) {
    throw new McpToolSchemaError(def.name, cause);
  }
  // 스펙상 inputSchema는 object여야 한다. 아니면 toolNode의 `safeParse`가 인자 객체를 통째로
  // 거부하게 되므로, 조용히 이상해지기 전에 여기서 막는다.
  if (!(parsed instanceof z.ZodObject)) {
    throw new McpToolSchemaError(def.name, new Error("inputSchema가 object 스키마가 아니다"));
  }
  return parsed;
}

/** 서버 툴 선언 하나 → 우리 `Tool` 하나. */
function toTool(client: McpClient, def: McpToolDef): AnyTool {
  const schema = toValidator(def);
  return {
    name: def.name,
    // 모델이 툴을 고르는 근거가 이 문장뿐이다. 서버가 생략하면 title이라도, 그것도 없으면 이름.
    description: def.description ?? def.title ?? def.name,
    schema,
    spec: {
      name: def.name,
      description: def.description ?? def.title ?? def.name,
      parameters: def.inputSchema as JSONSchemaObject,
    },
    async execute(args: Record<string, unknown>, ctx: ToolContext) {
      const result = await client.callTool(def.name, args);
      const text = renderContent(result.content);
      if (result.isError !== true) return text;

      // **`isError`는 던지지 않는다.** F2.2의 정책("툴 본문이 던지면 전파")과 갈리는 지점인데,
      // 갈리는 게 맞다 — MCP는 이 필드를 **모델에게 보여주라고** 만들었다(스펙이 명시한다).
      // 원격 툴의 실패는 우리 버그가 아니라 모델이 다음 수로 고칠 수 있는 사실이다.
      // Command로 돌려주는 건 결과 메시지에 `status: "error"`를 실으려는 것이고, 그러려면
      // 우리가 결과 메시지를 직접 지어야 한다 — `ToolContext.toolCallId`가 있는 이유가 이거다.
      return new Command<MessagesState>({
        update: {
          messages: [toolMessage(ctx.toolCallId, text === "" ? "툴이 실패했다" : text, "error")],
        },
      });
    },
  };
}

/**
 * 서버의 툴 전부를 `Tool[]`로. 그대로 `createAgent`나 `toolNode`에 넣으면 된다.
 *
 * ```ts
 * const server = await connectStdio({ command: "bun", args: ["my-server.ts"] });
 * const agent = createAgent({ model, tools: [...localTools, ...(await mcpTools(server))] });
 * await server.close();
 * ```
 *
 * **이름 충돌은 안 막는다.** 서버 둘이 같은 이름의 툴을 주면 `toolNode`의 Map에서 나중 것이
 * 이긴다. 접두사를 붙이면 모델에게 보이는 이름이 서버 문서와 어긋나므로, 정책을 지금 정하기보다
 * 부딪히는 쪽(두 번째 서버를 붙이는 사람)이 고르게 둔다.
 */
export async function mcpTools(client: McpClient): Promise<AnyTool[]> {
  const defs = await client.listTools();
  return defs.map((def) => toTool(client, def));
}
