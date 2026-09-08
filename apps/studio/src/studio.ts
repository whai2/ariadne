import type { BaseMessage, CompiledGraph, StepUpdate } from "@ariadne/core";
import { agentInfo, agents, agentTurn, buildAgentGraph } from "./agents";
import { buildChatGraph, chatTurn, providerList, SHAPES, type ShapeId } from "./chat";
import type { Example } from "./examples";

/** Vite 빌드 산출물. `bun run studio`가 `vite build`를 먼저 돌려 여기에 채운다. */
const DIST_DIR = `${import.meta.dir}/../dist`;

/** 빌드 전(테스트·개발) `/`에 뜨는 안내. UI는 `bun run studio`로 빌드해 서빙한다. */
const DEV_PLACEHOLDER = `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<title>Ariadne Studio</title></head><body style="font:14px system-ui;background:#0d0d0f;color:#e9e9ec;padding:40px">
<h1>Ariadne Studio</h1><p>UI가 아직 빌드되지 않았다. <code>bun run studio</code>(vite build + 서버) 또는
개발 중이면 <code>bun run --filter '@ariadne/studio' dev:ui</code>(Vite HMR).</p></body></html>`;

const CONTENT_TYPE: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json",
  ico: "image/x-icon",
};

/** 빌드된 SPA 자산을 서빙한다. 없으면 `/`엔 안내를, 그 외엔 404. */
async function serveStatic(pathname: string): Promise<Response> {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(`${DIST_DIR}${rel}`);
  if (await file.exists()) {
    const ext = rel.split(".").pop() ?? "";
    const type = CONTENT_TYPE[ext] ?? "application/octet-stream";
    return new Response(file, {
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  }
  if (pathname === "/") {
    return new Response(DEV_PLACEHOLDER, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response("Not found", { status: 404 });
}

/** 에러를 사람이 읽을 수 있게. 스택 대신 메시지만 — 대개 "키가 없다"류다. */
function describe(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

export interface Studio {
  /** Bun.serve의 fetch로 바로 넘길 수 있고, 테스트에서 직접 호출도 된다. */
  fetch(req: Request): Promise<Response>;
}

/**
 * 스튜디오 서버. **API를 맡고 빌드된 React UI(dist)를 서빙한다.**
 * - GET  /               → 빌드된 SPA(index.html) 또는 안내
 * - GET  /assets/*       → 빌드 자산(js/css)
 * - GET  /api/providers  → 프로바이더 드롭다운(어느 게 지금 쓸 수 있는지까지)
 * - GET  /api/shapes     → 챗이 돌 수 있는 그래프 모양들
 * - GET  /api/chat/graph?shape → 그 모양의 구조(보내기 전에 그림을 볼 수 있게)
 * - POST /api/chat       → { spec, messages, system, shape } 한 턴 대화 (그래프로 돈다)
 * - GET  /api/agents     → 등록된 에이전트 목록(설정 + 준비 상태)
 * - GET  /api/agents/graph?id → 그 에이전트의 그래프 구조(자격증명 없이)
 * - POST /api/agents/chat → { id, messages, decision? } 그 에이전트로 한 턴.
 *                           `decision`("allow"|"deny")은 승인 대기에서 **재개**할 때만 (F3.3).
 *                           재개에 새 엔드포인트가 없는 게 요점이다 — 상태가 messages뿐이라
 *                           같은 요청에 결정 한 글자만 더 실으면 된다.
 * - GET  /api/examples   → 예제 목록
 * - GET  /api/graph?id   → 그 예제의 구조(getGraph)
 * - POST /api/run        → { id, input }으로 stream을 돌려 스텝별 상태/채널 반환
 */
export function createStudio(examples: Example[]): Studio {
  const byId = new Map(examples.map((e) => [e.id, e]));
  const first = examples[0];
  const agentById = new Map(agents.map((a) => [a.id, a]));

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

      if (req.method === "GET" && url.pathname === "/api/providers") {
        return Response.json(providerList());
      }

      if (req.method === "GET" && url.pathname === "/api/shapes") {
        return Response.json(SHAPES);
      }

      if (req.method === "GET" && url.pathname === "/api/chat/graph") {
        const shape = (url.searchParams.get("shape") ?? "single") as ShapeId;
        if (!SHAPES.some((s) => s.id === shape)) {
          return Response.json({ error: `모르는 모양: ${shape}` }, { status: 400 });
        }
        // spec 없이 부른다 — 구조만 필요하므로 자격증명이 없어도 그림이 나온다.
        return Response.json(buildChatGraph(shape).getGraph());
      }

      if (req.method === "POST" && url.pathname === "/api/chat") {
        let body: { spec?: string; messages?: BaseMessage[]; system?: string; shape?: ShapeId };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return Response.json({ error: "입력 JSON 파싱 실패" }, { status: 400 });
        }
        if (!body.spec || !Array.isArray(body.messages) || body.messages.length === 0) {
          return Response.json({ error: "spec과 messages가 필요하다" }, { status: 400 });
        }
        try {
          // 모델 생성 실패(키 없음)와 호출 실패를 같은 자리에서 잡는다 —
          // 둘 다 사용자가 고칠 수 있는 것이라 메시지를 그대로 보여준다.
          return Response.json(
            await chatTurn(body.spec, body.messages, {
              ...(body.system === undefined ? {} : { system: body.system }),
              ...(body.shape === undefined ? {} : { shape: body.shape }),
            }),
          );
        } catch (e) {
          return Response.json({ error: describe(e) }, { status: 500 });
        }
      }

      if (req.method === "GET" && url.pathname === "/api/agents") {
        return Response.json(agents.map((a) => agentInfo(a)));
      }

      if (req.method === "GET" && url.pathname === "/api/agents/graph") {
        const def = agentById.get(url.searchParams.get("id") ?? "");
        if (def === undefined) {
          return Response.json({ error: "에이전트가 없다" }, { status: 404 });
        }
        // preview=true — 자격증명 없이 구조만. 그래프 모양은 모델과 무관하다.
        return Response.json(buildAgentGraph(def, true).getGraph());
      }

      if (req.method === "POST" && url.pathname === "/api/agents/chat") {
        let body: { id?: string; messages?: BaseMessage[]; decision?: string };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return Response.json({ error: "입력 JSON 파싱 실패" }, { status: 400 });
        }
        const def = agentById.get(body.id ?? "");
        if (def === undefined) {
          return Response.json({ error: "에이전트가 없다" }, { status: 404 });
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return Response.json({ error: "messages가 필요하다" }, { status: 400 });
        }
        // 재개(F3.3). **"ask"는 클라이언트가 보낼 수 없다** — 그건 사람에게 묻겠다는 뜻인데,
        // 요청을 보낸 쪽이 이미 사람이라 여기서 그 값이 오면 무한 왕복이 된다.
        if (body.decision !== undefined && body.decision !== "allow" && body.decision !== "deny") {
          return Response.json({ error: "decision은 allow 또는 deny다" }, { status: 400 });
        }
        try {
          // 모델 생성 실패(키 없음)와 호출 실패를 같은 자리에서 — 둘 다 사용자가 고칠 수 있다.
          return Response.json(await agentTurn(def, body.messages, body.decision));
        } catch (e) {
          return Response.json({ error: describe(e) }, { status: 500 });
        }
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

      // API가 아닌 GET은 빌드된 SPA 자산으로 — /, /assets/*.
      if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
        return serveStatic(url.pathname);
      }

      return new Response("Not found", { status: 404 });
    },
  };
}
