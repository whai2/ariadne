# S2 · Studio Channels 뷰

## 무엇을 만들었나
스튜디오가 스텝마다 **채널 패널**을 보여준다: 각 채널의 `key / type / available / value`.
이제 V2에서 바뀐 "상태 = 채널들의 집합"이 눈에 보인다.
```
Step 2: shout
  channel   type          state          value
  text      [LastValue]   ● available    "hi → 안녕!"
  steps     [LastValue]   ● available    2
```

## 또다시: Studio가 core를 진화시킴
S1과 같은 패턴. 채널을 보여주려면 `stream`이 합쳐진 상태만이 아니라 **채널 스냅샷**을 내보내야 했다.
- `BaseChannel.kind`(표시용 타입 이름) 추가.
- `ChannelSnapshot { key, type, available, value? }` 타입.
- `StepUpdate`에 `channels: ChannelSnapshot[]` 추가 → `stream`이 스텝마다 `snapshotChannels()`를 함께 yield.
- 겉 동작 불변(기존 테스트 통과), 데이터만 풍부해짐.

## 이 패널의 값어치 (앞으로의 창)
지금은 전부 `[LastValue] available`이라 밋밋하지만, 이 창은 앞으로의 변화를 계속 보여준다:
- **V3**: 리듀서를 단 키가 `[BinaryOperatorAggregate]`로 뜬다 → "이 채널은 누적 정책"이 눈에 보임.
- **V4**: 한 채널에 여러 노드가 쓰는 것, "스텝당 1회" 규칙, 트리거 채널(Ephemeral)의 available↔empty 깜빡임이 보임.

즉 S2는 "채널이라는 추상"을 관찰 가능하게 만들어, 이후 엔진 진화가 스튜디오에서 실감나게 드러나도록 하는 토대.

## 경계 유지
core는 여전히 스튜디오를 모른다 — `kind`/`ChannelSnapshot`은 일반 관찰 API일 뿐. 스튜디오가 그걸 소비만 한다.
