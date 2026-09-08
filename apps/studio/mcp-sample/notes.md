# Ariadne 한 줄 메모

- 채널이 유일한 공유 가변 상태다. 노드는 채널을 직접 안 만진다.
- superstep = Plan → Execute → Update. step N의 쓰기는 step N+1에서만 보인다(BSP).
- StateGraph는 순수 sugar — compile()이 결국 Pregel로 낮춘다.
- 툴 정의의 입구는 둘: defineTool(zod)와 MCP 서버. 그 뒤로는 구분이 없다.
