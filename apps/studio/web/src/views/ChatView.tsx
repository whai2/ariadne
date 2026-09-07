import { useEffect, useMemo, useState } from "react";
import {
  api,
  type GraphView,
  type Message,
  type ProviderInfo,
  type ShapeInfo,
  type StepUpdate,
} from "../api";
import { ChatLog, Composer } from "../components/Chat";
import { Graph } from "../components/Graph";
import { Steps } from "../components/Steps";

/** 자유 실험 — 프로바이더·모양·system을 손으로 골라 대화한다. 엔진 모양을 보는 교보재. */
export function ChatView() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [shapes, setShapes] = useState<ShapeInfo[]>([]);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [shape, setShape] = useState("single");
  const [system, setSystem] = useState("");
  const [graph, setGraph] = useState<GraphView | { error: string } | null>(null);
  const [convo, setConvo] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.providers().then((list) => {
      setProviders(list);
      const first = list.find((p) => p.ready) ?? list[0];
      if (first) {
        setProviderId(first.id);
        setModelId(first.suggested ?? "");
      }
    });
    api.shapes().then(setShapes);
  }, []);

  useEffect(() => {
    api.chatGraph(shape).then(setGraph);
  }, [shape]);

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );
  const shapeInfo = useMemo(() => shapes.find((s) => s.id === shape), [shapes, shape]);
  const promptedWarn = shape === "tools" && provider && !provider.tools;

  async function send(text: string) {
    if (!provider || !modelId) {
      setError("프로바이더와 모델을 고르라");
      return;
    }
    const next: Message[] = [...convo, { role: "human", content: text }];
    setConvo(next);
    setPending(true);
    setError("");
    setSteps([]);
    const res = await api.chat({
      spec: `${provider.id}/${modelId}`,
      messages: next,
      shape,
      ...(system.trim() ? { system: system.trim() } : {}),
    });
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setConvo(next.concat(res.messages));
    setSteps(res.steps);
  }

  const ready = provider?.ready;
  const readyGroup = providers.filter((p) => p.ready);
  const restGroup = providers.filter((p) => !p.ready);

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="font-semibold text-xl">Chat</h1>
        <p className="mt-1 text-muted">
          프로바이더·그래프 모양을 골라 자유롭게 — 대화도 그래프로 돈다.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block font-semibold text-[11px] text-faint uppercase">
                Provider
              </span>
              <select
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs"
                value={providerId}
                onChange={(e) => {
                  setProviderId(e.target.value);
                  const p = providers.find((x) => x.id === e.target.value);
                  setModelId(p?.suggested ?? "");
                }}
              >
                {readyGroup.length ? (
                  <optgroup label={`바로 사용 가능 (${readyGroup.length})`}>
                    {readyGroup.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={`키 필요 (${restGroup.length})`}>
                  {restGroup.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block font-semibold text-[11px] text-faint uppercase">
                Model
              </span>
              <input
                className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="모델 ID"
              />
            </label>
          </div>
          <p className={`mt-1.5 text-xs ${ready ? "text-ready" : "text-warn"}`}>
            {provider ? (ready ? "✓ 바로 사용 가능" : `⚠ 필요: ${provider.need}`) : ""}
          </p>

          <label className="mt-2 block">
            <span className="mb-1 block font-semibold text-[11px] text-faint uppercase">Graph</span>
            <select
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs"
              value={shape}
              onChange={(e) => setShape(e.target.value)}
            >
              {shapes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {shapeInfo ? (
            <p className="mt-1 text-faint text-xs">
              {shapeInfo.description} (모델 호출 {shapeInfo.calls}회)
            </p>
          ) : null}
          {promptedWarn ? (
            <p className="mt-1 text-warn text-xs">
              ℹ {provider?.name}는 툴을 네이티브로 못 실어 프롬프트로 흉내 낸다 — 루프는 그대로 우리
              그래프 안에서 돌지만 네이티브(anthropic·openai)보다 덜 안정적이다.
            </p>
          ) : null}

          <label className="mt-2 block">
            <span className="mb-1 block font-semibold text-[11px] text-faint uppercase">
              System (선택)
            </span>
            <input
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs"
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="예: 간결하게 한국어로 답한다."
            />
          </label>

          <div className="mt-3">
            <ChatLog messages={convo} pending={pending} empty="메시지를 보내면 대화가 시작된다." />
            <Composer onSend={send} disabled={pending} />
          </div>
          {error ? (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2.5 font-mono text-danger text-xs">
              {error}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">
            이번 턴에 엔진이 한 일
          </h2>
          <Graph graph={graph} />
          <div className="mt-3">
            <Steps steps={steps} empty="보내면 스텝·채널이 여기 뜬다." />
          </div>
        </section>
      </div>
    </div>
  );
}
