import { BadRequestError } from "../errors";
import type { Handler } from "../http/router";
import type { ThreadService, TurnInput } from "../services/types";

async function body(req: Request): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new BadRequestError("입력 JSON 파싱 실패");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new BadRequestError("JSON 객체가 필요하다");
  return raw as Record<string, unknown>;
}

export function parseTurn(raw: Record<string, unknown>): TurnInput {
  if (Object.keys(raw).some((key) => key !== "message" && key !== "decision")) {
    throw new BadRequestError("message 또는 decision만 전달하세요");
  }
  if (
    typeof raw.message === "string" &&
    raw.message.trim().length > 0 &&
    raw.decision === undefined
  ) {
    return { message: raw.message };
  }
  if ((raw.decision === "allow" || raw.decision === "deny") && raw.message === undefined) {
    return { decision: raw.decision };
  }
  throw new BadRequestError("새 message 또는 decision(allow/deny) 중 하나가 필요하다");
}

export function threadsController(service: ThreadService): {
  create: Handler;
  get: Handler;
  send: Handler;
} {
  return {
    async create(req) {
      const raw = await body(req);
      if (
        typeof raw.agentId !== "string" ||
        !raw.agentId ||
        Object.keys(raw).some((k) => k !== "agentId")
      ) {
        throw new BadRequestError("agentId가 필요하다");
      }
      return Response.json(service.create(raw.agentId), { status: 201 });
    },
    get: (_req, _url, params) => Response.json(service.get(params.id ?? "")),
    async send(req, _url, params) {
      return Response.json(await service.send(params.id ?? "", parseTurn(await body(req))));
    },
  };
}
