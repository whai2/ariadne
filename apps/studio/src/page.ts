// Studio 브라우저 UI (단일 HTML 문자열).
// 클라이언트 JS는 바닐라 + mermaid(CDN)만 사용 — 빌드 스텝 없음.
// 템플릿 리터럴 이스케이프를 피하려고 클라이언트 JS는 문자열 결합으로 작성한다.
//
// 탭 두 개다:
//   Chat      프로바이더를 골라 대화한다. 대화도 **그래프로 돌아서** 오른쪽에 스텝·채널이 뜬다.
//   Examples  기존 예제 갤러리(S1·S2·S4).
export const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ariadne Studio</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
  header { display: flex; align-items: center; gap: 16px; padding: 10px 20px; border-bottom: 1px solid #e5e5e5; background: #fff; }
  header b { font-size: 16px; }
  .tabs { display: flex; gap: 4px; margin-left: auto; }
  .tab { padding: 6px 14px; border: 1px solid #e5e5e5; background: #fff; border-radius: 6px; cursor: pointer; font-weight: 600; color: #666; }
  .tab.on { background: #111; color: #fff; border-color: #111; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px 20px; align-items: start; }
  section { background: #fff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; }
  h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  select, input, textarea { width: 100%; font: 13px ui-monospace, monospace; padding: 7px 8px; border: 1px solid #ddd; border-radius: 6px; background: #fff; }
  button { padding: 8px 16px; border: 0; border-radius: 6px; background: #111; color: #fff; cursor: pointer; font-weight: 600; }
  button:disabled { background: #bbb; cursor: progress; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }
  .lbl { font-size: 11px; color: #999; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 3px; }
  .need { font-size: 12px; color: #c60; margin: 2px 0 8px; min-height: 16px; }
  .need.ready { color: #0b6; }

  #log { border: 1px solid #eee; border-radius: 6px; padding: 12px; height: 360px; overflow-y: auto; background: #fcfcfc; }
  .msg { margin-bottom: 12px; }
  .msg .who { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
  .msg.human .who { color: #06c; }
  .msg.ai .who { color: #0b6; }
  .msg .body { white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .msg.pending .body { color: #999; }
  .composer { display: flex; gap: 8px; margin-top: 10px; }
  .composer textarea { flex: 1; font: 14px system-ui, sans-serif; resize: vertical; }
  .composer button { flex: 0 0 auto; }

  .step { border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  .step .node { font-weight: 700; color: #0b6; }
  #graph svg, #chatgraph svg { max-width: 100%; }
  .ch { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
  .ch th { text-align: left; color: #999; font-weight: 600; border-bottom: 1px solid #eee; padding: 2px 6px; }
  .ch td { padding: 2px 6px; border-bottom: 1px solid #f3f3f3; }
  .ch .k { font-weight: 600; }
  .ch .t { color: #85f; font-family: ui-monospace, monospace; }
  .ch .v { font-family: ui-monospace, monospace; color: #333; }
  .ok { color: #0b6; }
  .empty { color: #bbb; }
  .err { color: #c00; background: #fff5f5; border: 1px solid #fcc; border-radius: 6px; padding: 10px; font: 12px ui-monospace, monospace; white-space: pre-wrap; }
  .hidden { display: none; }
  .muted { color: #888; font-size: 12px; margin: 6px 0 0; }
  #fatal { display: none; padding: 10px 20px; background: #fff3cd; border-bottom: 1px solid #ffe08a; color: #7a5b00; font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<header>
  <b>Ariadne Studio</b>
  <span style="color:#888">그래프 엔진 위에서 도는 대화</span>
  <div class="tabs">
    <button class="tab on" id="tab-chat">Chat</button>
    <button class="tab" id="tab-ex">Examples</button>
  </div>
</header>
<div id="fatal"></div>

<main id="view-chat">
  <section>
    <h2>Chat</h2>
    <div class="row">
      <div>
        <div class="lbl">Provider</div>
        <select id="provider"></select>
      </div>
      <div>
        <div class="lbl">Model</div>
        <input id="modelId" placeholder="모델 ID" />
      </div>
    </div>
    <div class="need" id="need"></div>
    <div class="lbl">Graph</div>
    <select id="shape" style="margin-bottom:4px"></select>
    <p id="shapeDesc" class="muted" style="margin:0 0 10px"></p>
    <div class="lbl">System (선택)</div>
    <input id="system" placeholder="예: 간결하게 한국어로 답한다." style="margin-bottom:10px" />

    <div id="log"></div>
    <div class="composer">
      <textarea id="say" rows="2" placeholder="메시지를 입력하고 Enter (Shift+Enter 줄바꿈)"></textarea>
      <button id="send">보내기</button>
    </div>
    <p class="muted">대화도 <b>그래프로 돈다</b> — START→model→END에 messages 리듀서(V8). 오른쪽에서 실제 스텝과 채널을 볼 수 있다.</p>
    <p style="margin-top:8px"><button id="reset" style="background:#eee;color:#333">대화 비우기</button></p>
  </section>

  <section>
    <h2>이번 턴에 엔진이 한 일</h2>
    <div id="chatgraph" class="muted">모양을 고르면 그래프가 뜬다.</div>
    <div id="chatsteps"></div>
  </section>
</main>

<main id="view-ex" class="hidden">
  <section>
    <h2>Graph</h2>
    <select id="example"></select>
    <p id="desc" style="color:#888;margin:8px 0 4px"></p>
    <div id="graph">불러오는 중…</div>
  </section>
  <section>
    <h2>Run</h2>
    <input id="model" placeholder="claude-code/sonnet" class="hidden" />
    <p id="hint" class="hidden" style="color:#c60;font-size:12px;margin:6px 0 0">🔴 진짜 모델을 부른다 — 응답까지 몇 초 걸린다.</p>
    <textarea id="input" rows="4" style="margin-top:8px">{ "text": "hi", "steps": 0 }</textarea>
    <button id="run" style="margin-top:8px">▶ Invoke</button>
    <div id="steps"></div>
  </section>
</main>

<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  // 무슨 일이 나든 **화면에 보이게** 한다. 조용히 죽으면 빈 드롭다운만 남아 원인을 못 찾는다.
  function fatal(msg) {
    var bar = document.getElementById("fatal");
    if (bar) { bar.textContent = "⚠ " + msg; bar.style.display = "block"; }
  }
  window.addEventListener("error", function (e) { fatal(e.message); });

  // mermaid는 CDN이라 실패할 수 있다. 그림이 안 그려질 뿐, 나머지는 돌아야 한다.
  var MERMAID = typeof mermaid !== "undefined";
  if (MERMAID) { mermaid.initialize({ startOnLoad: false }); }
  else { fatal("mermaid CDN 로드 실패 — 그래프 그림만 안 나온다(대화는 정상)."); }
  var renderSeq = 0;
  function labelOf(n) { return n === "__start__" ? "START" : n === "__end__" ? "END" : n; }
  function toMermaid(graph) {
    var lines = ["graph TD"];
    graph.edges.forEach(function (e) {
      // 조건부는 점선 — 라우터가 런타임에 고르는 길이라 항상 가는 게 아니다.
      var arrow = e.kind === "conditional" ? " -.-> " : " --> ";
      lines.push("  " + e.from + "[\\"" + labelOf(e.from) + "\\"]" + arrow + e.to + "[\\"" + labelOf(e.to) + "\\"]");
    });
    return lines.join("\\n");
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function stepsHtml(steps) {
    return steps.map(function (s) {
      var rows = (s.channels || []).map(function (c) {
        var badge = c.available ? "<span class='ok'>● available</span>" : "<span class='empty'>○ empty</span>";
        var val = c.available ? esc(JSON.stringify(c.value)) : "—";
        return "<tr><td class='k'>" + c.key + "</td><td class='t'>[" + c.type +
          "]</td><td>" + badge + "</td><td class='v'>" + val + "</td></tr>";
      }).join("");
      return "<div class='step'><div class='node'>Step " + s.step + ": " + s.nodes.join(" · ") +
        "</div><table class='ch'><tr><th>channel</th><th>type</th><th>state</th><th>value</th></tr>" +
        rows + "</table></div>";
    }).join("");
  }

  // ─── 탭 ───────────────────────────────────────────────────────────────────
  function showTab(which) {
    document.getElementById("view-chat").classList.toggle("hidden", which !== "chat");
    document.getElementById("view-ex").classList.toggle("hidden", which !== "ex");
    document.getElementById("tab-chat").classList.toggle("on", which === "chat");
    document.getElementById("tab-ex").classList.toggle("on", which === "ex");
    if (which === "ex" && !EXAMPLES.length) loadExamples();
  }
  document.getElementById("tab-chat").addEventListener("click", function () { showTab("chat"); });
  document.getElementById("tab-ex").addEventListener("click", function () { showTab("ex"); });

  // ─── Chat ─────────────────────────────────────────────────────────────────
  var PROVIDERS = [];
  // 주의: 이 변수를 history라고 부르면 안 된다. 전역 스코프의 var는 window.history
  // (History 객체)를 덮지 못해서 .map()이 TypeError로 터지고, 그러면 바로 아래
  // loadProviders()까지 통째로 안 돌아 드롭다운이 빈 채로 남는다. (실제로 그렇게 당했다.)
  var convo = [];

  function currentProvider() {
    var id = document.getElementById("provider").value;
    return PROVIDERS.find(function (p) { return p.id === id; });
  }

  function onProviderChange() {
    var p = currentProvider();
    if (!p) return;
    document.getElementById("modelId").value = p.suggested || "";
    document.getElementById("modelId").placeholder = p.suggested || "모델 ID";
    var need = document.getElementById("need");
    if (p.ready) { need.className = "need ready"; need.textContent = "✓ 바로 사용 가능"; }
    else { need.className = "need"; need.textContent = "⚠ 필요: " + p.need; }
  }

  async function loadProviders() {
    try {
      PROVIDERS = await (await fetch("/api/providers")).json();
    } catch (e) {
      fatal("프로바이더 목록을 못 불러왔다: " + e);
      return;
    }
    if (!PROVIDERS.length) { fatal("프로바이더가 0개다 — 서버 /api/providers 확인."); return; }
    var ready = PROVIDERS.filter(function (p) { return p.ready; });
    var rest = PROVIDERS.filter(function (p) { return !p.ready; });
    function opts(list) {
      return list.map(function (p) {
        return "<option value='" + p.id + "'>" + esc(p.name) + " (" + p.id + ")</option>";
      }).join("");
    }
    var sel = document.getElementById("provider");
    sel.innerHTML =
      (ready.length ? "<optgroup label='바로 사용 가능 (" + ready.length + ")'>" + opts(ready) + "</optgroup>" : "") +
      "<optgroup label='키 필요 (" + rest.length + ")'>" + opts(rest) + "</optgroup>";
    sel.addEventListener("change", onProviderChange);
    onProviderChange();
  }

  var SHAPES = [];

  function currentShape() {
    return document.getElementById("shape").value || "single";
  }

  async function drawChatGraph() {
    var box = document.getElementById("chatgraph");
    var graph = await (await fetch("/api/chat/graph?shape=" + encodeURIComponent(currentShape()))).json();
    if (graph.error) { box.innerHTML = "<div class='err'>" + esc(graph.error) + "</div>"; return; }
    if (!MERMAID) { box.innerHTML = "<pre>" + esc(toMermaid(graph)) + "</pre>"; return; }
    var out = await mermaid.render("cg" + (++renderSeq), toMermaid(graph));
    box.innerHTML = out.svg;
  }

  async function onShapeChange() {
    var sh = SHAPES.find(function (x) { return x.id === currentShape(); });
    var d = document.getElementById("shapeDesc");
    // 모델을 여러 번 부르는 모양은 그만큼 오래 걸린다 — 미리 알려준다.
    d.textContent = sh ? sh.description + " (모델 호출 " + sh.calls + "회)" : "";
    await drawChatGraph();
  }

  async function loadShapes() {
    try { SHAPES = await (await fetch("/api/shapes")).json(); }
    catch (e) { fatal("그래프 모양 목록을 못 불러왔다: " + e); return; }
    var sel = document.getElementById("shape");
    sel.innerHTML = SHAPES.map(function (x) {
      return "<option value='" + x.id + "'>" + esc(x.name) + "</option>";
    }).join("");
    sel.addEventListener("change", onShapeChange);
    await onShapeChange();
  }

  function renderLog(pending) {
    var box = document.getElementById("log");
    var html = convo.map(function (m) {
      return "<div class='msg " + m.role + "'><div class='who'>" + m.role + "</div>" +
        "<div class='body'>" + esc(m.content) + "</div></div>";
    }).join("");
    if (pending) {
      html += "<div class='msg ai pending'><div class='who'>ai</div><div class='body'>생각 중…</div></div>";
    }
    box.innerHTML = html || "<p class='muted'>메시지를 보내면 대화가 시작된다.</p>";
    box.scrollTop = box.scrollHeight;
  }

  async function send() {
    var ta = document.getElementById("say");
    var text = ta.value.trim();
    if (!text) return;
    var p = currentProvider();
    var modelId = document.getElementById("modelId").value.trim();
    var out = document.getElementById("chatsteps");
    if (!p || !modelId) { out.innerHTML = "<div class='err'>프로바이더와 모델을 고르라</div>"; return; }

    convo.push({ role: "human", content: text });
    ta.value = "";
    renderLog(true);
    var btn = document.getElementById("send");
    btn.disabled = true;

    var res;
    try {
      res = await (await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spec: p.id + "/" + modelId,
          messages: convo,
          shape: currentShape(),
          system: document.getElementById("system").value.trim() || undefined,
        }),
      })).json();
    } catch (e) {
      renderLog(false);
      out.innerHTML = "<div class='err'>요청 실패: " + esc(e) + "</div>";
      btn.disabled = false; return;
    }
    btn.disabled = false;

    if (res.error) {
      renderLog(false);
      out.innerHTML = "<div class='err'>" + esc(res.error) + "</div>";
      return;
    }
    convo = convo.concat(res.messages);
    renderLog(false);
    out.innerHTML = stepsHtml(res.steps);
  }

  document.getElementById("send").addEventListener("click", send);
  document.getElementById("say").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  document.getElementById("reset").addEventListener("click", function () {
    convo = []; renderLog(false);
    document.getElementById("chatsteps").innerHTML = "";
  });

  // ─── Examples (기존) ──────────────────────────────────────────────────────
  var EXAMPLES = [];
  var currentId = null;

  function modelSpec() {
    var el = document.getElementById("model");
    return el.value.trim() || el.placeholder;
  }

  async function drawGraph(id) {
    var graph = await (await fetch("/api/graph?id=" + encodeURIComponent(id))).json();
    if (graph.error) { document.getElementById("graph").innerHTML = "<div class='err'>" + esc(graph.error) + "</div>"; return; }
    if (!MERMAID) { document.getElementById("graph").innerHTML = "<pre>" + esc(toMermaid(graph)) + "</pre>"; return; }
    var out = await mermaid.render("g" + (++renderSeq), toMermaid(graph));
    document.getElementById("graph").innerHTML = out.svg;
  }

  async function selectExample(id) {
    currentId = id;
    var ex = EXAMPLES.find(function (e) { return e.id === id; });
    document.getElementById("desc").textContent = ex ? ex.description : "";
    document.getElementById("input").value = ex ? JSON.stringify(ex.sampleInput, null, 2) : "{}";
    document.getElementById("steps").innerHTML = "";
    var live = ex && ex.live;
    document.getElementById("model").classList.toggle("hidden", !live);
    document.getElementById("hint").classList.toggle("hidden", !live);
    await drawGraph(id);
  }

  async function loadExamples() {
    EXAMPLES = await (await fetch("/api/examples")).json();
    var sel = document.getElementById("example");
    sel.innerHTML = EXAMPLES.map(function (e) {
      return "<option value='" + e.id + "'>" + esc(e.name) + "</option>";
    }).join("");
    sel.addEventListener("change", function () { selectExample(sel.value); });
    if (EXAMPLES.length) selectExample(EXAMPLES[0].id);
  }

  async function run() {
    var box = document.getElementById("steps");
    var btn = document.getElementById("run");
    var input;
    try { input = JSON.parse(document.getElementById("input").value); }
    catch (e) { box.innerHTML = "<div class='err'>입력 JSON 오류</div>"; return; }

    var ex = EXAMPLES.find(function (e) { return e.id === currentId; });
    btn.disabled = true;
    box.innerHTML = "<p class='muted'>" + (ex && ex.live ? "모델 호출 중… (몇 초)" : "실행 중…") + "</p>";

    var res;
    try {
      res = await (await fetch("/api/run", {
        method: "POST",
        body: JSON.stringify({ id: currentId, input: input, model: ex && ex.live ? modelSpec() : undefined }),
      })).json();
    } catch (e) {
      box.innerHTML = "<div class='err'>요청 실패: " + esc(e) + "</div>"; btn.disabled = false; return;
    } finally { btn.disabled = false; }

    if (res.error) { box.innerHTML = "<div class='err'>" + esc(res.error) + "</div>"; return; }
    box.innerHTML = stepsHtml(res.steps);
  }

  document.getElementById("run").addEventListener("click", run);

  renderLog(false);
  loadProviders();
  loadShapes();
</script>
</body>
</html>`;
