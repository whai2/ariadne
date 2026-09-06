// 툴 링이 던지는 에러. 하나뿐이다 — 나머지는 전부 **에러 메시지로 모델에게 돌려준다**.

/**
 * `Command`를 돌려준 툴이 **자기 결과 메시지를 안 만들었다.**
 *
 * 왜 에러인가: 툴 호출 하나에는 그 id를 가진 결과가 정확히 하나 있어야 한다. 없으면 답 없는
 * `tool_use`가 이력에 남고, **다음 모델 호출이 양쪽 프로바이더에서 하드 400**이다.
 * 일반 툴은 toolNode가 결과를 만들어주지만, `Command`를 돌려주는 툴은 자기 update로
 * 메시지를 통째로 정하므로 그 책임이 툴 저자에게 넘어간다.
 *
 * **빈 메시지로 자동 보충하지 않는 이유:** 모델이 빈 결과를 보고 같은 툴을 다시 부르는
 * 조용한 무한 루프가 된다. 툴 저자의 테스트에서 터지는 게 낫다.
 *
 * langgraph 대응: prebuilt/tool_node.py 의 `_validate_tool_command`(같은 규칙, 같은 이유).
 */
export class MissingToolMessageError extends Error {
  readonly toolName: string;
  readonly toolCallId: string;
  constructor(toolName: string, toolCallId: string) {
    super(
      `'${toolName}'가 Command를 돌려줬는데 자기 결과 메시지가 없다 — ` +
        `update.messages에 tool("${toolCallId}", …)를 넣어야 한다. ` +
        `안 넣으면 답 없는 tool_use가 남아 다음 모델 호출이 400이 된다.`,
    );
    this.name = "MissingToolMessageError";
    this.toolName = toolName;
    this.toolCallId = toolCallId;
  }
}
