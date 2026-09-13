import { describe, expect, it } from "bun:test";

/**
 * 서버 계층을 **실행되는 규칙**으로 고정한다.
 *
 *   http/         라우팅 · 실패 → 상태 코드       ← 서비스·도메인을 모른다
 *      ↓
 *   controllers/  요청 파싱·검증 · JSON 싸기       ← 서비스를 타입으로만 안다
 *      ↓
 *   services/     유스케이스 (목록 · 구조 · 한 턴) ← HTTP를 모른다
 *      ↓
 *   domain/       에이전트 선언 · 그래프 만들기    ← 위를 모른다
 */

const SRC = new URL("../src/", import.meta.url).pathname;

interface Import {
  file: string;
  from: string;
  typeOnly: boolean;
}

async function importsIn(dir: string): Promise<Import[]> {
  const found: Import[] = [];
  for (const rel of new Bun.Glob("**/*.ts").scanSync(`${SRC}${dir}`)) {
    const text = await Bun.file(`${SRC}${dir}/${rel}`).text();
    for (const match of text.matchAll(/^import\s(type\s)?[^"']*["']([^"']+)["']/gm)) {
      const from = match[2];
      if (from !== undefined) found.push({ file: `${dir}/${rel}`, from, typeOnly: !!match[1] });
    }
  }
  return found;
}

const touches = (from: string, layer: string) => from.includes(`/${layer}/`);

describe("서버 계층 (의존은 한 방향)", () => {
  it("domain/은 위 계층을 모른다", async () => {
    const leaks = (await importsIn("domain")).filter((i) =>
      ["services", "controllers", "http"].some((l) => touches(i.from, l)),
    );
    expect(leaks).toEqual([]);
  });

  it("services/는 HTTP를 모른다 — 컨트롤러도 라우터도 import하지 않는다", async () => {
    const leaks = (await importsIn("services")).filter((i) =>
      ["controllers", "http"].some((l) => touches(i.from, l)),
    );
    expect(leaks).toEqual([]);
  });

  it("controllers/는 서비스를 거친다 — 도메인을 건너뛰지 않고, 링은 타입으로만 안다", async () => {
    const found = await importsIn("controllers");
    expect(found.filter((i) => touches(i.from, "domain"))).toEqual([]);
    expect(found.filter((i) => i.from.startsWith("@ariadne/") && !i.typeOnly)).toEqual([]);
  });

  it("controllers/는 서비스의 **계약**만 안다 — 구현 파일이 아니라 services/types를 타입으로", async () => {
    const services = (await importsIn("controllers")).filter((i) => touches(i.from, "services"));
    expect(services.filter((i) => i.from !== "../services/types" || !i.typeOnly)).toEqual([]);
  });

  it("http/는 서비스·컨트롤러·도메인을 모른다", async () => {
    const leaks = (await importsIn("http")).filter((i) =>
      ["services", "controllers", "domain"].some((l) => touches(i.from, l)),
    );
    expect(leaks).toEqual([]);
  });
});
