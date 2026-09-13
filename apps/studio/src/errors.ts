/**
 * 계층이 공유하는 실패 어휘. **HTTP 상태 코드를 모른다** — 400/404로 옮기는 건 `http/router.ts`다.
 * 서비스는 "없다"만 말하고, 컨트롤러는 "요청이 틀렸다"만 말한다.
 */

/** 요청의 모양이 틀렸다(클라이언트 잘못). */
export class BadRequestError extends Error {
  override name = "BadRequestError";
}

/** 가리킨 대상이 없다. */
export class NotFoundError extends Error {
  override name = "NotFoundError";
}
