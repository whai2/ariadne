export type SpanKind = "run" | "superstep" | "node" | "model" | "tool";
export interface TraceError {
  name: string;
  message: string;
}
export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  kind: SpanKind;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "running" | "ok" | "error";
  attributes: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  error?: TraceError;
}
export interface SpanOptions {
  kind: SpanKind;
  name: string;
  startedAt?: number;
  attributes?: Record<string, unknown>;
  input?: unknown;
}
export interface SpanEnd {
  endedAt?: number;
  output?: unknown;
  attributes?: Record<string, unknown>;
  error?: TraceError;
}

/** 계측용 직렬화 실패가 실제 실행을 실패시키지 않게 한다. */
export function snapshot(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : JSON.parse(json);
  } catch {
    return "[unserializable]";
  }
}
export function describeError(error: unknown): TraceError {
  try {
    return error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: "Error", message: String(error) };
  } catch {
    return { name: "Error", message: "[unserializable error]" };
  }
}
export function hexId(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** 명시적으로 전달하는 부모 핸들. 종료 후 기록 변경과 자식 생성은 무시한다. */
export class SpanContext {
  constructor(
    private readonly data: Span,
    private readonly createChild: (options: SpanOptions, parent: SpanContext) => SpanContext,
    private readonly closeChildren: (
      parent: SpanContext,
      endedAt: number,
      error?: TraceError,
    ) => void,
  ) {}
  get traceId(): string {
    return this.data.traceId;
  }
  get spanId(): string {
    return this.data.spanId;
  }
  get startedAt(): number {
    return this.data.startedAt;
  }
  get isOpen(): boolean {
    return this.data.status === "running";
  }
  child(options: SpanOptions): SpanContext {
    return this.createChild(options, this);
  }
  set(attributes: Record<string, unknown>): void {
    if (!this.isOpen) return;
    // 필드별 복사: 한 순환 값 때문에 나머지 속성을 잃지 않는다.
    for (const [key, value] of Object.entries(attributes))
      this.data.attributes[key] = snapshot(value);
  }
  startAt(time: number): void {
    if (this.isOpen) this.data.startedAt = Math.min(this.data.startedAt, time);
  }
  end(options: SpanEnd = {}): void {
    if (!this.isOpen) return;
    this.set(options.attributes ?? {});
    this.data.output = snapshot(options.output);
    this.data.endedAt = options.endedAt ?? Date.now();
    this.closeChildren(this, this.data.endedAt, options.error);
    this.data.status = options.error === undefined ? "ok" : "error";
    if (options.error !== undefined) this.data.error = { ...options.error };
  }
}
