# F1.5 · 모델 라우터 — "프로바이더 200개"의 실체

## 질문

mastra는 "600+ 모델, 40+ 프로바이더", langchain은 프로바이더마다 통합 패키지를 갖는다.
우리도 그 수준으로 가려면 **어댑터를 200개 짜야 하나?**

답은 아니다. 그리고 왜 아닌지가 이 단계에서 배운 전부다.

## 세어봤다

[models.dev](https://models.dev/api.json) 레지스트리(mastra가 쓰는 그것)를 받아 분류했다.

```
프로바이더 213개 · 모델 7,560개
```

| 와이어 포맷 | 개수 | 비율 |
|---|---:|---|
| **OpenAI 호환** | **190** | 89% |
| Anthropic | 9 | 4% |
| 그 외(Vertex·Bedrock·Azure…) | 14 | 7% |

mastra 블로그가 같은 말을 한다:

> "For major providers like Anthropic and Google, we use their official APIs directly.
> **For the long tail of providers, we route through OpenAI-compatible endpoints.**"

즉 **"200개 지원"은 어댑터 200개가 아니라 어댑터 2개 + 표**다. OpenRouter조차 그냥
`https://openrouter.ai/api/v1`의 OpenAI 호환 엔드포인트다. 프로바이더 사이의 차이는
대부분 **코드가 아니라 데이터**(baseURL·환경변수 이름)였다.

## 그래서 어댑터가 아니라 baseURL이 프로바이더를 정한다

```ts
openaiCompatible({ model: "llama-3.3-70b", baseURL: "https://api.groq.com/openai/v1" })
openaiCompatible({ model: "anthropic/claude-sonnet-4.5", baseURL: "https://openrouter.ai/api/v1" })
```

같은 함수다. 바뀐 건 URL 문자열 하나.

그리고 이걸 깨닫자 **기존 F1 어댑터의 정체가 다시 보였다.**

```ts
anthropicChat({ baseURL: "https://api.minimax.io/anthropic/v1" })  // MiniMax
anthropicChat({ baseURL: "https://api.kimi.com/coding/v1" })       // Kimi
```

`anthropic.ts`는 "Anthropic 전용 어댑터"가 아니라 **"Anthropic 와이어 포맷 어댑터"**였다.
`baseURL` 옵션 한 줄로 9개 프로바이더가 공짜로 붙었다 — 파일 주석을 그렇게 고쳤다.

## 두 포맷의 진짜 차이 (F1 노트의 후속)

F1에서 "system의 위치가 다르다"를 배웠는데, 이제 그 대조가 코드로 나란히 놓인다.

```ts
// anthropic.ts — 대화에서 system을 뽑아낸다
{ system: "...", messages: [user, assistant] }

// openaiCompatible.ts — 뽑아낼 게 없다. system도 배열 안의 한 원소.
{ messages: [system, user, assistant] }
```

`toAnthropicMessages`는 반환 타입이 `{ system, messages }`인데
`toOpenAIMessages`는 그냥 `messages[]`다. **타입이 포맷 차이를 그대로 드러낸다.**

## 스펙 파싱 — 첫 슬래시만 쪼갠다

```
"anthropic/claude-opus-5"                 → anthropic  +  "claude-opus-5"
"openrouter/anthropic/claude-sonnet-4.5"  → openrouter +  "anthropic/claude-sonnet-4.5"
                                                          └─ 통째로 넘긴다
```

게이트웨이는 모델 ID 안에 또 슬래시가 있다. 그래서 "첫 `/`까지가 프로바이더, **나머지 전부**가
모델 ID"여야 한다. `split("/")` 였다면 게이트웨이가 깨진다.

## 레지스트리는 빌드타임에 만든다

```
bun run --filter '@ariadne/model' sync
  → models.dev/api.json (4.5MB)
  → src/registry.generated.ts (213개, 커밋됨)
```

mastra는 **런타임에** fetch한다(새 모델이 재배포 없이 반영되는 대신 네트워크·캐시 의존).
우리는 반대를 골랐다 — **런타임 네트워크 0**, 오프라인에서도 `bun run verify` 그린,
타입 있는 표. 새 프로바이더가 필요하면 `sync`를 다시 돌려 커밋한다.

생성물은 biome 대상에서 뺐다(`!**/*.generated.ts`). 포맷터가 다시 쓰면 sync 결과와 어긋나고,
일부 baseURL에 들어있는 `${...}` 플레이스홀더가 템플릿 문자열로 오인되기 때문이다.

## 함정: `npm` 필드는 와이어 포맷이 아니다

처음엔 models.dev의 `npm` 필드로 자동 분류했다. 결과가 이상했다 —
**OpenRouter·Groq·xAI·Cerebras·Mistral이 전부 미지원**으로 떨어졌다.

이유: `npm`은 "Vercel AI SDK에서 어느 패키지를 쓰나"이지 와이어 포맷이 아니다. 부가 기능
때문에 전용 패키지가 있을 뿐, 엔드포인트는 멀쩡히 OpenAI 호환이다. OpenRouter 문서도
"use the OpenAI SDK pointed at OpenRouter as a **drop-in replacement**"라고 못박는다.

그래서 각 프로바이더 문서에서 확인한 것만 넣는 **오버라이드 표**를 생성기에 뒀다.
오버라이드는 8개다 — OpenRouter · Groq · xAI · Cerebras · Mistral · Together · Perplexity, 그리고 **Gemini**.

**Gemini가 재밌는 사례다.** 네이티브 포맷은 *진짜로* 다르다(`generateContent` · `contents`/`parts` ·
`systemInstruction`). 그런데 구글이 **OpenAI 호환 셰임 엔드포인트를 공식 제공**한다:

```
https://generativelanguage.googleapis.com/v1beta/openai/
```

그래서 "포맷이 다르다"와 "우리가 부를 수 있다"가 별개의 질문이 된다. 세 번째 어댑터를 안 짜고도
Gemini가 붙었다. 대가는 있다 — 이 셰임은 **모르는 파라미터를 조용히 무시**한다(에러가 아니라 무시).

끝 슬래시는 구글 문서 그대로다. openai SDK가 정규화하는지 실제로 확인했다:

```
baseURL ".../v1beta/openai/"  →  ".../v1beta/openai/chat/completions"   (이중 슬래시 없음)
baseURL "https://api.together.ai/v1"  →  ".../v1/chat/completions"
```

오버라이드는 12개다 — OpenRouter · Groq · xAI · Cerebras · Mistral · Together · Perplexity ·
DeepInfra · Venice · Vercel AI Gateway · Cohere, 그리고 **Gemini**.

## 무시한 린트 경고가 진짜 버그였다

biome이 생성 파일에 `noTemplateCurlyInString`을 5번 경고했다. "생성물이니 린트에서 빼자"로
처리했는데, **경고가 가리킨 게 진짜 버그였다.**

```
"databricks": { api: "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
                env: ["DATABRICKS_HOST", "DATABRICKS_TOKEN"] }
```

models.dev는 **워크스페이스마다 URL이 다른** 프로바이더를 `${VAR}` 템플릿으로 표기한다.
이걸 안 읽으면 둘이 조용히 깨진다:

1. baseURL에 리터럴 `${DATABRICKS_HOST}`가 남아 엉뚱한 데로 요청이 간다
2. `env`의 **첫 값을 API 키로 집는데 그게 URL 조각**이다 — Databricks 호출은
   `apiKey = "https://ws.cloud.databricks.com"`으로 나갔다

그래서 `ProviderEntry`에 `apiVars`가 생겼다. **URL 조각인 env와 진짜 키인 env를 가른다.**

```ts
const keyNames = entry.env.filter((name) => !apiVars.includes(name));  // HOST 제외
const baseURL = entry.api.replace(/\$\{(\w+)\}/g, (_, n) => env[n]);   // 조립
```

덕분에 Databricks · Snowflake Cortex · Cloudflare Workers AI · Neon · Infomaniak 다섯이
**세어지기만 하던 상태에서 실제로 부를 수 있는 상태**가 됐다. 교훈은 하나다 —
*생성물이라고 린트를 끄기 전에 경고가 뭘 가리키는지 보라.*

## 남은 14개는 두 부류다

| 부류 | 개수 | 왜 안 되나 |
|---|---:|---|
| **인증·URL 구조가 다름** | 8 | Bedrock=AWS 서명 · Vertex=GCP ADC · Azure=resource/deployment/api-version · watsonx=IAM 토큰 · SAP=OAuth · Cloudflare AI Gateway=account+gateway |
| 아마 단순 baseURL인데 미확인 | 6 | aihubmix · gitlab · merge-gateway · qvac · salad-cloud · v0 — models.dev에 URL이 없어 각 문서를 봐야 한다 |

앞 8개는 **어댑터가 아니라 인증 계층**이 필요하다. `ProviderEntry`가 "키 하나 + baseURL"만
표현하는데, 이들은 서명·토큰 교환·다단계 URL 조립을 요구한다. 다만 셋은 이미 길이 있다 —
Azure는 우리가 이미 쓰는 `openai` SDK의 `AzureOpenAI`, Bedrock·Vertex의 Anthropic 모델은
공식 `@anthropic-ai/bedrock-sdk` · `@anthropic-ai/vertex-sdk`.

## 에러가 다음 행동을 말해야 한다

```
"groq"의 API 키가 없다 — GROQ_API_KEY 를 설정하거나 apiKey를 넘겨라
"amazon-bedrock" (Amazon Bedrock)는 아직 어댑터가 없다 — @ai-sdk/amazon-bedrock 계열 와이어 포맷이 필요하다.
  지금 지원: anthropic 포맷 · OpenAI 호환 포맷.
```

레지스트리가 `env` 이름을 아니까 **어느 환경변수를 채워야 하는지 말해줄 수 있다.**
셋 다 네트워크에 나가기 전에 던진다.

## 검증 (test/registry.test.ts · test/openaiCompatible.test.ts)

35 pass · 3 skip. 눈여겨볼 것 셋:

- **레지스트리 불변식** — `listProviders("anthropic")`과 `listProviders("openai")`를 합친
  집합의 format이 정확히 그 둘뿐임을 단언한다. "어댑터는 둘"이 주석이 아니라 테스트다.
- **그래프 통합을 어댑터마다** — OpenAI 어댑터를 꽂아도 Anthropic 때와 **똑같은 결과**가 나온다.
  중립 인터페이스가 진짜 중립인지 확인하는 지점.
- **템플릿 회귀 가드** — `api`에 `${...}`가 있는 엔트리는 반드시 `apiVars`를 갖는다고 단언한다.
  위 버그가 다시 들어오면 여기서 걸린다.

실호출 테스트는 `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY`가 있을 때만 돈다.

## 안 한 것 (정직)

- **Vertex · Bedrock · Azure** — 14개 미지원. 전부 **인증 방식이 baseURL로 안 덮이는** 것들이다(AWS 서명 · GCP ADC). 세 번째 어댑터가 아니라 인증 계층이 필요해지는 지점.
- **모델 ID 목록** — 7,560개를 생성물에 넣지 않았다. 프로바이더 메타데이터만으로 충분하고,
  틀린 모델 ID는 어차피 API가 즉시 거절한다. Studio 드롭다운이 필요해지면 그때.
- **스트리밍 · 툴 호출** — 각각 이후 단계.

## 벽 → 다음 (F2)

F1과 같은 벽이고, 이제 **두 어댑터 모두에서** 보인다.
`BaseMessage.content`가 string이라 `tool_use`/`tool_result`를 못 담는다 —
Anthropic은 content 블록 배열로, OpenAI는 `tool_calls` 필드로 툴을 표현하는데 둘 다 버려진다.

F2는 core의 메시지 타입을 확장하고, **그 확장이 두 포맷 모두로 번역되는지**가 검증이 된다.

## 참조

- [mastra Model Router](https://mastra.ai/blog/model-router) — 600+ 모델, 하이브리드 라우팅
- [models.dev/api.json](https://models.dev/api.json) — 레지스트리 원본
- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart) — OpenAI SDK 드롭인
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) — 구글 공식 셰임 엔드포인트
- [Together AI OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility)
- [LangChain providers](https://docs.langchain.com/oss/javascript/concepts/providers-and-models) — 패키지별 통합 방식(우리와 갈리는 길)
- 우리: [`registry.ts`](../../packages/model/src/registry.ts) · [`openaiCompatible.ts`](../../packages/model/src/openaiCompatible.ts) · [`scripts/sync-providers.ts`](../../packages/model/scripts/sync-providers.ts) · F1은 [13번 노트](13-f1-model.md)
