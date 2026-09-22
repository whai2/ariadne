import { useEffect, useMemo, useState } from "react";
import type { Span, TraceRecord } from "../api";

function duration(span: Span): number {
  return Math.max(0, (span.endedAt ?? span.startedAt) - span.startedAt);
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortValue(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text === undefined ? "undefined" : text;
}

function usage(spans: readonly Span[]): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const span of spans) {
    if (span.kind !== "model") continue;
    input += Number(span.attributes["gen_ai.usage.input_tokens"] ?? 0);
    output += Number(span.attributes["gen_ai.usage.output_tokens"] ?? 0);
  }
  return { input, output };
}

function spanChildren(spans: readonly Span[]): Map<string, Span[]> {
  const children = new Map<string, Span[]>();
  for (const span of spans) {
    if (span.parentId === undefined) continue;
    const found = children.get(span.parentId) ?? [];
    found.push(span);
    children.set(span.parentId, found);
  }
  return children;
}

function keyedWrites(value: unknown): Array<{ key: string; channel?: unknown; value?: unknown }> {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, number>();
  return value.map((write) => {
    const entry = write as { channel?: unknown; value?: unknown };
    const signature = `${String(entry.channel)}:${shortValue(entry.value)}`;
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    return { key: `${signature}:${occurrence}`, ...entry };
  });
}

function TimelineRow({ span, root }: { span: Span; root: Span }) {
  const total = Math.max(1, (root.endedAt ?? root.startedAt) - root.startedAt);
  const left = ((span.startedAt - root.startedAt) / total) * 100;
  const width = Math.max(1.5, (duration(span) / total) * 100);
  const kindColor =
    span.status === "error"
      ? "bg-danger"
      : span.kind === "model"
        ? "bg-aimsg"
        : span.kind === "tool"
          ? "bg-tool"
          : "bg-accent";
  return (
    <div className="grid grid-cols-[9rem_1fr_4rem] items-center gap-2 py-0.5 text-xs">
      <span className="truncate font-mono text-muted">{span.name}</span>
      <div className="relative h-3 rounded bg-surface-2">
        <span
          className={`absolute top-0 h-3 rounded ${kindColor}`}
          style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
        />
      </div>
      <span className="text-right font-mono text-faint">{duration(span)}ms</span>
    </div>
  );
}

export function TraceView({
  records,
  onActiveNodes,
}: {
  records: TraceRecord[];
  onActiveNodes: (nodes: string[]) => void;
}) {
  const [traceId, setTraceId] = useState<string>();
  const [stepId, setStepId] = useState<string>();
  const selected = records.find((record) => record.traceId === traceId) ?? records[0];
  const children = useMemo(() => spanChildren(selected?.spans ?? []), [selected]);
  const root = selected?.spans.find((span) => span.parentId === undefined);
  const steps = useMemo(
    () => (root === undefined ? [] : (children.get(root.spanId) ?? [])),
    [children, root],
  );
  const selectedStep = steps.find((span) => span.spanId === stepId) ?? steps[0];

  useEffect(() => {
    if (selected === undefined) {
      setTraceId(undefined);
      setStepId(undefined);
      onActiveNodes([]);
      return;
    }
    if (traceId !== selected.traceId) setTraceId(selected.traceId);
    const nextStep = selectedStep ?? steps[0];
    if (nextStep !== undefined && stepId !== nextStep.spanId) setStepId(nextStep.spanId);
    onActiveNodes(
      nextStep === undefined
        ? []
        : (children.get(nextStep.spanId) ?? [])
            .filter((span) => span.kind === "node")
            .map((span) => span.name),
    );
  }, [children, onActiveNodes, selected, selectedStep, stepId, steps, traceId]);

  if (selected === undefined || root === undefined) {
    return <p className="text-muted text-xs">메시지를 보내면 실행 트레이스가 여기에 남습니다.</p>;
  }
  const tokens = usage(selected.spans);
  const nodes = selectedStep === undefined ? [] : (children.get(selectedStep.spanId) ?? []);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {records.map((record, index) => (
          <button
            type="button"
            key={record.traceId}
            onClick={() => {
              setTraceId(record.traceId);
              setStepId(undefined);
            }}
            className={`rounded-md border px-2.5 py-1.5 text-left text-xs ${record.traceId === selected.traceId ? "border-accent bg-accent/10 text-fg" : "border-border text-muted"}`}
          >
            <b>Run {records.length - index}</b> · {clock(record.startedAt)} · {record.status}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-surface-2 px-2 py-1">총 {duration(root)}ms</span>
        <span className="rounded bg-surface-2 px-2 py-1">
          입력 {tokens.input.toLocaleString()} tokens
        </span>
        <span className="rounded bg-surface-2 px-2 py-1">
          출력 {tokens.output.toLocaleString()} tokens
        </span>
        <span className="rounded bg-surface-2 px-2 py-1">{steps.length} supersteps</span>
      </div>

      <div className="rounded-md border border-border p-2.5">
        {selected.spans
          .filter((span) => span.kind !== "run")
          .map((span) => (
            <TimelineRow key={span.spanId} span={span} root={root} />
          ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {steps.map((step) => (
          <button
            type="button"
            key={step.spanId}
            onClick={() => setStepId(step.spanId)}
            className={`rounded px-2 py-1 font-mono text-xs ${step.spanId === selectedStep?.spanId ? "bg-accent text-bg" : "bg-surface-2 text-muted"}`}
          >
            Step {String(step.attributes["ariadne.superstep"])}
          </button>
        ))}
      </div>

      {selectedStep === undefined ? null : (
        <div className="mt-3 space-y-2">
          {nodes.map((node) => {
            const writes = node.attributes["ariadne.channel.writes"];
            return (
              <div key={node.spanId} className="rounded-md border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <b className="font-mono text-aimsg text-xs">{node.name}</b>
                  <span className="font-mono text-faint text-xs">{duration(node)}ms</span>
                </div>
                {node.error ? (
                  <p className="mt-2 text-danger text-xs">
                    {node.error.name}: {node.error.message}
                  </p>
                ) : null}
                <div className="mt-2 space-y-2">
                  {keyedWrites(writes).map((entry) => {
                    return (
                      <div key={entry.key}>
                        <div className="mb-1 font-semibold text-tool text-xs">
                          → {String(entry.channel)}
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-2 font-mono text-fg text-xs">
                          {shortValue(entry.value)}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
