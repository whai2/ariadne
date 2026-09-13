const DIST_DIR = `${import.meta.dir}/../../dist`;

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

/** Vite 빌드 산출물(`dist/`)을 내준다. 빌드 전이면 `/`에 안내 페이지. */
export async function serveStatic(pathname: string): Promise<Response> {
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
