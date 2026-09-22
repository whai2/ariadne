import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AgentInfo,
  ApiError,
  api,
  type Checkpoint,
  type GraphView,
  type Injected,
  type MemoryView,
  type Message,
  readSelection,
  saveSelection,
  type ThreadView,
  type ToolCall,
  type TraceRecord,
} from "../api";
import { ChatLog, Composer } from "../components/Chat";
import { Graph } from "../components/Graph";
import { Memory, OUTCOME } from "../components/Memory";
import { TraceView } from "../components/TraceView";

function Chip({
  kind,
  children,
}: {
  kind?: "model" | "tool" | "warn" | "plain";
  children: React.ReactNode;
}) {
  const cls = {
    model: "bg-aimsg/15 text-aimsg",
    tool: "bg-tool/15 text-tool",
    warn: "bg-warn/15 text-warn",
    plain: "bg-surface-2 text-faint",
    undefined: "bg-surface-2 text-muted",
  }[String(kind)];
  return <span className={`rounded-full px-2.5 py-1 font-mono text-xs ${cls}`}>{children}</span>;
}

function ApprovalPanel({
  calls,
  busy,
  onDecide,
}: {
  calls: ToolCall[];
  busy: boolean;
  onDecide: (decision: "allow" | "deny") => void;
}) {
  return (
    <div className="mt-2.5 rounded-md border border-warn/50 bg-warn/10 p-3">
      <div className="font-semibold text-warn text-xs">
        ⏸ 승인 대기 — 이 툴은 사람이 허락해야 돈다
      </div>
      <div className="mt-2 space-y-1">
        {calls.map((c) => (
          <div key={c.id} className="break-all font-mono text-fg text-xs">
            🔒 {c.name}({JSON.stringify(c.args)})
          </div>
        ))}
      </div>
      <p className="mt-2 text-faint text-xs">
        아래 툴 호출은 아직 실행되지 않았습니다. 대기 상태가 저장되어 새로고침 후에도 이어갈 수
        있습니다.
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("allow")}
          className="rounded-md bg-ready px-3 py-1.5 font-semibold text-bg text-xs disabled:opacity-50"
        >
          승인하고 실행
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("deny")}
          className="rounded-md border border-danger/60 px-3 py-1.5 font-semibold text-danger text-xs disabled:opacity-50"
        >
          거부
        </button>
      </div>
    </div>
  );
}

/**
 * 이번 턴에 시험된 기억 하나 (S13).
 *
 * **주입은 원래 안 보인다** — 사실이 `system`에 접혀 들어가 모델만 본다. 그래서 3턴째에 행동이
 * 바뀌어도 화면에는 **원인 없이** 나타난다. 이 띠가 그 원인을 대화 바로 옆에 놓는다.
 */
function InjectedBanner({ injected }: { injected: Injected }) {
  const verdict = injected.outcome === null ? null : OUTCOME[injected.outcome];
  return (
    <div className="mb-2.5 rounded-md border border-aimsg/40 bg-aimsg/10 p-2.5">
      <div className="font-semibold text-aimsg text-xs">🧠 이번 턴에 주입된 기억</div>
      <p className="mt-1 text-fg text-xs">{injected.fact.text}</p>
      {/* 숫자가 **주입 직전**의 성적인 게 중요하다 — 아래 표는 이번 시행까지 반영돼 한 칸 앞서 있다.
          이 턴의 기여분이 바로 아래 `판정` 줄이다. */}
      <p className="mt-1 font-mono text-faint text-xs">
        {injected.fact.level} · {injected.fact.target} · {injected.fact.origin} · 주입 전 성적{" "}
        {injected.fact.strength > 0 ? `+${injected.fact.strength}` : injected.fact.strength} (
        {injected.fact.trials}회 시행)
      </p>
      {verdict ? <p className={`mt-1 text-xs ${verdict.cls}`}>판정: {verdict.label}</p> : null}
    </div>
  );
}

function StatePanel({ agent, checkpoint }: { agent: AgentInfo; checkpoint?: Checkpoint }) {
  const budget = checkpoint?.budget;
  return (
    <div className="mt-2.5 rounded-md border border-border bg-surface-2 p-2.5">
      <div className="font-semibold text-muted text-xs">💾 저장된 실행 상태</div>
      <p className="mt-1.5 font-mono text-fg text-xs">
        남은 예산 {typeof budget === "number" ? budget : "—"} / {agent.budget}
      </p>
      <p className="mt-1 text-faint text-xs">대화를 이어갈 때마다 예산이 1씩 줄어듭니다.</p>
    </div>
  );
}

export function AgentView({ agent }: { agent: AgentInfo }) {
  const [graph, setGraph] = useState<GraphView | { error: string } | null>(null);
  const [convo, setConvo] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [awaiting, setAwaiting] = useState<ToolCall[]>([]);
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [activeNodes, setActiveNodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [injected, setInjected] = useState<Injected>();
  const [checkpoint, setCheckpoint] = useState<Checkpoint>();
  const [threadId, setThreadId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const version = useRef(0);

  const applyThread = useCallback((thread: ThreadView) => {
    setThreadId(thread.id);
    setConvo(thread.messages);
    setAwaiting(thread.pending);
    setCheckpoint(thread.state);
  }, []);

  const loadTraces = useCallback(async (id: string, active: () => boolean) => {
    const records = await api.traces(id);
    if (active()) setTraces(records);
  }, []);

  useEffect(() => {
    const current = ++version.current;
    const active = () => current === version.current;
    const showError = (e: unknown) => {
      if (active()) setError(String(e));
    };
    api
      .agentGraph(agent.id)
      .then((value) => {
        if (active()) setGraph(value);
      })
      .catch(showError);
    api
      .memory(agent.id)
      .then((value) => {
        if (active()) setMemory(value);
      })
      .catch(showError);
    const saved = readSelection(`thread:${agent.id}`);
    if (saved) {
      api
        .thread(saved)
        .then((thread) => {
          if (!active()) return;
          if (thread.agentId !== agent.id) throw new Error("대화의 에이전트가 일치하지 않습니다");
          applyThread(thread);
          return loadTraces(thread.id, active);
        })
        .catch((e: unknown) => {
          if (!active()) return;
          if (e instanceof ApiError && e.status === 404) {
            saveSelection(`thread:${agent.id}`, null);
            setError("저장된 대화를 찾을 수 없습니다. 새 메시지로 대화를 시작하세요.");
          } else {
            setRestoreFailed(true);
            showError(e);
          }
        })
        .finally(() => {
          if (active()) setLoading(false);
        });
    } else setLoading(false);
    return () => {
      version.current++;
    };
  }, [agent.id, applyThread, loadTraces]);

  async function turn(input: { message: string } | { decision: "allow" | "deny" }) {
    if (pending || loading) return;
    const current = version.current;
    const active = () => current === version.current;
    setPending(true);
    setError("");
    setInjected(undefined);
    let id = threadId;
    try {
      if (!id) {
        const thread = await api.createThread(agent.id);
        if (!active()) return;
        id = thread.id;
        saveSelection(`thread:${agent.id}`, id);
        applyThread(thread);
      }
      const reply = await api.send(id, input);
      if (!active()) return;
      applyThread(reply.thread);
      setInjected(reply.injected);
    } catch (e) {
      if (!active()) return;
      setError(String(e));
      // 응답 유실 시 자동 재전송하지 않고 저장된 상태를 다시 읽는다.
      if (id) {
        try {
          const thread = await api.thread(id);
          if (active()) applyThread(thread);
        } catch {
          /* 원래 오류를 유지한다. */
        }
      }
    } finally {
      if (active()) {
        setPending(false);
        if (id) {
          loadTraces(id, active).catch((e: unknown) => {
            if (active()) setError(String(e));
          });
        }
        api
          .memory(agent.id)
          .then((value) => {
            if (active()) setMemory(value);
          })
          .catch((e: unknown) => {
            if (active()) setError(String(e));
          });
      }
    }
  }

  async function newThread() {
    if (pending || loading) return;
    const current = version.current;
    setPending(true);
    setError("");
    try {
      const thread = await api.createThread(agent.id);
      if (current !== version.current) return;
      saveSelection(`thread:${agent.id}`, thread.id);
      applyThread(thread);
      setTraces([]);
      setActiveNodes([]);
      setInjected(undefined);
      setRestoreFailed(false);
    } catch (e) {
      if (current === version.current) setError(String(e));
    } finally {
      if (current === version.current) setPending(false);
    }
  }
  const send = (text: string) => turn({ message: text });
  const decide = (decision: "allow" | "deny") => turn({ decision });

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="font-semibold text-xl">{agent.name}</h1>
        <p className="mt-1 max-w-3xl text-muted leading-relaxed">{agent.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip kind="model">{agent.model}</Chip>
          {agent.mcpServer ? <Chip kind="warn">🛰 MCP: {agent.mcpServer}</Chip> : null}
          {agent.tools.length ? (
            agent.tools.map((t) =>
              agent.approval?.includes(t) ? (
                <Chip key={t} kind="warn">
                  🔒 {t}
                </Chip>
              ) : (
                <Chip key={t} kind="tool">
                  {agent.mcpServer ? "🛰" : "🔧"} {t}
                </Chip>
              ),
            )
          ) : (
            <Chip kind="plain">툴 없음 · 단발 호출</Chip>
          )}
          {agent.tools.length && !agent.toolsNative ? (
            <Chip kind="warn">툴=프롬프트 흉내</Chip>
          ) : null}
          {agent.maxToolRounds ? <Chip>maxToolRounds {agent.maxToolRounds}</Chip> : null}
        </div>
        {agent.system ? (
          <div className="mt-2.5 whitespace-pre-wrap rounded-md border border-border bg-surface px-2.5 py-2 text-muted text-xs">
            <b className="text-faint">system</b>
            {"\n"}
            {agent.system}
          </div>
        ) : null}
        <p className={`mt-2 text-xs ${agent.ready ? "text-ready" : "text-warn"}`}>
          {agent.ready ? "✓ 바로 사용 가능" : `⚠ 필요: ${agent.need}`}
        </p>
        {agent.mcpError ? (
          <div className="mt-2 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2.5 font-mono text-danger text-xs">
            MCP 서버에 못 붙었다 — 이 에이전트는 툴 없이 떴다.
            {"\n"}
            {agent.mcpError}
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">Graph</h2>
          <Graph graph={graph} activeNodes={activeNodes} />
          <p className="mt-2 text-faint text-xs">
            <b>createAgent</b>가 세운 그래프 — 툴이 있으면 model ⇄ tools 루프, 없으면 단발 호출.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-muted text-xs uppercase tracking-wide">Chat</h2>
            <button
              type="button"
              disabled={pending || loading}
              onClick={newThread}
              className="rounded-md border border-border px-2 py-1 text-muted text-xs disabled:opacity-50"
            >
              새 대화
            </button>
          </div>
          {loading ? <p className="text-muted text-xs">저장된 대화를 불러오는 중…</p> : null}
          {injected ? <InjectedBanner injected={injected} /> : null}
          <ChatLog messages={convo} pending={pending} empty="메시지를 보내면 대화가 시작된다." />
          {awaiting.length > 0 ? (
            <ApprovalPanel calls={awaiting} busy={pending} onDecide={decide} />
          ) : null}
          {agent.budget === undefined ? null : <StatePanel agent={agent} checkpoint={checkpoint} />}
          <Composer
            key={threadId ?? "new"}
            onSend={send}
            disabled={pending || loading || restoreFailed || awaiting.length > 0}
          />
          {error ? (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2.5 font-mono text-danger text-xs">
              {error}
            </div>
          ) : null}
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">
          실행 트레이스
        </h2>
        <TraceView records={traces} onActiveNodes={setActiveNodes} />
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-1 font-semibold text-muted text-xs uppercase tracking-wide">
          이 에이전트가 기억한 것
        </h2>
        <p className="mb-3 text-faint text-xs">
          승인/거부가 쌓여 문장이 되고, 그 문장이 다음 턴의 <b>system</b>으로 간다. 격리 키는
          에이전트 하나 — <b>사용자 축이 없다</b>. 대화 상태는 thread별로 분리하고 기억은
          에이전트별로 공유합니다.
        </p>
        <Memory view={memory} injectedId={injected?.fact.id} />
      </section>
    </div>
  );
}
