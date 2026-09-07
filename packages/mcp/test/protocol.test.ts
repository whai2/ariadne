import { describe, expect, test } from "bun:test";
import { asResponse, encodeFrame, splitFrames } from "../src/protocol";

describe("encodeFrame", () => {
  test("개행으로 끝난다 — 그게 프레임 경계다", () => {
    expect(encodeFrame({ a: 1 })).toBe('{"a":1}\n');
  });
});

describe("splitFrames", () => {
  test("한 chunk에 여러 프레임이 와도 다 가른다", () => {
    const { frames, rest } = splitFrames('{"id":1}\n{"id":2}\n');
    expect(frames).toEqual(['{"id":1}', '{"id":2}']);
    expect(rest).toBe("");
  });

  test("잘린 꼬리는 남긴다 — 다음 chunk 앞에 붙여야 한다", () => {
    const { frames, rest } = splitFrames('{"id":1}\n{"id":');
    expect(frames).toEqual(['{"id":1}']);
    expect(rest).toBe('{"id":');
  });

  test("이어 붙이면 완성된다", () => {
    const first = splitFrames('{"id":');
    const second = splitFrames(`${first.rest}2}\n`);
    expect(second.frames).toEqual(['{"id":2}']);
  });

  test("빈 줄은 버린다", () => {
    expect(splitFrames('\n\n{"id":1}\n').frames).toEqual(['{"id":1}']);
  });
});

describe("asResponse", () => {
  test("id + result면 응답", () => {
    expect(asResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  test("id + error도 응답이다 — 거절도 답이다", () => {
    const res = asResponse('{"jsonrpc":"2.0","id":7,"error":{"code":-32601,"message":"없다"}}');
    expect(res?.error?.code).toBe(-32601);
  });

  test("알림(id 없음)은 응답이 아니다", () => {
    expect(
      asResponse('{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}'),
    ).toBeUndefined();
  });

  test("역방향 요청(id는 있지만 method)도 흘린다 — 우리는 능력을 선언하지 않았다", () => {
    expect(
      asResponse('{"jsonrpc":"2.0","id":1,"method":"sampling/createMessage"}'),
    ).toBeUndefined();
  });

  test("깨진 줄은 던지지 않고 흘린다 — 서버가 stdout에 로그를 흘리는 사고가 흔하다", () => {
    expect(asResponse("[server] listening on stdio")).toBeUndefined();
  });
});
