import { BadRequestError, NotFoundError } from "../errors";

/**
 * 라우터 — `(method, path)` → 핸들러 표 하나와, **실패를 상태 코드로 옮기는 유일한 자리.**
 * 컨트롤러·서비스는 `try`를 안 쓴다. 던지면 여기서 400/404/500으로 갈린다.
 */

export type Handler = (
  req: Request,
  url: URL,
  params: Record<string, string>,
) => Response | Promise<Response>;

export interface Route {
  method: "GET" | "POST";
  path: string;
  handler: Handler;
}

export function createRouter(
  routes: readonly Route[],
  fallback: Handler,
): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    try {
      const parts = url.pathname.split("/");
      for (const route of routes) {
        const pattern = route.path.split("/");
        if (route.method !== req.method || pattern.length !== parts.length) continue;
        const params: Record<string, string> = {};
        const matches = pattern.every((segment, i) => {
          const value = parts[i] ?? "";
          if (!segment.startsWith(":")) return segment === value;
          if (!value) return false;
          try {
            params[segment.slice(1)] = decodeURIComponent(value);
          } catch {
            throw new BadRequestError("잘못된 경로 인코딩");
          }
          return true;
        });
        if (matches) return await route.handler(req, url, params);
      }
      return await fallback(req, url, {});
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function errorResponse(e: unknown): Response {
  if (e instanceof BadRequestError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof NotFoundError) return Response.json({ error: e.message }, { status: 404 });
  // 나머지는 실행 실패(키가 없거나 모델 호출이 깨졌다) — 이유를 그대로 싣는다.
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return Response.json({ error: message }, { status: 500 });
}
