// Studio 브라우저 UI (단일 HTML 문자열).
// 클라이언트 JS는 바닐라 + mermaid(CDN)만 사용 — 빌드 스텝 없음.
// 템플릿 리터럴 이스케이프를 피하려고 클라이언트 JS는 문자열 결합으로 작성한다.
//
// 레이아웃은 **좌측 고정 사이드바**(mastra 플레이그라운드 대응, S9):
//   AGENTS    등록된 에이전트 목록. 고르면 설정·그래프·대화가 우측에 뜬다(@ariadne/agent).
//   Chat      프로바이더를 골라 자유롭게 대화 — 엔진 모양을 실험하는 교보재.
//   Examples  예제 갤러리(S1·S2·S4).
export const PAGE = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ariadne Studio</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px system-ui, sans-serif; color: #1a1a1a; background: #fafafa; display: flex; height: 100vh; overflow: hidden; }

  /* ── 좌측 사이드바 ── */
  .sidebar { flex: 0 0 236px; background: #fff; border-right: 1px solid #e5e5e5; padding: 14px 12px; overflow-y: auto; display: flex; flex-direction: column; }
  .brand { font-weight: 700; font-size: 16px; padding: 4px 8px 2px; }
  .brand small { display: block; font-weight: 400; font-size: 11px; color: #999; margin-top: 2px; }
  .sec { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #aaa; padding: 16px 8px 4px; font-weight: 700; }
  .navitem { padding: 8px 10px; border-radius: 6px; cursor: pointer; color: #333; font-weight: 600; }
  .navitem:hover { background: #f2f2f2; }
  .navitem.on { background: #111; color: #fff; }
  .navitem small { display: block; font-weight: 400; opacity: .6; font-size: 11px; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .navitem .dot { font-size: 10px; }
  .navitem .dot.ready { color: #0b6; }
  .navitem .dot.no { color: #c93; }
  .navitem.on .dot { color: #fff; }
  .divider { height: 1px; background: #eee; margin: 12px 4px; }

  /* ── 우측 콘텐츠 ── */
  .content { flex: 1; overflow-y: auto; }
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

  /* ── 에이전트 상세 ── */
  #view-agent { display: block; padding: 16px 20px; }
  .agent-head { margin-bottom: 14px; }
  .agent-head h1 { font-size: 20px; margin: 0 0 4px; }
  .agent-head p { margin: 0; color: #888; max-width: 720px; line-height: 1.5; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip { font-size: 12px; padding: 3px 9px; border-radius: 12px; background: #f0f0f0; color: #555; font-family: ui-monospace, monospace; }
  .chip.model { background: #e7f4ee; color: #0a7; }
  .chip.tool { background: #efe9ff; color: #63c; }
  .chip.warn { background: #fff2e0; color: #c60; }
  .chip.plain { background: #f3f3f3; color: #999; }
  .agent-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  .sysbox { white-space: pre-wrap; background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 8px 10px; font-size: 12px; color: #555; margin-top: 8px; }

  #log, #ag-log { border: 1px solid #eee; border-radius: 6px; padding: 12px; height: 340px; overflow-y: auto; background: #fcfcfc; }
  .msg { margin-bottom: 12px; }
  .msg .who { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 3px; }
  .msg.human .who { color: #06c; }
  .msg.ai .who { color: #0b6; }
  .msg.tool .who { color: #85f; }
  .msg.toolerr .who { color: #c00; }
  .msg .calls { font-family: ui-monospace, monospace; font-size: 12px; color: #85f; margin-top: 3px; }
  .msg .body { white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .msg.pending .body { color: #999; }
  .composer { display: flex; gap: 8px; margin-top: 10px; }
  .composer textarea { flex: 1; font: 14px system-ui, sans-serif; resize: vertical; }
  .composer button { flex: 0 0 auto; }

  .step { border: 1px solid #eee; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  .step .node { font-weight: 700; color: #0b6; }
  #graph svg, #chatgraph svg, #ag-graph svg { max-width: 100%; }
  .ch { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
  .ch th { text-align: left; color: #999; font-weight: 600; border-bottom: 1px solid #eee; padding: 2px 6px; }
  .ch td { padding: 2px 6px; border-bottom: 1px solid #f3f3f3; }
  .ch .k { font-weight: 600; }
  .ch .t { color: #85f; font-family: ui-monospace, monospace; }
  /* 툴 예제의 messages 값은 toolCalls까지 실려 길다 — 안 접으면 표가 화면 밖으로 나간다. */
  .ch .v { font-family: ui-monospace, monospace; color: #333; word-break: break-all; }
  .ok { color: #0b6; }
  .empty { color: #bbb; }
  .err { color: #c00; background: #fff5f5; border: 1px solid #fcc; border-radius: 6px; padding: 10px; font: 12px ui-monospace, monospace; white-space: pre-wrap; }
  .hidden { display: none; }
  .muted { color: #888; font-size: 12px; margin: 6px 0 0; }
  #fatal { display: none; margin: 12px 20px 0; padding: 10px; background: #fff3cd; border: 1px solid #ffe08a; border-radius: 6px; color: #7a5b00; font: 13px ui-monospace, monospace; }
</style>
</head>
<body>
<nav class="sidebar">
  <div class="brand">Ariadne Studio<small>그래프 엔진 위에서 도는 에이전트</small></div>
  <div class="sec">Agents</div>
  <div id="agentnav"><p class="muted" style="padding:0 8px">불러오는 중…</p></div>
  <div class="divider"></div>
  <div class="navitem" id="nav-chat">Chat<small>프로바이더·모양 실험</small></div>
  <div class="navitem" id="nav-ex">Examples<small>그래프 갤러리</small></div>
</nav>

<div class="content">
<div id="fatal"></div>

<main id="view-agent" class="hidden">
  <div class="agent-head">
    <h1 id="ag-name"></h1>
    <p id="ag-desc"></p>
    <div class="chips" id="ag-chips"></div>
    <div id="ag-sys"></div>
  </div>
  <div class="agent-cols">
    <section>
      <h2>Graph</h2>
      <div id="ag-graph" class="muted">불러오는 중…</div>
      <p class="muted"><b>createAgent</b>가 세운 그래프다 — 툴이 있으면 model ⇄ tools 루프, 없으면 단발 호출.</p>
    </section>
    <section>
      <h2>Chat</h2>
      <div class="need" id="ag-need"></div>
      <div id="ag-log"></div>
      <div class="composer">
        <textarea id="ag-say" rows="2" placeholder="메시지를 입력하고 Enter (Shift+Enter 줄바꿈)"></textarea>
        <button id="ag-send">보내기</button>
      </div>
      <p style="margin-top:8px"><button id="ag-reset" style="background:#eee;color:#333">대화 비우기</button></p>
    </section>
  </div>
  <section style="margin:16px 0 0">
    <h2>이번 턴에 엔진이 한 일</h2>
    <div id="ag-steps" class="muted">메시지를 보내면 스텝·채널이 여기 뜬다.</div>
  </section>
</main>

<main id="view-chat" class="hidden">
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
    <p id="shapeDesc" class="muted" style="margin:0 0 4px"></p>
    <p id="toolwarn" class="need hidden" style="margin:0 0 10px"></p>
    <div class="lbl">System (선택)</div>
    <input id="system" placeholder="예: 간결하게 한국어로 답한다." style="margin-bottom:10px" />

    <div id="log"></div>
    <div class="composer">
      <textarea id="say" rows="2" placeholder="메시지를 입력하고 Enter (Shift+Enter 줄바꿈)"></textarea>
      <button id="send">보내기</button>
    </div>
    <p class="muted">대화도 <b>그래프로 돈다</b> — 위에서 고른 모양 그대로. 오른쪽에서 실제 스텝과 채널을 볼 수 있다.</p>
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
</div>

<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  // 무슨 일이 나든 **화면에 보이게** 한다. 조용히 죽으면 빈 사이드바만 남아 원인을 못 찾는다.
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
  async function drawInto(boxId, graph, prefix) {
    var box = document.getElementById(boxId);
    if (graph.error) { box.innerHTML = "<div class='err'>" + esc(graph.error) + "</div>"; return; }
    if (!MERMAID) { box.innerHTML = "<pre>" + esc(toMermaid(graph)) + "</pre>"; return; }
    var out = await mermaid.render(prefix + (++renderSeq), toMermaid(graph));
    box.innerHTML = out.svg;
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

  // 대화 로그 한 벌을 HTML로. **에이전트 뷰와 자유 Chat이 공유한다** — 툴 호출/결과를 그리는
  // 규칙(호출↔결과 id 짝)이 한 곳에만 있어야 두 화면이 어긋나지 않는다.
  function msgHtml(m) {
    // 툴을 부르는 AI 메시지는 **content가 비어 있다** — toolCalls를 안 그리면
    // 빈 말풍선만 남아서, 화면상으로는 모델이 아무 말도 안 한 것처럼 보인다.
    var calls = (m.toolCalls || []).map(function (c) {
      return "🔧 " + c.name + "(" + JSON.stringify(c.args) + ")  #" + c.id;
    }).join("\\n");
    // 툴 결과는 어느 호출의 답인지가 전부다 — id를 라벨에 박아 짝을 눈으로 확인한다.
    var who = m.role + (m.toolCallId ? " → #" + m.toolCallId : "");
    return "<div class='msg " + m.role + (m.status === "error" ? " toolerr" : "") + "'>" +
      "<div class='who'>" + esc(who) + (m.status === "error" ? " ✗" : "") + "</div>" +
      (m.content ? "<div class='body'>" + esc(m.content) + "</div>" : "") +
      (calls ? "<div class='calls body'>" + esc(calls) + "</div>" : "") + "</div>";
  }
  function renderConvo(boxId, arr, pending, emptyText) {
    var box = document.getElementById(boxId);
    var html = arr.map(msgHtml).join("");
    if (pending) {
      html += "<div class='msg ai pending'><div class='who'>ai</div><div class='body'>생각 중…</div></div>";
    }
    box.innerHTML = html || "<p class='muted'>" + emptyText + "</p>";
    box.scrollTop = box.scrollHeight;
  }
  // IME 조합 중 Enter 무시 + Enter 전송을 컴포저에 붙인다(자유 Chat·에이전트 공용).
  function bindComposer(taId, onSend) {
    document.getElementById(taId).addEventListener("keydown", function (e) {
      // **IME 조합 중 Enter는 무시한다.** 한글/일본어 입력에서 마지막 글자를 확정하는
      // Enter가 전송까지 같이 트리거하면, 확정 전 텍스트가 먼저 나가고 남은 조합 글자가
      // 두 번째 메시지로 따로 날아간다. keyCode 229는 isComposing을 안 주는 옛 브라우저용 폴백.
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
    });
  }

  // ─── 뷰 전환 ───────────────────────────────────────────────────────────────
  function showView(which) {
    document.getElementById("view-agent").classList.toggle("hidden", which !== "agent");
    document.getElementById("view-chat").classList.toggle("hidden", which !== "chat");
    document.getElementById("view-ex").classList.toggle("hidden", which !== "ex");
    document.getElementById("nav-chat").classList.toggle("on", which === "chat");
    document.getElementById("nav-ex").classList.toggle("on", which === "ex");
    // 에이전트 nav의 on 표시는 selectAgent가 관리한다(어느 에이전트인지 알아야 하므로).
    if (which !== "agent") setAgentNavActive(null);
    if (which === "ex" && !EXAMPLES.length) loadExamples();
  }
  document.getElementById("nav-chat").addEventListener("click", function () { showView("chat"); });
  document.getElementById("nav-ex").addEventListener("click", function () { showView("ex"); });

  // ─── Agents (사이드바) ───────────────────────────────────────────────────────
  var AGENTS = [];
  var agConvo = [];
  var currentAgent = null;

  function setAgentNavActive(id) {
    var items = document.querySelectorAll("#agentnav .navitem");
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle("on", items[i].getAttribute("data-agent") === id);
    }
  }

  async function loadAgents() {
    try { AGENTS = await (await fetch("/api/agents")).json(); }
    catch (e) { fatal("에이전트 목록을 못 불러왔다: " + e); return; }
    var nav = document.getElementById("agentnav");
    if (!AGENTS.length) { nav.innerHTML = "<p class='muted' style='padding:0 8px'>등록된 에이전트가 없다.</p>"; return; }
    nav.innerHTML = AGENTS.map(function (a) {
      var dot = a.ready ? "<span class='dot ready'>●</span> " : "<span class='dot no'>●</span> ";
      var sub = a.tools.length ? a.tools.join("·") : "툴 없음";
      return "<div class='navitem' data-agent='" + a.id + "'>" + dot + esc(a.name) +
        "<small>" + esc(sub) + "</small></div>";
    }).join("");
    var items = nav.querySelectorAll(".navitem");
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener("click", function () { selectAgent(this.getAttribute("data-agent")); });
    }
  }

  function agentById(id) { return AGENTS.find(function (a) { return a.id === id; }); }

  async function selectAgent(id) {
    var a = agentById(id);
    if (!a) return;
    currentAgent = id;
    agConvo = [];
    showView("agent");
    setAgentNavActive(id);

    document.getElementById("ag-name").textContent = a.name;
    document.getElementById("ag-desc").textContent = a.description;

    // 설정을 칩으로 — model, 툴, promptedTools 여부. "확인"의 핵심이 이 요약이다.
    var chips = ["<span class='chip model'>" + esc(a.model) + "</span>"];
    if (a.tools.length) {
      a.tools.forEach(function (t) { chips.push("<span class='chip tool'>🔧 " + esc(t) + "</span>"); });
      if (!a.toolsNative) chips.push("<span class='chip warn'>툴=프롬프트 흉내</span>");
    } else {
      chips.push("<span class='chip plain'>툴 없음 · 단발 호출</span>");
    }
    if (a.maxToolRounds) chips.push("<span class='chip'>maxToolRounds " + a.maxToolRounds + "</span>");
    document.getElementById("ag-chips").innerHTML = chips.join("");

    document.getElementById("ag-sys").innerHTML = a.system
      ? "<div class='sysbox'><b>system</b>\\n" + esc(a.system) + "</div>" : "";

    var need = document.getElementById("ag-need");
    if (a.ready) { need.className = "need ready"; need.textContent = "✓ 바로 사용 가능"; }
    else { need.className = "need"; need.textContent = "⚠ 필요: " + a.need; }

    document.getElementById("ag-steps").innerHTML = "<p class='muted'>메시지를 보내면 스텝·채널이 여기 뜬다.</p>";
    renderConvo("ag-log", agConvo, false, "메시지를 보내면 대화가 시작된다.");
    await drawInto("ag-graph", await (await fetch("/api/agents/graph?id=" + encodeURIComponent(id))).json(), "ag");
  }

  async function agentSend() {
    var ta = document.getElementById("ag-say");
    var text = ta.value.trim();
    if (!text || !currentAgent) return;
    agConvo.push({ role: "human", content: text });
    ta.value = "";
    renderConvo("ag-log", agConvo, true, "");
    var btn = document.getElementById("ag-send");
    btn.disabled = true;
    var out = document.getElementById("ag-steps");
    var res;
    try {
      res = await (await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: currentAgent, messages: agConvo }),
      })).json();
    } catch (e) {
      renderConvo("ag-log", agConvo, false, "");
      out.innerHTML = "<div class='err'>요청 실패: " + esc(e) + "</div>";
      btn.disabled = false; return;
    }
    btn.disabled = false;
    if (res.error) {
      renderConvo("ag-log", agConvo, false, "");
      out.innerHTML = "<div class='err'>" + esc(res.error) + "</div>";
      return;
    }
    agConvo = agConvo.concat(res.messages);
    renderConvo("ag-log", agConvo, false, "");
    out.innerHTML = stepsHtml(res.steps);
  }
  document.getElementById("ag-send").addEventListener("click", agentSend);
  bindComposer("ag-say", agentSend);
  document.getElementById("ag-reset").addEventListener("click", function () {
    agConvo = []; renderConvo("ag-log", agConvo, false, "메시지를 보내면 대화가 시작된다.");
    document.getElementById("ag-steps").innerHTML = "<p class='muted'>메시지를 보내면 스텝·채널이 여기 뜬다.</p>";
  });

  // ─── Chat (자유 실험) ────────────────────────────────────────────────────────
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
    refreshToolWarning();
  }

  // 네이티브 툴이 안 되는 프로바이더(claude-code)로 tools 모양을 고르면, 프롬프트로 흉내
  // 낸다는 걸 **미리** 알려준다. 막는 게 아니라 안내다 — 실제로 돌긴 돈다(길 B).
  function refreshToolWarning() {
    var p = currentProvider();
    var box = document.getElementById("toolwarn");
    if (!box) return;
    var prompted = currentShape() === "tools" && p && !p.tools;
    box.classList.toggle("hidden", !prompted);
    if (prompted) {
      box.textContent = "ℹ " + p.name + "는 툴을 네이티브로 못 실어서 프롬프트로 흉내 낸다" +
        " — 툴 루프는 그대로 우리 그래프 안에서 돌지만, 네이티브(anthropic·openai)보다 덜 안정적이다.";
    }
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
    var graph = await (await fetch("/api/chat/graph?shape=" + encodeURIComponent(currentShape()))).json();
    await drawInto("chatgraph", graph, "cg");
  }

  async function onShapeChange() {
    var sh = SHAPES.find(function (x) { return x.id === currentShape(); });
    var d = document.getElementById("shapeDesc");
    // 모델을 여러 번 부르는 모양은 그만큼 오래 걸린다 — 미리 알려준다.
    d.textContent = sh ? sh.description + " (모델 호출 " + sh.calls + "회)" : "";
    refreshToolWarning();
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
    renderConvo("log", convo, true, "");
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
      renderConvo("log", convo, false, "");
      out.innerHTML = "<div class='err'>요청 실패: " + esc(e) + "</div>";
      btn.disabled = false; return;
    }
    btn.disabled = false;

    if (res.error) {
      renderConvo("log", convo, false, "");
      out.innerHTML = "<div class='err'>" + esc(res.error) + "</div>";
      return;
    }
    convo = convo.concat(res.messages);
    renderConvo("log", convo, false, "");
    out.innerHTML = stepsHtml(res.steps);
  }

  document.getElementById("send").addEventListener("click", send);
  bindComposer("say", send);
  document.getElementById("reset").addEventListener("click", function () {
    convo = []; renderConvo("log", convo, false, "메시지를 보내면 대화가 시작된다.");
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
    await drawInto("graph", graph, "g");
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

  // ─── 부팅 ─────────────────────────────────────────────────────────────────
  // 에이전트가 주인공이다 — 목록을 불러오고 첫 에이전트를 연다. 없으면 Chat으로.
  loadProviders();
  loadShapes();
  loadAgents().then(function () {
    if (AGENTS.length) selectAgent(AGENTS[0].id);
    else showView("chat");
  });
</script>
</body>
</html>`;
