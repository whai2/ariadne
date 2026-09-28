import { useEffect, useState } from "react";
import { api, type EvalRecord, type EvalReport, type EvalSuite } from "../api";

function observedTools(record?: EvalRecord): string[] {
  return (
    record?.messages.flatMap((message) => message.toolCalls?.map((call) => call.name) ?? []) ?? []
  );
}

export function EvalView() {
  const [suite, setSuite] = useState<EvalSuite>();
  const [report, setReport] = useState<EvalReport>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .evalSuite()
      .then((value) => {
        if (active) setSuite(value);
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);

  async function run() {
    if (running) return;
    setRunning(true);
    setError("");
    try {
      setReport(await api.runEvals());
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-xl">Evals</h1>
          <p className="mt-1 max-w-3xl text-muted leading-relaxed">
            BFCL의 고정 12건을 Studio와 같은 Claude Code 에이전트·그래프·트레이스로 실행합니다.
          </p>
          {suite ? (
            <p className="mt-2 font-mono text-faint text-xs">
              {suite.name}@{suite.version} · {suite.model} · {suite.cases.length} cases
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={running || suite === undefined}
          onClick={run}
          className="rounded-md bg-fg px-4 py-2 font-semibold text-bg text-sm disabled:opacity-50"
        >
          {running ? "12개 실행 중…" : "전체 실행"}
        </button>
      </header>

      <div className="mb-4 rounded-md border border-warn/40 bg-warn/10 p-3 text-muted text-xs">
        <b className="text-warn">F7.1 — 기록 단계</b>
        <span className="ml-2">
          이번 단계는 기대 호출과 관측 호출을 나란히 보존하지만 아직 점수를 매기지 않습니다.
          tool·argument 메트릭은 다음 단계에서 같은 기록 위에 올라갑니다.
        </span>
      </div>

      {report ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["cases", report.caseCount],
            ["trials", report.trialCount],
            ["completed", report.completed],
            ["errors", report.failed],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-border bg-surface p-3">
              <div className="text-faint text-xs uppercase">{label}</div>
              <div className="mt-1 font-mono text-lg">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 whitespace-pre-wrap rounded-md border border-danger/40 bg-danger/10 p-3 font-mono text-danger text-xs">
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        {suite?.cases.map((item) => {
          const record = report?.records.find((candidate) => candidate.caseId === item.id);
          const observed = observedTools(record);
          return (
            <section key={item.id} className="rounded-lg border border-border bg-surface p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono text-fg text-xs">{item.id}</div>
                <div
                  className={`text-xs ${record?.error ? "text-danger" : record ? "text-ready" : "text-faint"}`}
                >
                  {record?.error ? "실행 오류" : record ? "기록 완료" : "대기"}
                </div>
              </div>
              <p className="mt-2 text-muted text-sm">{item.prompt}</p>
              <div className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-3">
                <span className="text-faint">제공: {item.tools.join(", ")}</span>
                <span className="text-faint">
                  기대: {item.expectedTools.length ? item.expectedTools.join(", ") : "호출 없음"}
                </span>
                <span className={record ? "text-tool" : "text-faint"}>
                  관측: {record ? observed.join(", ") || "호출 없음" : "—"}
                </span>
              </div>
              {record ? (
                <p className="mt-1.5 text-faint text-xs">
                  {(record.endedAt - record.startedAt) / 1000}s · {record.spans.length} spans
                </p>
              ) : null}
              {record?.error ? (
                <p className="mt-2 font-mono text-danger text-xs">
                  {record.error.name}: {record.error.message}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
