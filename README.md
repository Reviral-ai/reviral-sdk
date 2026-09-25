# Reviral SDK — AI video & image generation API client (TypeScript)

[![npm: publishing soon](https://img.shields.io/badge/npm-publishing%20soon-lightgrey)](https://www.npmjs.com/package/@reviral/sdk)
[![CI](https://github.com/Reviral-ai/reviral-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Reviral-ai/reviral-sdk/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

`@reviral/sdk` is the official TypeScript and JavaScript client for the [Reviral API](https://reviral.ai/docs/api). One API key gives you text-to-video, image-to-video and text-to-image generation with Seedance, Google Veo 3, Kling, Hailuo, Wan, GPT Image, Nano Banana, Flux and Seedream, plus image ads and UGC video ads. Zero runtime dependencies; built for Node 20+ (CI runs Node 20 and 22). Other runtimes with standard `fetch` should work but are not tested yet.

```ts
import { Reviral } from "@reviral/sdk";
const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });
const job = await reviral.generateMedia({ model: "gpt-image-2.5-flare", prompt: "A red sneaker on white" });
console.log(await reviral.jobs.waitUntilDone(job.jobId));
```

## Install

```bash
npm install @reviral/sdk
```

ESM and CommonJS are both shipped (`import` or `require`), with TypeScript types included.

## Authentication

Create a key at [reviral.ai/app/api-keys](https://reviral.ai/app/api-keys) and store it in a server-side environment variable named `REVIRAL_API_KEY`. The SDK sends it as `Authorization: Bearer rvr_…`. If you omit `apiKey`, the client reads `process.env.REVIRAL_API_KEY`.

> Never ship the key in browser or mobile code. Call Reviral from your server, use one key per environment, and revoke a key immediately if it appears in logs or source control.

## How it works in 4 steps

1. **List models** — `reviral.models.list()` returns the live catalog: ids, durations, resolutions, reference limits and credit prices.
2. **Start a job** — `reviral.generateMedia(body, { idempotencyKey })` returns `202` with a `jobId`, `status` and `statusUrl`.
3. **Wait** — `reviral.jobs.waitUntilDone(jobId)` polls with backoff until the job is `ready` or `failed`.
4. **Download** — a ready video has `outputUrl`; a ready image job has `outputUrls`. URLs are signed and expire, so download promptly.

## Examples

Each file runs with `REVIRAL_API_KEY` set, after `npm run build` (Node 22.18+ runs `.ts` directly).

| File | What it does |
|---|---|
| [`examples/01-list-models.ts`](./examples/01-list-models.ts) | Prints every model with its live credit price |
| [`examples/02-generate-image.ts`](./examples/02-generate-image.ts) | GPT Image 2.5 Flare image (2 credits), price lock, Idempotency-Key, wait |
| [`examples/03-generate-video.ts`](./examples/03-generate-video.ts) | Veo / Seedance / Kling video at the model's defaults, with progress |
| [`examples/04-image-ad.ts`](./examples/04-image-ad.ts) | Upload a product photo and generate a template image ad |
| [`examples/05-photobooth-queue.ts`](./examples/05-photobooth-queue.ts) | Many devices sharing one key: a server-side queue inside 10 starts/minute |

## Methods

| Method | Endpoint | Notes |
|---|---|---|
| `models.list()` | `GET /api/v1/models` | Live catalog and prices |
| `creditCosts.get()` | `GET /api/v1/credit-costs` | Credit cost reference, no key needed |
| `calculateCredits(body)` | `POST /api/v1/calculate-credits` | Free estimate: full render, image ad or UGC ad |
| `describe(endpoint)` | `GET /api/v1/{generate-media,render,calculate-credits,media-search}` | Machine-readable contract |
| `generateMedia(body, { idempotencyKey })` | `POST /api/v1/generate-media` | One video or 1-4 images |
| `jobs.get(id)` | `GET /api/v1/jobs/{id}` | Job status and outputs |
| `jobs.waitUntilDone(id, opts)` | `GET /api/v1/jobs/{id}` (polling) | 2 s → 10 s backoff; resolves `ready` or `failed` |
| `uploads.create({ file } \| { base64 })` | `POST /api/v1/uploads` | Image up to 4 MB |
| `uploads.sign(body)` / `uploads.put(signed, bytes)` / `uploads.verify(id)` | `POST /api/v1/uploads/sign`, signed `PUT`, `POST /api/v1/uploads/verify` | Video, audio and large images (up to 64 MB) |
| `imageAds.templates()` | `GET /api/v1/image-ads/templates` | Templates, required fields, credits |
| `imageAds.generate(body, { idempotencyKey })` | `POST /api/v1/image-ads` | Image ad job |
| `ugcAd.options()` | `GET /api/v1/ugc-ad/options` | Accepted angles, creators, scenes |
| `ugcAd.generate(body, { idempotencyKey })` | `POST /api/v1/ugc-ad` | Idempotency-Key **required** |
| `render(body)` | `POST /api/v1/render` | Full short-form video (script, voice, captions, music) |
| `stitch({ projectIds })` | `POST /api/v1/stitch` | Join 2-8 owned clips, 0 credits |
| `director.chat(body)` | `POST /api/v1/director/chat` | Chat a prompt into shape |
| `writers.script()` / `writers.hooks()` / `writers.promptBuilder()` | `POST /api/v1/script`, `/hooks`, `/prompt-builder` | Text writers |
| `me()` | `GET /api/v1/me` | Account and credit balance |
| `characters.list/create/get/delete` | `/api/v1/characters[/{id}]` | Saved characters |
| `discover(query)` | `GET /api/v1/discover` | Trending feed |
| `mediaSearch(body)` | `POST /api/v1/media-search` | Stock media search |
| `parseWebhook(body)` | — | Types a terminal webhook payload |

## Rate limits

Quoted from the [rate limits docs](https://reviral.ai/docs/api/rate-limits):

| Request | Limit |
|---|---|
| List models and contract reads | 60/minute per trusted client address |
| Generate media | 10/minute and 1,000/day per key (image and video share the daily count; image-ads shares the same budget) |
| Video account cap | 10 per hour and 100 per day per account until the account has a paid history; 200 per day after |
| Job status | 120/minute per key |
| Uploads (direct, signed, verify) | 10/minute and 500/day per key (from the [reference inputs docs](https://reviral.ai/docs/api/reference-inputs)) |

**What the SDK does:** on HTTP `429`, or `503` with code `rate_limit_unavailable`, it waits for `Retry-After` (plus a little jitter) and retries **once**. It never retries any other status. If `Retry-After` is longer than `maxRetryWaitMs` (default 60 s) it throws immediately. A second `429` throws a `ReviralError` with `retryAfterSec`, so your own queue decides what happens next (see example 05).

## Idempotency: retry without paying twice

Send an `Idempotency-Key` (1-128 characters) with every `generateMedia`, `imageAds.generate` and `ugcAd.generate` call. From the [idempotency docs](https://reviral.ai/docs/api/idempotency):

- If a connection times out, resend the **exact** body with the **same** key. The API returns the original job instead of starting another one.
- A replay returns the job's current status (`queued`, `running`, `ready` or `failed`); fetch `statusUrl` for outputs. The SDK returns a replayed `failed` job as a normal result, not an exception.
- Reusing a key with a different body returns `409 idempotency_key_reuse`.

**What the SDK does:** it never retries a POST that timed out or lost its connection. It throws `ReviralError` with `code: "timeout"` or `"network_error"` and the `idempotencyKey` it sent, so you can resend safely. If you do not pass a key, the SDK generates one; pass your own stable id (an order id) to survive process restarts. `render()` does not accept an Idempotency-Key, so check your projects before resending it.

## Polling

From the docs: start polling around 2 seconds and increase to 5-10 seconds; stop at a terminal state. `jobs.waitUntilDone` does exactly that (2 s, ×1.5, capped at 10 s, 20-minute default timeout). It also keeps polling while a ready video reports `outputPending: true`, meaning its signed delivery URL is not available yet. Webhooks (`webhookUrl`) are best effort, sent once and not retried, so polling stays the source of truth.

## Errors

Every failure throws `ReviralError` with `status`, `code`, `message`, and when present `details`, `required`, `balance`, `retryAfterSec` and `idempotencyKey`.

```ts
import { ReviralError } from "@reviral/sdk";
try {
  await reviral.generateMedia({ model: "veo-3.1-lite", prompt: "…", maxCredits: 12 });
} catch (err) {
  if (err instanceof ReviralError && err.code === "price_changed") console.log("live price:", err.required);
}
```

| Status | Meaning |
|---|---|
| 400 | Malformed JSON or invalid full-render body |
| 401 | Missing, invalid, or revoked key |
| 402 | Insufficient credits |
| 404 | Model or owned job not found |
| 409 | Price lock changed or idempotency key conflict |
| 413 | `file_too_large` or `conversation_too_large` |
| 415 | Unsupported file type (JPG, PNG, WebP, MP4, MP3, WAV accepted) |
| 422 | `validation_error`; field problems in `details[]` |
| 429 | Rate limit exceeded; read `Retry-After` |
| 502 | Generation, upload storage, or status service unavailable |
| 503 | Catalog or rate limiter temporarily unavailable |
| 504 | Start timed out; retry with the same idempotency key and body |

The API uses a standard envelope `{ error: { code, message, details? }, docs }`; `render`, `characters` and `media-search` use older shapes. `ReviralError` normalises all of them.

## Pricing

Reviral charges **credits**. Prices are per second, per video or per image depending on the model, and they can change, so read them live:

- `reviral.models.list()` — each model's `credits` by resolution ([`GET /api/v1/models`](https://reviral.ai/api/v1/models))
- `reviral.creditCosts.get()` — the credit cost reference ([`GET /api/v1/credit-costs`](https://reviral.ai/api/v1/credit-costs))
- `reviral.calculateCredits(body)` — free estimate for full renders, image ads and UGC ads

`maxCredits` is an **exact-match price lock, not a ceiling**: if the live charge differs, the API returns `409 price_changed` (with the current price in `error.required`) and starts nothing.

## Supported models

The catalog changes; call `models.list()` for the current list. Credits are in the API's own credit units.

<!-- models:start -->
Generated from GET /api/v1/models on 2026-09-25 (UTC); run `npm run gen:models` to refresh.

66 models: 44 video, 22 image.

| Public id | Name | Kind | Billing | Credits (credits per second `/s`, per video or per image) | Durations (s) | Resolutions |
|---|---|---|---|---|---|---|
| `hailuo-02` | Hailuo 02 | video | per_request | 512P: 17/video, 768P: 33/video, 1080P: 33/video | 6, 10 | 512P, 768P, 1080P |
| `hailuo-2.3` | Hailuo 2.3 | video | per_request | 768P: 33/video, 1080P: 33/video | 6, 10 | 768P, 1080P |
| `hailuo-2.3-fast` | Hailuo 2.3 Fast | video | per_request | 768P: 24/video, 1080P: 24/video | 6, 10 | 768P, 1080P |
| `happyhorse-1.1` | HappyHorse 1.1 | video | per_second | 720P: 10.6/s, 1080P: 14.2/s | 3–15 | 720P, 1080P |
| `kling-3-turbo` | Kling 3.0 Turbo | video | per_second | 720p: 13.2/s, 1080p: 16.6/s | 3–15 | 720p, 1080p |
| `kling-v2.6` | Kling V2.6 | video | per_second | 720p: 5.4/s, 1080p: 9.2/s | 5, 10 | 720p, 1080p |
| `kling-v3` | Kling V3 | video | per_second | 720p: 10/s, 1080p: 13.3333/s | 3–15 | 720p, 1080p |
| `kling-v3-omni` | Kling V3 Omni | video | per_second | 720p: 10/s, 1080p: 13.2/s | 3–15 | 720p, 1080p |
| `kling-o1` | Kling Video O1 | video | per_second | 720p: 10/s, 1080p: 13.2/s | 3–10 | 720p, 1080p |
| `minimax-h3` | MiniMax H3 | video | per_second | 768p: 21.4/s, 2K: 21.4/s | 4–15 | 768p, 2K |
| `minimax-h3-2k-flat` | MiniMax H3 2K (priced per clip) | video | per_request | 2K: 69/video | 4–15 | 2K |
| `minimax-h3-pro-768p` | MiniMax H3 Pro 768p | video | per_second | 768p: 2.4/s | 4–15 | 768p |
| `seedance-1.5-pro` | Seedance 1.5 Pro | video | per_second | 480p: 3.4/s, 720p: 7.4/s, 1080p: 17.8/s | 4–12 | 480p, 720p, 1080p |
| `seedance-2` | Seedance 2 | video | per_second | 480p: 10.6/s, 720p: 21.2/s, 1080p: 52.8/s, 4k: 117.2/s | 4–15 | 480p, 720p, 1080p, 4k |
| `seedance-2-fast` | Seedance 2 Fast | video | per_second | 480p: 13.2/s, 720p: 13.2/s | 4–15 | 480p, 720p |
| `seedance-2-mini` | Seedance 2 Mini | video | per_second | 480p: 4.8/s, 720p: 4.8/s | 4–15 | 480p, 720p |
| `seedance-2-720p-plus` | Seedance 2.0 720p (Plus) | video | per_second | 720p: 15.2/s | 4–15 | 720p |
| `seedance-2-4k-fast` | Seedance 2.0 4K | video | per_second | 4K: 67.4/s | 4–15 | 4K |
| `seedance-2-all-round` | Seedance 2.0 720p (fixed 15-second clip) | video | per_request | 720p: 228/video | 15 | 720p |
| `seedance-2-1080p-fast` | Seedance 2.0 1080p | video | per_second | 1080P: 28/s | 4–15 | 1080P |
| `seedance-2.5` | Seedance 2.5 | video | per_second | 480p: 15.2/s, 720p: 29.6/s | -1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 30 | 480p, 720p |
| `seedance-2.5-720p-flat-plus` | Seedance 2.5 (fixed 30-second clip) | video | per_request | 720p: 122/video | 30 | 720p |
| `seedance-2.5-480p-fast` | Seedance 2.5 480p (Fast) | video | per_second | 480p: 12.8/s | 4–30 | 480p |
| `seedance-2.5-480p-standard` | Seedance 2.5 480p (Standard) | video | per_second | 480p: 13/s | 4–29 | 480p |
| `seedance-2.5-720p-fast` | Seedance 2.5 720p (Fast) | video | per_second | 720p: 23/s | 4–30 | 720p |
| `seedance-2.5-720p-flat-b` | Seedance 2.5 720p (fixed 30-second clip) | video | per_request | 720p: 125/video | 30 | 720p |
| `seedance-2.5-720p-plus` | Seedance 2.5 720p (Plus) | video | per_second | 720p: 19.8/s | 4–30 | 720p |
| `seedance-2.5-720p-standard` | Seedance 2.5 720p (Standard) | video | per_second | 720p: 23.6/s | 4–30 | 720p |
| `seedance-2.5-1080p` | Seedance 2.5 1080p | video | per_second | 1080p: 35.2/s | 4–29 | 1080p |
| `seedance-2.5-1080p-fast` | Seedance 2.5 1080p (Fast) | video | per_second | 1080p: 55.4/s | 4–30 | 1080p |
| `seedance-2.5-superres-1080p` | Seedance 2.5 1080p (fixed 30-second clip) | video | per_request | 1080p: 166/video | 30 | 1080p |
| `omni-flash` | Omni Flash | video | per_request | 720P: 25/video, 1080p: 25/video | 4, 6, 10 | 720P, 1080p |
| `veo-3.1-fast-flat` | Veo 3.1 Fast (fixed 8-second clip) | video | per_request | 720p: 24/video, 1080p: 24/video, 4k: 24/video | 8 | 720p, 1080p, 4k |
| `veo-3.1-fast-per-second` | Veo 3.1 Fast (per second) | video | per_second | 720p: 13.25/s, 1080p: 13.25/s, 4k: 13.25/s | 4, 6, 8 | 720p, 1080p, 4k |
| `veo-3.1-lite` | Veo 3.1 Lite (fixed 8-second clip) | video | per_request | 720p: 12/video, 1080p: 12/video, 4k: 12/video | 8 | 720p, 1080p, 4k |
| `veo-3.1-quality-flat` | Veo 3.1 Quality (fixed 8-second clip) | video | per_request | 720p: 50/video, 1080p: 50/video, 4k: 50/video | 8 | 720p, 1080p, 4k |
| `veo-3.1-quality-per-second` | Veo 3.1 Quality (per second) | video | per_second | 720p: 52.625/s, 1080p: 52.625/s, 4k: 52.625/s | 4, 6, 8 | 720p, 1080p, 4k |
| `vidu-q3` | Vidu Q3 | video | per_second | 540p: 7.1667/s, 720p: 7.1667/s, 1080p: 7.1667/s | 3–16 | 540p, 720p, 1080p |
| `vidu-q3-pro` | Vidu Q3 Pro | video | per_second | 540p: 5.3333/s, 720p: 11.8333/s, 1080p: 14.1667/s | 1–16 | 540p, 720p, 1080p |
| `vidu-q3-turbo` | Vidu Q3 Turbo | video | per_second | 540p: 4.3333/s, 720p: 7.1667/s, 1080p: 7.6667/s | 1–16 | 540p, 720p, 1080p |
| `wan-2.6` | Wan 2.6 | video | per_second | 720p: 10/s, 1080p: 16.6/s | 5, 10, 15 | 720p, 1080p |
| `wan-2.6-flash` | Wan 2.6 Flash | video | per_second | 720p: 5/s, 1080p: 4.2/s | 5, 10, 15 | 720p, 1080p |
| `wan-3.0` | Wan 3.0 | video | per_second | 480p: 19.8/s, 720p: 19.8/s, 1080p: 19.8/s | 2–30 | 480p, 720p, 1080p |
| `wan-3.0-prime` | Wan 3.0 Prime | video | per_second | 480p: 29.6/s, 720p: 29.6/s, 1080p: 29.6/s | 2–30 | 480p, 720p, 1080p |
| `flux-2-flex` | Flux 2.0 Flex | image | per_request | 1K: 12/image, 2K: 21/image | — | 1K, 2K |
| `flux-2-pro` | Flux 2.0 Pro | image | per_request | 1K: 6/image, 2K: 7/image | — | 1K, 2K |
| `flux-kontext-max` | Flux Kontext Max | image | per_request | Standard: 8/image | — | Standard |
| `flux-kontext-pro` | Flux Kontext Pro | image | per_request | Standard: 4/image | — | Standard |
| `gpt-image-2-economy` | GPT-IMAGE-2 | image | per_request | 1K: 2/image, 2K: 2/image, 4K: 2/image | — | 1K, 2K, 4K |
| `gpt-image-2-standard` | GPT-Image-2 Standard | image | per_request | 1K: 3/image, 2K: 3/image, 4K: 3/image | — | 1K, 2K, 4K |
| `gpt-image-2.5` | GPT-Image-2.5 | image | per_request | 1K: 2/image | — | 1K |
| `gpt-image-2.5-flare` | GPT-Image-2.5 Flare | image | per_request | 1K: 2/image | — | 1K |
| `gpt-image-2.5-sunburst` | GPT-Image-2.5 Sunburst | image | per_request | 1K: 2/image | — | 1K |
| `image-2-4k` | Image 2 4K | image | per_request | 4K: 3/image | — | 4K |
| `image-2-high` | Image 2 High | image | per_request | 2K: 4/image | — | 2K |
| `image-2-pro` | Image 2 PRO | image | per_request | 2K: 4/image, 4K: 4/image | — | 2K, 4K |
| `nano-banana` | Nano Banana | image | per_request | 1K: 3/image | — | 1K |
| `nano-banana-2` | Nano Banana 2 | image | per_request | 1K: 6/image, 2K: 6/image, 4K: 6/image | — | 1K, 2K, 4K |
| `nano-banana-pro-fast` | Nano Banana Pro 1 | image | per_request | 1K: 4/image, 2K: 4/image, 4K: 4/image | — | 1K, 2K, 4K |
| `nano-banana-pro` | Nano Banana Pro 2 | image | per_request | 1K: 10/image, 2K: 10/image, 4K: 10/image | — | 1K, 2K, 4K |
| `qwen-image-3.0` | Qwen Image 3.0 | image | per_request | 1K: 6/image, 2K: 6/image | — | 1K, 2K |
| `qwen-image-3.0-pro` | Qwen Image 3.0 Pro | image | per_request | 1K: 7/image, 2K: 7/image | — | 1K, 2K |
| `seedream-4` | Seedream 4.0 | image | per_request | 1K: 6/image, 2K: 6/image, 4K: 6/image | — | 1K, 2K, 4K |
| `seedream-4.5` | Seedream 4.5 | image | per_request | 2K: 7/image, 4K: 7/image | — | 2K, 4K |
| `seedream-5` | Seedream 5.0 | image | per_request | 2K: 6/image, 3K: 6/image | — | 2K, 3K |
| `seedream-5-pro` | Seedream 5.0 Pro | image | per_request | 1K: 8/image, 2K: 8/image | — | 1K, 2K |
<!-- models:end -->

## FAQ

**Is there an official Reviral SDK for TypeScript?** Yes: `@reviral/sdk`, this package. It wraps every endpoint in the public [OpenAPI contract](https://reviral.ai/openapi.json) with types.

**Can I call the API from a browser?** No. Keep the key on your server and expose only the operation your app needs.

**How do I know a job is finished?** Poll `jobs.get(id)` or use `jobs.waitUntilDone(id)` until `ready` or `failed`. A webhook can reduce polling, but polling stays authoritative.

**Does the SDK retry for me?** Once, and only for `429` and `503 rate_limit_unavailable`, honouring `Retry-After`. Timeouts and other errors are thrown so you decide; use the same Idempotency-Key to retry a generation safely.

## Links

- API docs: https://reviral.ai/docs/api
- OpenAPI: https://reviral.ai/openapi.json
- Model pages: https://reviral.ai/docs/api/models
- API keys: https://reviral.ai/app/api-keys
- Support: support@reviral.ai

## Contributing

Issues and pull requests are welcome. Run `npm install`, then `npm run typecheck`, `npm test` and `npm run build` before opening a PR; all three must pass. Keep the SDK dependency-free at runtime, keep types faithful to [openapi.json](https://reviral.ai/openapi.json), and add a test with the fake fetch in `test/helpers.ts` for every behaviour change. Never commit a real API key.

## License

[MIT](./LICENSE)
