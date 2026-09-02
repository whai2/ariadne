import type { CompiledGraph, StepUpdate } from "@ariadne/core";
import { PAGE } from "./page";

export interface Studio {
  /** Bun.serve의 fetch로 바로 넘길 수 있고, 테스트에서 직접 호출도 된다. */
  fetch(req: Request): Promise<Response>;
}

/**
 * 컴파일된 그래프 하나를 관찰하는 최소 스튜디오.
 * - GET  /            → 브라우저 UI(HTML)
 * - GET  /api/graph   → 그래프 구조(getGraph)
 * - POST /api/run     → 입력으로 stream을 돌려 스텝별 상태 반환
 */
export function createStudio<S extends object>(compiled: CompiledGraph<S>): Studio {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(PAGE, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/graph") {
        return Response.json(compiled.getGraph());
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        let input: S;
        try {
          input = (await req.json()) as S;
        } catch {
          return Response.json({ error: "입력 JSON 파싱 실패" }, { status: 400 });
        }
        const steps: StepUpdate<S>[] = [];
        try {
          for await (const step of compiled.stream(input)) {
            steps.push(step);
          }
        } catch (e) {
          return Response.json({ error: String(e), steps }, { status: 500 });
        }
        return Response.json({ steps });
      }

      return new Response("Not found", { status: 404 });
    },
  };
}
