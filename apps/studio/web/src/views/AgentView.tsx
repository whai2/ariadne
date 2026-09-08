import { useEffect, useState } from "react";
import {
  type AgentInfo,
  api,
  type GraphView,
  type Message,
  type StepUpdate,
  type ToolCall,
} from "../api";
import { ChatLog, Composer } from "../components/Chat";
import { Graph } from "../components/Graph";
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

/**
 * 승인 대기 패널 (F3.3). **여기가 사람이 루프 사이에 서는 자리다.**
 *
 * 승인/거부 둘 다 `agentChat`을 다시 부를 뿐이다 — 재개에 새 엔드포인트도 세션 id도 없는 건
 * 이 에이전트의 상태가 전부 `messages`이고 그걸 이 컴포넌트가 쥐고 있어서다.
 */
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

/** 등록된 에이전트 하나의 상세 — 설정 요약(칩) + 그래프 + 대화 + 스텝. Mastra 에이전트 페이지 대응. */
export function AgentView({ agent }: { agent: AgentInfo }) {
  const [graph, setGraph] = useState<GraphView | { error: string } | null>(null);
  const [convo, setConvo] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [awaiting, setAwaiting] = useState<ToolCall[]>([]);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [error, setError] = useState("");

  // 에이전트를 바꾸면 대화·스텝·그래프를 새로 — 이전 에이전트의 상태가 새지 않게.
  useEffect(() => {
    setConvo([]);
    setSteps([]);
    setAwaiting([]);
    setError("");
    setGraph(null);
    api.agentGraph(agent.id).then(setGraph);
  }, [agent.id]);

  /**
   * 한 번의 왕복. **보내기와 재개가 같은 함수다** — 다른 건 `decision` 한 글자뿐이고,
   * 그게 F3.3이 "재개 = 같은 이력으로 새 run"이라고 말한 것의 UI 쪽 모습이다.
   */
  async function turn(history: Message[], decision?: "allow" | "deny") {
    setConvo(history);
    setPending(true);
    setAwaiting([]);
    setError("");
    setSteps([]);
    const res = await api.agentChat(agent.id, history, decision);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConvo(history.concat(res.messages));
    setSteps(res.steps);
    // 멈췄으면 새 메시지가 0개라, 이 필드가 없으면 빈 응답과 구별이 안 된다.
    setAwaiting(res.pending ?? []);
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
              // 승인이 걸린 툴은 색부터 다르다 — 어느 툴이 사람을 부르는지 부르기 전에 보인다.
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
          <ChatLog messages={convo} pending={pending} empty="메시지를 보내면 대화가 시작된다." />
          {awaiting.length > 0 ? (
            <ApprovalPanel calls={awaiting} busy={pending} onDecide={decide} />
          ) : null}
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
    </div>
  );
}
