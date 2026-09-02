import type { StepUpdate } from "@ariadne/core";
import type { Example } from "./examples";
import { PAGE } from "./page";

export interface Studio {
  /** Bun.serve의 fetch로 바로 넘길 수 있고, 테스트에서 직접 호출도 된다. */
  fetch(req: Request): Promise<Response>;
}

/**
 * 여러 예제 그래프를 관찰하는 최소 스튜디오.
 * - GET  /              → 브라우저 UI(HTML)
 * - GET  /api/examples  → 예제 목록(id/name/description/sampleInput)
 * - GET  /api/graph?id  → 그 예제의 구조(getGraph)
 * - POST /api/run       → { id, input }으로 stream을 돌려 스텝별 상태/채널 반환
 */
export function createStudio(examples: Example[]): Studio {
  const byId = new Map(examples.map((e) => [e.id, e]));
  const first = examples[0];

  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(PAGE, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/examples") {
        return Response.json(
          examples.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            sampleInput: e.sampleInput,
          })),
        );
      }

      if (req.method === "GET" && url.pathname === "/api/graph") {
        const ex = byId.get(url.searchParams.get("id") ?? "") ?? first;
        if (ex === undefined) {
          return Response.json({ error: "예제가 없다" }, { status: 404 });
        }
        return Response.json(ex.graph.getGraph());
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        let body: { id?: string; input?: Record<string, unknown> };
        try {
          body = (await req.json()) as { id?: string; input?: Record<string, unknown> };
        } catch {
          return Response.json({ error: "입력 JSON 파싱 실패" }, { status: 400 });
        }
        const ex = byId.get(body.id ?? "") ?? first;
        if (ex === undefined) {
          return Response.json({ error: "예제가 없다" }, { status: 404 });
        }
        const steps: StepUpdate<Record<string, unknown>>[] = [];
        try {
          for await (const step of ex.graph.stream(body.input ?? {})) {
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
