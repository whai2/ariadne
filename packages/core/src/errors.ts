/**
 * 채널이 비어있을 때(아직 한 번도 안 써짐) 값을 읽으려 하면 던진다.
 * langgraph 대응: EmptyChannelError.
 */
export class EmptyChannelError extends Error {
  constructor(message = "채널이 비어있다 (아직 값이 없음).") {
    super(message);
    this.name = "EmptyChannelError";
  }
}

/**
 * 한 스텝에 유효하지 않은 업데이트가 오면 던진다.
 * (예: LastValue에 한 스텝 여러 값 → 리듀서 채널이 필요하다, V3)
 * langgraph 대응: InvalidUpdateError.
 */
export class InvalidUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUpdateError";
  }
}

/** 노드 본문 또는 writer 실패. 원래 예외는 cause에 보존한다. */
export class NodeExecutionError extends Error {
  constructor(
    readonly node: string,
    readonly step: number,
    readonly taskId: string,
    cause: unknown,
  ) {
    super(
      `노드 '${node}' 실행 실패 (step ${step}, task ${taskId}): ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "NodeExecutionError";
  }
}
