// pregel/ — 실행 엔진. 채널·태스크·superstep만 안다.
//
// **graph/를 절대 import하지 않는다.** StateGraph도 Command도 조건부 엣지도 모른 채,
// `PregelSpec`(낮춰진 그래프) 하나만 받아 돌린다. 그 격리를 지키는 게 불변식 3의 실체다.
// (regression guard: test/architecture.test.ts)

export {
  applyWrites,
  checkpointChannels,
  expireStale,
  localRead,
  prepareNextTasks,
  readChannels,
  snapshotChannels,
  type Task,
} from "./algo";
export { CompiledGraph, type StreamOptions } from "./loop";
export type { BoundFn, ChannelWriteEntry, PregelNode, Writer } from "./node";
export type {
  ChannelCheckpoint,
  ChannelSnapshot,
  Channels,
  GraphEdge,
  GraphView,
  PregelSpec,
  StepUpdate,
  TaskUpdate,
} from "./types";
