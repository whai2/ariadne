# S10 · 스튜디오를 React + Vite + Tailwind로 재구축 (Mastra 디자인 차용)

## 왜 이 커밋이 생겼나

지금까지 스튜디오는 **바닐라 HTML 문자열 한 개**(`page.ts`, 빌드 스텝 0)였다. 학습 위젯으로는
훌륭했지만, 사용자가 이걸 **배포되는 admin 제품**으로 쓰겠다고 방향을 정했다. 그러면 제약이
바뀐다 — "빌드 없이 한 파일"이 더는 값이 아니라 족쇄다(컴포넌트 재사용·상태·테마·유지보수).

Mastra 플레이그라운드를 레퍼런스로 삼되 **코드를 가져오지 않았다.** Mastra playground-ui는
Apache-2.0라 vendor가 합법이지만, 그들 컴포넌트는 Mastra 서버 API 계약(workflows·evals·
networks·memory)에 묶여 있어 우리에 얹으면 **죽은 화면이 대량으로 딸려온다.** 그래서
**스택과 디자인 언어만 차용**하고, 컴포넌트는 우리 개념(agent·graph·channel·step)에 맞춰
직접 짰다. 이게 사용자가 고른 길(Route B)이다.

## 무엇을 했나

`apps/studio`를 둘로 갈랐다:

- **`src/` (Bun 서버)** — API만 맡는다. 엔드포인트(`/api/agents`·`/api/chat`·`/api/run`…)는
  **한 글자도 안 바뀌었다.** `page.ts`만 삭제하고, 빌드 산출물 `dist/`를 서빙하는 `serveStatic`을
  더했다(빌드 전이면 `bun run studio` 안내 페이지).
- **`web/` (React + Vite + Tailwind v4)** — UI. `App`(사이드바 + 뷰 전환) + 3 뷰(Agent/Chat/
  Examples) + 공용 컴포넌트(`Graph`·`Steps`·`ChatLog`·`Composer`).

레이아웃은 **좌측 고정 사이드바**(Mastra 그대로) — AGENTS 목록 + Chat + Examples. 다크 팔레트는
Tailwind v4 `@theme` 토큰으로 정의했다.

## 판단 · 서버 계약은 그대로, UI만 갈아끼운다

S9까지 만든 API가 **UI-무지**였던 게 여기서 값을 했다. 서버는 JSON만 내놓고, 누가 그리든
상관 안 한다 — 그래서 클라이언트를 바닐라 → React로 통째로 바꿔도 **엔드포인트 코드와 그 테스트가
그대로 살아남았다.** UI 재작성이 서버 재작성으로 번지지 않은 건 그 경계 덕이다.

## 판단 · UI는 서버 코드를 import하지 않는다

`web/`는 브라우저에서 돌고 `src/`는 Bun에서 돈다. UI가 `src/agents.ts`의 타입을 당겨오면 서버
모듈이 프런트 번들 그래프에 끌려든다. 그래서 `web/src/api.ts`가 **응답 모양을 다시 적는다**(경계
에서 타입을 지운 값). tsconfig도 둘이다 — 서버(Bun 타입) vs `web`(DOM+jsx, `types: []`).

## 판단 · mermaid는 themeVariables로, CSS !important 말고

처음엔 mermaid SVG를 CSS `!important`로 다크에 맞췄는데 biome이 10개를 경고했다(정당한 경고 —
!important는 특이도 전쟁의 씨앗이다). mermaid-정석인 `theme: "base" + themeVariables`로 옮기니
경고가 사라지고 색도 팔레트와 맞았다. 라이브러리를 CSS로 덮지 말고 **라이브러리 손잡이를 쓴다.**

## 회귀 · 무엇이 깨지고 무엇이 살았나

- **살아남음:** API 엔드포인트 테스트 전부(agents·chat·run·graph·providers·shapes). live 실호출
  스킵 테스트도 그대로.
- **제거함(정직):** 옛 바닐라 클라이언트 JS의 **문자열 조각을 검사하던 가드들**(인라인
  `<script>`에 `m.toolCalls || []`·`e.isComposing`·`toMermaid`가 있는지). 그 동작은 이제 `web/src`의
  `.tsx`에 산다 — 검사 대상 자체가 사라졌다(F2.3에서 문자열 규약을 걷어낼 때와 같은 성질). 그
  로직(IME 조합 Enter, 툴 호출 렌더, 조건부→점선)은 컴포넌트에 그대로 옮겼다.
- Tailwind v4 지시자(`@theme`·`@import "tailwindcss"`)를 biome가 못 읽어 CSS 파서에
  `tailwindDirectives: true`를 켰다.

## 정직 · 두 가지 빚

- **mermaid 번들이 크다** — 전 다이어그램 타입을 싣느라 main chunk가 ~900KB(gzip 237KB).
  admin엔 감당되지만, 나중에 flowchart만 동적 import하면 준다.
- **dev 경험은 두 갈래다.** `bun run studio`(= `vite build && 서버`)는 한 포트(4111)로 정적+API를
  주지만 HMR이 없다. UI를 활발히 만질 땐 `dev:ui`(Vite HMR, `/api`는 :4111로 프록시).

## 검증

256 pass / 4 skip / 0 fail (core 81 · tools 28 · model 97 · agent 7 · studio 43). `vite build` 성공,
서버가 dist를 서빙. **헤드리스 크롬으로 실제 렌더 확인** — 사이드바·설정 칩·mermaid 그래프
(model⇄tools 다크)·대화 패널이 Mastra 플레이그라운드 룩으로 뜬다.

## 벽 → 다음

지금은 스택 전환 + 기존 기능 이식(walking skeleton)이다. Mastra에 더 가까워질 여지 —
에이전트 상세를 탭화(Chat/Traces/Config), 스텝을 **트레이스 워터폴**로, 응답 **스트리밍**
(core/model에 streaming 필요). 스트리밍만 엔진 확장이고 나머지는 이 React 층에서 얹는다.
