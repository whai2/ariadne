import { useEffect, useState } from "react";
import { type AgentInfo, api, type GraphView, type Message, type StepUpdate } from "../api";
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

/** 등록된 에이전트 하나의 상세 — 설정 요약(칩) + 그래프 + 대화 + 스텝. Mastra 에이전트 페이지 대응. */
export function AgentView({ agent }: { agent: AgentInfo }) {
  const [graph, setGraph] = useState<GraphView | { error: string } | null>(null);
  const [convo, setConvo] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [error, setError] = useState("");

  // 에이전트를 바꾸면 대화·스텝·그래프를 새로 — 이전 에이전트의 상태가 새지 않게.
  useEffect(() => {
    setConvo([]);
    setSteps([]);
    setError("");
    setGraph(null);
    api.agentGraph(agent.id).then(setGraph);
  }, [agent.id]);

  async function send(text: string) {
    const next: Message[] = [...convo, { role: "human", content: text }];
    setConvo(next);
    setPending(true);
    setError("");
    setSteps([]);
    const res = await api.agentChat(agent.id, next);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConvo(next.concat(res.messages));
    setSteps(res.steps);
  }

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="font-semibold text-xl">{agent.name}</h1>
        <p className="mt-1 max-w-3xl text-muted leading-relaxed">{agent.description}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip kind="model">{agent.model}</Chip>
          {agent.mcpServer ? <Chip kind="warn">🛰 MCP: {agent.mcpServer}</Chip> : null}
          {agent.tools.length ? (
            agent.tools.map((t) => (
              <Chip key={t} kind="tool">
                {agent.mcpServer ? "🛰" : "🔧"} {t}
              </Chip>
            ))
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
          <Composer onSend={send} disabled={pending} />
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
