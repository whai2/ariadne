// Studio 브라우저 UI (단일 HTML 문자열).
// 클라이언트 JS는 바닐라 + mermaid(CDN)만 사용 — 빌드 스텝 없음.
// 템플릿 리터럴 이스케이프를 피하려고 클라이언트 JS는 문자열 결합으로 작성한다.
export const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ariadne Studio</title>
<style>
  body { margin: 0; font: 14px system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
  header { padding: 12px 20px; border-bottom: 1px solid #e5e5e5; background: #fff; }
  header b { font-size: 16px; }
  header span { color: #888; margin-left: 8px; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 20px; }
  section { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; }
  h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  textarea { width: 100%; box-sizing: border-box; font: 13px ui-monospace, monospace; padding: 8px; border: 1px solid #ddd; border-radius: 6px; }
  button { margin-top: 8px; padding: 8px 16px; border: 0; border-radius: 6px; background: #111; color: #fff; cursor: pointer; font-weight: 600; }
  .step { border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  .step .node { font-weight: 700; color: #0b6; }
  pre { margin: 6px 0 0; font: 12px ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; }
  #graph svg { max-width: 100%; }
</style>
</head>
<body>
<header><b>Ariadne Studio</b><span>그래프 시각화 + invoke 스텝 실행 (최소)</span></header>
<main>
  <section>
    <h2>Graph</h2>
    <div id="graph">불러오는 중…</div>
  </section>
  <section>
    <h2>Run</h2>
    <textarea id="input" rows="4">{ "text": "hi", "steps": 0 }</textarea>
    <button id="run">▶ Invoke</button>
    <div id="steps"></div>
  </section>
</main>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({ startOnLoad: false });

  function labelOf(n) { return n === "__start__" ? "START" : n === "__end__" ? "END" : n; }

  function toMermaid(graph) {
    var lines = ["graph TD"];
    graph.edges.forEach(function (e) {
      lines.push("  " + e.from + "[\\"" + labelOf(e.from) + "\\"] --> " + e.to + "[\\"" + labelOf(e.to) + "\\"]");
    });
    return lines.join("\\n");
  }

  async function drawGraph() {
    var graph = await (await fetch("/api/graph")).json();
    var def = toMermaid(graph);
    var out = await mermaid.render("g", def);
    document.getElementById("graph").innerHTML = out.svg;
  }

  async function run() {
    var box = document.getElementById("steps");
    var input;
    try { input = JSON.parse(document.getElementById("input").value); }
    catch (e) { box.innerHTML = "<p style='color:#c00'>입력 JSON 오류</p>"; return; }
    var res = await (await fetch("/api/run", { method: "POST", body: JSON.stringify(input) })).json();
    if (res.error) { box.innerHTML = "<p style='color:#c00'>" + res.error + "</p>"; return; }
    box.innerHTML = res.steps.map(function (s, i) {
      return "<div class='step'><span class='node'>" + (i + 1) + ". " + s.node +
        "</span><pre>" + JSON.stringify(s.state, null, 2) + "</pre></div>";
    }).join("");
  }

  document.getElementById("run").addEventListener("click", run);
  drawGraph();
</script>
</body>
</html>`;
