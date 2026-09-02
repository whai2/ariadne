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
  .ch { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
  .ch th { text-align: left; color: #999; font-weight: 600; border-bottom: 1px solid #eee; padding: 2px 6px; }
  .ch td { padding: 2px 6px; border-bottom: 1px solid #f3f3f3; }
  .ch .k { font-weight: 600; }
  .ch .t { color: #85f; font-family: ui-monospace, monospace; }
  .ch .v { font-family: ui-monospace, monospace; color: #333; }
  .ok { color: #0b6; }
  .empty { color: #bbb; }
</style>
</head>
<body>
<header><b>Ariadne Studio</b><span>그래프 시각화 + invoke 스텝 실행 (최소)</span></header>
<main>
  <section>
    <h2>Graph</h2>
    <select id="example"></select>
    <p id="desc" style="color:#888;margin:8px 0 4px"></p>
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

  var EXAMPLES = [];
  var currentId = null;
  var renderSeq = 0;

  function labelOf(n) { return n === "__start__" ? "START" : n === "__end__" ? "END" : n; }

  function toMermaid(graph) {
    var lines = ["graph TD"];
    graph.edges.forEach(function (e) {
      lines.push("  " + e.from + "[\\"" + labelOf(e.from) + "\\"] --> " + e.to + "[\\"" + labelOf(e.to) + "\\"]");
    });
    return lines.join("\\n");
  }

  async function drawGraph(id) {
    var graph = await (await fetch("/api/graph?id=" + encodeURIComponent(id))).json();
    var out = await mermaid.render("g" + (++renderSeq), toMermaid(graph));
    document.getElementById("graph").innerHTML = out.svg;
  }

  async function selectExample(id) {
    currentId = id;
    var ex = EXAMPLES.find(function (e) { return e.id === id; });
    document.getElementById("desc").textContent = ex ? ex.description : "";
    document.getElementById("input").value = ex ? JSON.stringify(ex.sampleInput, null, 2) : "{}";
    document.getElementById("steps").innerHTML = "";
    await drawGraph(id);
  }

  async function loadExamples() {
    EXAMPLES = await (await fetch("/api/examples")).json();
    var sel = document.getElementById("example");
    sel.innerHTML = EXAMPLES.map(function (e) {
      return "<option value='" + e.id + "'>" + e.name + "</option>";
    }).join("");
    sel.addEventListener("change", function () { selectExample(sel.value); });
    if (EXAMPLES.length) selectExample(EXAMPLES[0].id);
  }

  async function run() {
    var box = document.getElementById("steps");
    var input;
    try { input = JSON.parse(document.getElementById("input").value); }
    catch (e) { box.innerHTML = "<p style='color:#c00'>입력 JSON 오류</p>"; return; }
    var res = await (await fetch("/api/run", {
      method: "POST", body: JSON.stringify({ id: currentId, input: input }),
    })).json();
    if (res.error) { box.innerHTML = "<p style='color:#c00'>" + res.error + "</p>"; return; }
    box.innerHTML = res.steps.map(function (s, i) {
      var rows = s.channels.map(function (c) {
        var badge = c.available
          ? "<span class='ok'>● available</span>"
          : "<span class='empty'>○ empty</span>";
        var val = c.available ? JSON.stringify(c.value) : "—";
        return "<tr><td class='k'>" + c.key + "</td><td class='t'>[" + c.type +
          "]</td><td>" + badge + "</td><td class='v'>" + val + "</td></tr>";
      }).join("");
      return "<div class='step'><div class='node'>" + (i + 1) + ". " + s.node + "</div>" +
        "<table class='ch'><tr><th>channel</th><th>type</th><th>state</th><th>value</th></tr>" +
        rows + "</table></div>";
    }).join("");
  }

  document.getElementById("run").addEventListener("click", run);
  loadExamples();
</script>
</body>
</html>`;
