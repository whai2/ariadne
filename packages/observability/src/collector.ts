import { hexId, type Span, SpanContext, type SpanOptions, snapshot, type TraceError } from "./span";

export interface SpanTree extends Span {
  children: SpanTree[];
}

/** 명시적으로 소유하고 비우는 메모리 저장소. I/O·전역 singleton·외부 전송은 없다. */
export class TraceCollector {
  private readonly records = new Map<string, Span>();
  private readonly contexts = new Map<string, SpanContext>();
  private readonly children = new Map<string, SpanContext[]>();

  startRun(name = "run", attributes: Record<string, unknown> = {}, input?: unknown): SpanContext {
    return this.create({ kind: "run", name, attributes, input });
  }
  private create(options: SpanOptions, parent?: SpanContext): SpanContext {
    const data: Span = {
      traceId: parent?.traceId ?? hexId(16),
      spanId: hexId(8),
      ...(parent === undefined ? {} : { parentId: parent.spanId }),
      kind: options.kind,
      name: options.name,
      startedAt: options.startedAt ?? Date.now(),
      status: "running",
      attributes: {},
      input: snapshot(options.input),
    };
    const context = new SpanContext(
      data,
      (child, owner) => this.create(child, owner),
      (owner, endedAt, error) => {
        for (const child of this.children.get(owner.spanId) ?? []) {
          if (child.isOpen)
            child.end({
              endedAt,
              error: error ?? {
                name: "IncompleteSpan",
                message: "Parent ended before operation settled",
              },
              attributes: { "ariadne.incomplete": true },
            });
        }
      },
    );
    context.set(options.attributes ?? {});
    // 종료된 작업에서 뒤늦게 호출해도 닫힌 트레이스를 다시 열지 않는다.
    if (parent !== undefined && !parent.isOpen) {
      context.end({ error: { name: "TraceClosed", message: "Parent span is closed" } });
      return context;
    }
    if (parent !== undefined) {
      const siblings = this.children.get(parent.spanId) ?? [];
      siblings.push(context);
      this.children.set(parent.spanId, siblings);
    }
    this.records.set(data.spanId, data);
    this.contexts.set(data.spanId, context);
    return context;
  }
  finishRun(root: SpanContext, output?: unknown, error?: TraceError): void {
    if (!root.isOpen) return;
    // 열린 자식은 부모의 종료 시각에 미완료로 닫힌다. 실행 자체를 취소하지 않는다.
    root.end({ output, ...(error === undefined ? {} : { error }) });
  }

  spans(traceId?: string): Span[] {
    return [...this.records.values()]
      .filter((s) => traceId === undefined || s.traceId === traceId)
      .map((s) => structuredClone(s));
  }
  tree(traceId: string): SpanTree | undefined {
    const spans = this.spans(traceId);
    const nodes = new Map(spans.map((s) => [s.spanId, { ...s, children: [] } as SpanTree]));
    let root: SpanTree | undefined;
    for (const node of nodes.values()) {
      if (node.parentId === undefined) root = node;
      else nodes.get(node.parentId)?.children.push(node);
    }
    return root;
  }
  clear(): void {
    if ([...this.contexts.values()].some((c) => c.isOpen))
      throw new Error("실행 중인 trace는 비울 수 없다.");
    this.records.clear();
    this.contexts.clear();
    this.children.clear();
  }
}
