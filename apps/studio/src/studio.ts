import type { CompiledGraph, StepUpdate } from "@ariadne/core";
import type { Example } from "./examples";
import { PAGE } from "./page";

/** 에러를 사람이 읽을 수 있게. 스택 대신 메시지만 — 대개 "키가 없다"류다. */
function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

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

  /**
   * 그래프를 만든다. **여기서 처음 만들어진다** — live 예제는 자격증명이 없으면
   * `model()`이 던지는데, import 시점이면 스튜디오가 아예 안 뜬다.
   * 같은 (예제, 모델) 조합은 캐시한다 — 매 요청마다 새로 컴파일할 이유가 없다.
   */
  const cache = new Map<string, CompiledGraph<Record<string, unknown>>>();
  const buildGraph = (ex: Example, spec?: string): CompiledGraph<Record<string, unknown>> => {
    const key = `${ex.id}\u0000${spec ?? ""}`;
    let g = cache.get(key);
    if (g === undefined) {
      g = ex.build(spec);
      cache.set(key, g);
    }
    return g;
  };

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
            live: e.live === true,
          })),
        );
      }

      if (req.method === "GET" && url.pathname === "/api/graph") {
        const ex = byId.get(url.searchParams.get("id") ?? "") ?? first;
        if (ex === undefined) {
          return Response.json({ error: "예제가 없다" }, { status: 404 });
        }
        try {
          return Response.json(
            buildGraph(ex, url.searchParams.get("model") ?? undefined).getGraph(),
          );
        } catch (e) {
          return Response.json({ error: describe(e) }, { status: 400 });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        let body: { id?: string; input?: Record<string, unknown>; model?: string };
        try {
          body = (await req.json()) as {
            id?: string;
            input?: Record<string, unknown>;
            model?: string;
          };
        } catch {
          return Response.json({ error: "입력 JSON 파싱 실패" }, { status: 400 });
        }
        const ex = byId.get(body.id ?? "") ?? first;
        if (ex === undefined) {
          return Response.json({ error: "예제가 없다" }, { status: 404 });
        }
        const steps: StepUpdate<Record<string, unknown>>[] = [];
        try {
          // 모델 생성 실패(키 없음·모르는 프로바이더)와 실행 실패를 같은 자리에서 잡는다.
          // 둘 다 사용자가 고칠 수 있는 것이라 메시지를 그대로 보여준다.
          const graph = buildGraph(ex, body.model);
          for await (const step of graph.stream(body.input ?? {})) {
            steps.push(step);
          }
        } catch (e) {
          return Response.json({ error: describe(e), steps }, { status: 500 });
        }
        return Response.json({ steps });
      }

      return new Response("Not found", { status: 404 });
    },
  };
}
