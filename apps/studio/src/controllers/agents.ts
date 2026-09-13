import type { BaseMessage, ChannelCheckpoint } from "@ariadne/core";
import { BadRequestError } from "../errors";
import type { Handler } from "../http/router";
import type { AgentService, TurnInput } from "../services/types";

/**
 * 에이전트 컨트롤러 — 요청을 **읽고 검증해** 서비스 입력으로 바꾸고, 결과를 JSON으로 싼다.
 * 비즈니스 규칙은 없다. 실패는 던지기만 하고 상태 코드는 라우터가 정한다.
 */

export function agentsController(service: AgentService): {
  list: Handler;
  graph: Handler;
  chat: Handler;
} {
  return {
    list: () => Response.json(service.list()),
    graph: (_req, url) => Response.json(service.graph(url.searchParams.get("id") ?? "")),
    async chat(req) {
      const { id, input } = parseChatBody(await readJson(req));
      return Response.json(await service.turn(id, input));
    },
  };
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("입력 JSON 파싱 실패");
  }
}

/** `POST /api/agents/chat` 본문의 검증. 순수 함수라 HTTP 없이 테스트된다. */
export function parseChatBody(raw: unknown): { id: string; input: TurnInput } {
  const body = (raw ?? {}) as {
    id?: string;
    messages?: BaseMessage[];
    decision?: string;
    checkpoint?: ChannelCheckpoint;
  };
  // 체크포인트가 있으면 **빈 입력이 정당하다** — 이력은 복원에서 오고, 승인 재개처럼
  // 새로 보낼 말이 없는 턴도 있다. 없을 때만 예전 규약(이력 전체)을 강제한다.
  if (!Array.isArray(body.messages) || (body.messages.length === 0 && !body.checkpoint)) {
    throw new BadRequestError("messages가 필요하다");
  }
  // 'ask'는 받지 않는다 — 사람에게 묻겠다는 뜻인데 보낸 쪽이 이미 사람이라 무한 왕복이 된다.
  const { decision } = body;
  if (decision !== undefined && decision !== "allow" && decision !== "deny") {
    throw new BadRequestError("decision은 allow 또는 deny다");
  }
  return {
    id: body.id ?? "",
    input: {
      messages: body.messages,
      ...(decision === undefined ? {} : { decision }),
      ...(body.checkpoint === undefined ? {} : { checkpoint: body.checkpoint }),
    },
  };
}
