import { useEffect, useMemo, useState } from "react";
import { api, type ExampleInfo, type GraphView, type StepUpdate } from "../api";
import { Graph } from "../components/Graph";
import { Steps } from "../components/Steps";

/** 예제 갤러리(S1·S2·S4) — 큐레이션된 그래프를 골라 invoke·관찰. 순수 예제는 자격증명 0. */
export function ExamplesView() {
  const [examples, setExamples] = useState<ExampleInfo[]>([]);
  const [id, setId] = useState("");
  const [graph, setGraph] = useState<GraphView | { error: string } | null>(null);
  const [input, setInput] = useState("{}");
  const [modelSpec, setModelSpec] = useState("claude-code/sonnet");
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.examples().then((list) => {
      setExamples(list);
      if (list[0]) setId(list[0].id);
    });
  }, []);

  const current = useMemo(() => examples.find((e) => e.id === id), [examples, id]);

  useEffect(() => {
    if (!id) return;
    setSteps([]);
    setError("");
    api.exampleGraph(id).then(setGraph);
    const ex = examples.find((e) => e.id === id);
    if (ex) setInput(JSON.stringify(ex.sampleInput, null, 2));
  }, [id, examples]);

  async function run() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(input);
    } catch {
      setError("입력 JSON 오류");
      return;
    }
    setRunning(true);
    setError("");
    const res = await api.runExample(id, parsed, current?.live ? modelSpec : undefined);
    setRunning(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setSteps(res.steps);
  }

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="font-semibold text-xl">Examples</h1>
        <p className="mt-1 text-muted">큐레이션된 그래프를 골라 실행하며 엔진 개념을 관찰한다.</p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">Graph</h2>
          <select
            className="mb-2 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs"
            value={id}
            onChange={(e) => setId(e.target.value)}
          >
            {examples.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <p className="mb-2 text-muted text-xs">{current?.description}</p>
          <Graph graph={graph} />
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-muted text-xs uppercase tracking-wide">Run</h2>
          {current?.live ? (
            <>
              <input
                className="mb-2 w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs"
                value={modelSpec}
                onChange={(e) => setModelSpec(e.target.value)}
                placeholder="claude-code/sonnet"
              />
              <p className="mb-2 text-warn text-xs">
                🔴 진짜 모델을 부른다 — 응답까지 몇 초 걸린다.
              </p>
            </>
          ) : null}
          <textarea
            className="w-full resize-y rounded-md border border-border bg-surface-2 px-2.5 py-2 font-mono text-xs"
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="button"
            disabled={running}
            onClick={run}
            className="mt-2 rounded-md bg-accent px-4 py-2 font-semibold text-bg disabled:opacity-50"
          >
            ▶ Invoke
          </button>
          {error ? (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-2.5 font-mono text-danger text-xs">
              {error}
            </div>
          ) : null}
          <div className="mt-3">
            <Steps steps={steps} empty="Invoke를 누르면 스텝·채널이 뜬다." />
          </div>
        </section>
      </div>
    </div>
  );
}
