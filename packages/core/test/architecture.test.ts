import { describe, expect, it } from "bun:test";

/**
 * 폴더 경계를 **실행되는 규칙**으로 고정한다. 주석으로만 써두면 다음 단계에서 새기 때문.
 *
 *   공용 어휘   constants · errors · send · channels/   ← 아래를 모른다
 *      ↑
 *   pregel/     실행 엔진                                ← graph/를 모른다
 *      ↑
 *   graph/      사용자 API (compile이 PregelSpec으로 낮춰 넘긴다)
 *
 * 화살표가 한 방향이라 "StateGraph는 순수 sugar"(불변식 3)가 구조로 증명된다 —
 * 엔진이 StateGraph를 못 보므로, 엔진만 남기고 다른 빌더를 얹어도 돌아간다.
 */

const SRC = new URL("../src/", import.meta.url).pathname;

/** 한 디렉터리(하위 포함)의 모든 import 출처를 모은다. */
async function importsIn(dir: string): Promise<Array<{ file: string; from: string }>> {
  const found: Array<{ file: string; from: string }> = [];
  for (const rel of new Bun.Glob("**/*.ts").scanSync(`${SRC}${dir}`)) {
    const text = await Bun.file(`${SRC}${dir}/${rel}`).text();
    for (const match of text.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)) {
      const from = match[1];
      if (from !== undefined) {
        found.push({ file: `${dir}/${rel}`, from });
      }
    }
  }
  return found;
}

/** 최상단 공용 모듈들(하위 폴더 제외). */
async function importsInSharedRoot(): Promise<Array<{ file: string; from: string }>> {
  const found: Array<{ file: string; from: string }> = [];
  for (const rel of new Bun.Glob("*.ts").scanSync(SRC)) {
    if (rel === "index.ts") {
      continue; // 배럴은 전부를 re-export하는 게 일이다
    }
    const text = await Bun.file(`${SRC}${rel}`).text();
    for (const match of text.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)) {
      const from = match[1];
      if (from !== undefined) {
        found.push({ file: rel, from });
      }
    }
  }
  return found;
}

describe("폴더 경계 (의존은 한 방향)", () => {
  it("pregel/는 graph/를 import하지 않는다 — 엔진은 StateGraph도 Command도 모른다", async () => {
    const leaks = (await importsIn("pregel")).filter((i) => i.from.includes("graph"));
    expect(leaks).toEqual([]);
  });

  it("graph/는 pregel의 배럴만 쓴다 — 엔진 내부 파일을 직접 찌르지 않는다", async () => {
    const deep = (await importsIn("graph")).filter(
      (i) => i.from.includes("pregel") && i.from !== "../pregel",
    );
    expect(deep).toEqual([]);
  });

  it("공용 어휘(constants·errors·send·channels)는 위 두 층을 모른다", async () => {
    const all = [...(await importsInSharedRoot()), ...(await importsIn("channels"))];
    const leaks = all.filter((i) => i.from.includes("graph") || i.from.includes("pregel"));
    expect(leaks).toEqual([]);
  });
});
