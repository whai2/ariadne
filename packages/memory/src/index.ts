// @ariadne/memory — 메모리 링의 공개 배럴.
//
// 지금 담는 건 둘뿐이다 — **에이전트가 겪은 일**(episodes)과 **사람이 내린 결정**(value_events).
// 이 단계(F4.1)는 **쌓기만 한다.** 아무도 안 읽고, 동작은 한 글자도 안 바뀐다.
//
// **왜 그 둘을 갈랐나.** 표준적인 방법은 세션이 끝날 때 LLM에게 "중요한 걸 요약해"라고 시키는
// 것이다. 그건 무엇이 중요한지를 **쓰는 시점에** 판단하는 건데, 그때는 알 수 없다 —
// 중요성은 저장의 속성이 아니라 **사용의 결과**다. 그래서 내용과 가치를 다른 테이블로 흘려보내고,
// 가치 쪽엔 해석을 하나도 안 넣는다(거부됐다는 사실만, 왜인지는 안 적는다).
//
// **런타임 의존성 0.** `bun:sqlite`가 Bun 내장이고 core는 타입으로만 쓴다 — core 다음으로
// deps가 0인 두 번째 패키지다. F1의 `@anthropic-ai/sdk` 이후 바깥 링은 늘 SDK를 달고 왔는데
// 여기선 안 그랬다.
//
// 참조: langgraph `libs/checkpoint/langgraph/store/base` — 원본도 **체크포인터(실행 상태)와
// 스토어(장기 기억)를 다른 것으로** 갈라놨다. 우리가 만드는 건 뒤쪽이다.

export type {
  EpisodeRow,
  EpisodeStatus,
  ValueEventKind,
  ValueEventRow,
} from "./schema";
export { migrate, SCHEMA_SQL } from "./schema";
export type { MemoryStoreOptions } from "./store";
export { MemoryStore } from "./store";
