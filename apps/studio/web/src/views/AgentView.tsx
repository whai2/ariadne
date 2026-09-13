import { useEffect, useState } from "react";
import {
  type AgentInfo,
  api,
  type Checkpoint,
  type GraphView,
  type Injected,
  type MemoryView,
  type Message,
  type StepUpdate,
  type ToolCall,
} from "../api";
import { ChatLog, Composer } from "../components/Chat";
import { Graph } from "../components/Graph";
import { Memory, OUTCOME } from "../components/Memory";
import { Steps } from "../components/Steps";

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
        승인하기 전까지 <b>아무 일도 일어나지 않았다</b> — run은 툴 직전에 끝났고, 대화가 곧
        체크포인트다.
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

/**
 * 실행 상태 — 이 에이전트가 대화 말고 무엇을 들고 있나 (F5.2).
 *
 * **체크포인트를 끄면 매 턴 초기값으로 돌아간다.** 승인 왕복은 멀쩡히 도는데 예산만
 * 조용히 리셋된다 — 아무도 안 알려주는 그 실패를 눈으로 보라고 만든 토글이다.
 */
function StatePanel({
  agent,
  checkpoint,
  use,
  busy,
  onToggle,
}: {
  agent: AgentInfo;
  checkpoint?: Checkpoint;
  use: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  const keys = checkpoint === undefined ? [] : Object.keys(checkpoint);
  const budget = checkpoint?.budget;
  const held = Array.isArray(checkpoint?.messages) ? checkpoint.messages.length : 0;
  return (
    <div className="mt-2.5 rounded-md border border-border bg-surface-2 p-2.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-muted text-xs">💾 실행 상태</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-faint text-xs">
          <input
            type="checkbox"
            checked={use}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          체크포인트로 이어 돌리기
        </label>
      </div>
      <p className="mt-1.5 font-mono text-fg text-xs">
        남은 예산 {typeof budget === "number" ? budget : "—"} / {agent.budget}
      </p>
      <p className="mt-1 font-mono text-faint text-xs">
        {keys.length === 0 ? "아직 없음" : `채널 [${keys.join(", ")}] · 이력 ${held}개 포함`}
      </p>
      <p className="mt-1.5 text-faint text-xs">
        {use ? (
          <>
            <b>켜짐</b> — 보내는 건 <b>새 메시지 하나</b>뿐이고 나머지는 복원에서 온다. 예산이
            턴마다 1씩 줄어든다.
          </>
        ) : (
          <>
            <b>꺼짐</b> — 이력 전체를 매 턴 다시 보낸다. 대화는 이어지는데{" "}
            <b>예산은 매 턴 리셋된다.</b>
          </>
        )}
      </p>
    </div>
  );
}

export function AgentView({ agent }: { agent: AgentInfo }) {
  const [graph, setGraph] = useState<GraphView | { error: string } | null>(null);
  const [convo, setConvo] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [awaiting, setAwaiting] = useState<ToolCall[]>([]);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [error, setError] = useState("");
  const [memory, setMemory] = useState<MemoryView | null>(null);
  const [injected, setInjected] = useState<Injected>();
  const [checkpoint, setCheckpoint] = useState<Checkpoint>();
  const [useCheckpoint, setUseCheckpoint] = useState(true);

  useEffect(() => {
    setConvo([]);
    setSteps([]);
    setAwaiting([]);
    setError("");
    setGraph(null);
    setMemory(null);
    setInjected(undefined);
    setCheckpoint(undefined);
    api.agentGraph(agent.id).then(setGraph);
    api.memory(agent.id).then(setMemory);
  }, [agent.id]);

  async function turn(history: Message[], decision?: "allow" | "deny") {
    setConvo(history);
    setPending(true);
    setAwaiting([]);
    setError("");
    setSteps([]);
    setInjected(undefined);

    // 체크포인트를 쓰면 **복원에 이미 들어 있는 만큼은 빼고** 보낸다. 그게 "새것만"의 뜻이고,
    // 안 빼면 누적 채널이 두 배가 되고 이력이 두 벌이 된다.
    const carried = useCheckpoint ? checkpoint : undefined;
    const held = Array.isArray(carried?.messages) ? (carried.messages as Message[]).length : 0;
    const outgoing = carried === undefined ? history : history.slice(held);

    const res = await api.agentChat(agent.id, outgoing, decision, carried);
    setPending(false);
    // 턴이 실패해도 다시 읽는다 — 에피소드는 `finally`에서 닫히므로 실패한 run도 행으로 남는다.
    api.memory(agent.id).then(setMemory);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConvo(history.concat(res.messages));
    setSteps(res.steps);
    setAwaiting(res.pending ?? []);
    setInjected(res.injected);
    setCheckpoint(res.checkpoint);
  }

  const send = (text: string) => turn([...convo, { role: "human", content: text }]);
  const decide = (decision: "allow" | "deny") => turn(convo, decision);

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
          <Graph graph={graph} />
          <p className="mt-2 text-faint text-xs">
            <b>createAgent</b>가 세운 그래프 — 툴이 있으면 model ⇄ tools 루프, 없으면 단발 호출.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">Chat</h2>
          {injected ? <InjectedBanner injected={injected} /> : null}
          <ChatLog messages={convo} pending={pending} empty="메시지를 보내면 대화가 시작된다." />
          {awaiting.length > 0 ? (
            <ApprovalPanel calls={awaiting} busy={pending} onDecide={decide} />
          ) : null}
          {agent.budget === undefined ? null : (
            <StatePanel
              agent={agent}
              checkpoint={checkpoint}
              use={useCheckpoint}
              busy={pending}
              onToggle={setUseCheckpoint}
            />
          )}
          <Composer onSend={send} disabled={pending || awaiting.length > 0} />
          {error ? (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2.5 font-mono text-danger text-xs">
              {error}
            </div>
          ) : null}
        </section>
      </div>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">
          이번 턴에 엔진이 한 일
        </h2>
        <Steps steps={steps} />
      </section>

      <section className="mt-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-1 font-semibold text-muted text-xs uppercase tracking-wide">
          이 에이전트가 기억한 것
        </h2>
        <p className="mb-3 text-faint text-xs">
          승인/거부가 쌓여 문장이 되고, 그 문장이 다음 턴의 <b>system</b>으로 간다. 격리 키는
          에이전트 하나 — <b>사용자 축이 없다</b>(세션이 들어오면 먼저 깨질 자리).
        </p>
        <Memory view={memory} injectedId={injected?.fact.id} />
      </section>
    </div>
  );
}
