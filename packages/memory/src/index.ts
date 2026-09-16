// @ariadne/memory — 장기 기억과 실행 상태를 저장하는 메모리 링.
// facts는 모델에 주입할 기억이고, checkpoints는 다음 run을 복원할 상태다.
// 저장소를 공유하지만 두 데이터의 조회·사용 경로는 분리한다.

export type { Checkpoint, CheckpointSnapshot } from "./checkpoint";
export type { FactDraft } from "./consolidate";
export { DENY_THRESHOLD, proposeFacts } from "./consolidate";
export type {
  EpisodeRow,
  EpisodeStatus,
  FactLevel,
  FactRow,
  InjectionOutcome,
  InjectionRow,
  ScoredFact,
  ValueEventKind,
  ValueEventRow,
} from "./schema";
export { migrate, SCHEMA_SQL } from "./schema";
export { chooseFact, judge } from "./select";
export type { MemoryStoreOptions } from "./store";
export { MemoryStore } from "./store";
