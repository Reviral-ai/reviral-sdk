import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Reviral, ReviralError, VERSION, generateIdempotencyKey, isTerminal, parseWebhook } from "../src/index.js";
import { JOB_ID, fakeFetch, fakeSleep, job } from "./helpers.js";

const KEY = "test_key_not_real";
const accepted = { data: { jobId: JOB_ID, kind: "image", model: "gpt-image-2.5-flare", creditsCharged: 2, status: "queued", statusUrl: `/api/v1/jobs/${JOB_ID}` } };

function client(replies: Parameters<typeof fakeFetch>[0], extra: Record<string, unknown> = {}) {
  const f = fakeFetch(replies);
  const s = fakeSleep();
  const reviral = new Reviral({ apiKey: KEY, fetch: f.fetch, sleep: s.sleep, ...extra });
  return { reviral, ...f, waits: s.waits };
}

test("sets Bearer auth, User-Agent and default base URL", async () => {
  const { reviral, calls } = client([{ status: 200, body: { data: [] } }]);
  const models = await reviral.models.list();
  assert.deepEqual(models, []);
  assert.equal(calls[0]!.url, "https://reviral.ai/api/v1/models");
  assert.equal(calls[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0]!.headers["user-agent"], `@reviral/sdk/${VERSION}`);
});

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});

test("omits Authorization when no key is configured", async () => {
  const f = fakeFetch([{ status: 200, body: { ok: true, data: [] } }]);
  const reviral = new Reviral({ apiKey: "", fetch: f.fetch });
  await reviral.imageAds.templates();
  assert.equal(f.calls[0]!.headers.authorization, undefined);
});

test("passes a caller Idempotency-Key and the JSON body", async () => {
  const { reviral, calls } = client([{ status: 202, body: accepted }]);
  const res = await reviral.generateMedia({ model: "gpt-image-2.5-flare", prompt: "red sneaker", maxCredits: 2 }, { idempotencyKey: "order-42" });
  assert.equal(res.jobId, JOB_ID);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.headers["idempotency-key"], "order-42");
  assert.equal(calls[0]!.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0]!.body!), { model: "gpt-image-2.5-flare", prompt: "red sneaker", maxCredits: 2 });
});

test("generates an Idempotency-Key when none is given", async () => {
  const { reviral, calls } = client([{ status: 202, body: accepted }]);
  await reviral.generateMedia({ model: "m", prompt: "p" });
  const key = calls[0]!.headers["idempotency-key"]!;
  assert.match(key, /^[0-9a-f-]{36}$/);
  assert.notEqual(generateIdempotencyKey(), generateIdempotencyKey());
});

test("429 retries exactly once after Retry-After, then succeeds", async () => {
  const { reviral, calls, waits } = client([
    { status: 429, headers: { "retry-after": "7" }, body: { error: { code: "rate_limited", message: "Too many requests. Try again later." }, docs: "/docs/api" } },
    { status: 202, body: accepted },
  ]);
  const res = await reviral.generateMedia({ model: "m", prompt: "p" }, { idempotencyKey: "k1" });
  assert.equal(res.status, "queued");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.headers["idempotency-key"], "k1", "retry reuses the same key");
  assert.equal(waits.length, 1);
  assert.ok(waits[0]! >= 7000 && waits[0]! < 7250, `waited ${waits[0]}`);
});

test("429 twice throws ReviralError with retryAfterSec (no second retry)", async () => {
  const limited = { status: 429, headers: { "retry-after": "3" }, body: { error: { code: "rate_limited", message: "Too many requests." }, docs: "/docs/api" } };
  const { reviral, calls } = client([limited, limited]);
  await assert.rejects(reviral.models.list(), (err: unknown) => {
    assert.ok(err instanceof ReviralError);
    assert.equal(err.status, 429);
    assert.equal(err.code, "rate_limited");
    assert.equal(err.retryAfterSec, 3);
    return true;
  });
  assert.equal(calls.length, 2);
});

test("429 with Retry-After above maxRetryWaitMs throws without waiting", async () => {
  const { reviral, calls, waits } = client(
    [{ status: 429, headers: { "retry-after": "120" }, body: { error: { code: "rate_limited", message: "x" }, docs: "/docs/api" } }],
    { maxRetryWaitMs: 60_000 },
  );
  await assert.rejects(reviral.models.list(), { code: "rate_limited", retryAfterSec: 120 });
  assert.equal(calls.length, 1);
  assert.equal(waits.length, 0);
});

test("503 rate_limit_unavailable retries once", async () => {
  const { reviral, calls, waits } = client([
    { status: 503, headers: { "retry-after": "60" }, body: { error: { code: "rate_limit_unavailable", message: "The API is temporarily unavailable." }, docs: "/docs/api" } },
    { status: 200, body: job("running") },
  ]);
  const j = await reviral.jobs.get(JOB_ID);
  assert.equal(j.status, "running");
  assert.equal(calls.length, 2);
  assert.ok(waits[0]! >= 60_000);
});

test("other 503 codes and 5xx are NOT retried", async () => {
  const { reviral, calls } = client([
    { status: 503, headers: { "retry-after": "60" }, body: { error: { code: "service_unavailable", message: "Generation is temporarily unavailable." }, docs: "/docs/api" } },
  ]);
  await assert.rejects(reviral.generateMedia({ model: "m", prompt: "p" }, { idempotencyKey: "k" }), {
    status: 503,
    code: "service_unavailable",
    idempotencyKey: "k",
  });
  assert.equal(calls.length, 1);
});

test("4xx maps to ReviralError with code, details and required", async () => {
  const { reviral, calls } = client([
    {
      status: 422,
      body: { error: { code: "validation_error", message: "Request validation failed", details: [{ field: "durationSec", message: "Duration is not available for this model.", code: "invalid_choice" }] }, docs: "/docs/api" },
    },
    { status: 409, body: { error: { code: "price_changed", message: "Price changed", required: 3 }, docs: "/docs/api" } },
  ]);
  await assert.rejects(reviral.generateMedia({ model: "m", prompt: "p" }), (err: unknown) => {
    assert.ok(err instanceof ReviralError);
    assert.equal(err.status, 422);
    assert.equal(err.code, "validation_error");
    assert.equal(err.details?.[0]?.code, "invalid_choice");
    return true;
  });
  await assert.rejects(reviral.generateMedia({ model: "m", prompt: "p", maxCredits: 2 }), { status: 409, code: "price_changed", required: 3 });
  assert.equal(calls.length, 2, "4xx never retried");
});

test("legacy and render error shapes are normalised", async () => {
  const { reviral } = client([
    { status: 401, body: { ok: false, error: "invalid_api_key", message: "Missing key", docs: "/docs/api" } },
    { status: 402, body: { error: "insufficient_credits", required: 90, balance: 12 } },
  ]);
  await assert.rejects(reviral.characters.list(), { status: 401, code: "invalid_api_key", message: "Missing key" });
  await assert.rejects(reviral.render({ workflow: "prompt-to-video", prompt: "x" }), { status: 402, code: "insufficient_credits", required: 90, balance: 12 });
});

test("render sends no Idempotency-Key (endpoint does not support it)", async () => {
  const { reviral, calls } = client([{ status: 200, body: { projectId: "p", renderJobId: "r", debited: 90, balanceBefore: 100 } }]);
  const res = await reviral.render({ workflow: "prompt-to-video", prompt: "x" });
  assert.equal(res.debited, 90);
  assert.equal(calls[0]!.headers["idempotency-key"], undefined);
});

test("network failure on POST is not retried and carries the idempotency key", async () => {
  const { reviral, calls } = client([new TypeError("fetch failed")]);
  await assert.rejects(reviral.generateMedia({ model: "m", prompt: "p" }, { idempotencyKey: "order-7" }), {
    status: 0,
    code: "network_error",
    idempotencyKey: "order-7",
  });
  assert.equal(calls.length, 1);
});

test("idempotent replay with status failed is a result, not an exception", async () => {
  const replay = { data: { ...accepted.data, status: "failed", error: "Generation failed. Credits were refunded.", creditsCharged: 0 } };
  const { reviral } = client([{ status: 202, body: replay }]);
  const res = await reviral.generateMedia({ model: "m", prompt: "p" }, { idempotencyKey: "same" });
  assert.equal(res.status, "failed");
  assert.equal(res.error, "Generation failed. Credits were refunded.");
});

test("waitUntilDone backs off 2s -> 10s and resolves on ready", async () => {
  const { reviral, calls, waits } = client([
    { status: 200, body: job("queued") },
    { status: 200, body: job("running") },
    { status: 200, body: job("running") },
    { status: 200, body: job("running") },
    { status: 200, body: job("running") },
    { status: 200, body: job("running") },
    { status: 200, body: job("ready", { outputUrls: ["https://example.com/a.png"] }) },
  ]);
  const seen: string[] = [];
  const done = await reviral.jobs.waitUntilDone(JOB_ID, { onPoll: (j) => seen.push(j.status) });
  assert.equal(done.status, "ready");
  assert.deepEqual(done.outputUrls, ["https://example.com/a.png"]);
  assert.equal(calls.length, 7);
  assert.deepEqual(waits, [2000, 3000, 4500, 6750, 10000, 10000]);
  assert.equal(seen.at(-1), "ready");
  assert.equal(calls[0]!.url, `https://reviral.ai/api/v1/jobs/${JOB_ID}`);
});

test("waitUntilDone resolves failed jobs as results", async () => {
  const { reviral } = client([{ status: 200, body: job("failed", { error: "Generation failed" }) }]);
  const done = await reviral.jobs.waitUntilDone(JOB_ID);
  assert.equal(done.status, "failed");
  assert.equal(done.error, "Generation failed");
});

test("waitUntilDone keeps polling while a ready video has outputPending", async () => {
  const { reviral, calls } = client([
    { status: 200, body: job("ready", { kind: "video", outputPending: true }) },
    { status: 200, body: job("ready", { kind: "video", outputUrl: "https://example.com/v.mp4" }) },
  ]);
  const done = await reviral.jobs.waitUntilDone(JOB_ID);
  assert.equal(done.outputUrl, "https://example.com/v.mp4");
  assert.equal(calls.length, 2);
  assert.equal(isTerminal({ status: "ready", outputPending: true }), false);
});

test("waitUntilDone times out with code timeout", async () => {
  const { reviral } = client([{ status: 200, body: job("running") }]);
  await assert.rejects(reviral.jobs.waitUntilDone(JOB_ID, { timeoutMs: 1000, pollMs: 2000 }), { code: "timeout" });
});

test("waitUntilDone honours an aborted signal", async () => {
  const f = fakeFetch([{ status: 200, body: job("running") }]);
  const reviral = new Reviral({ apiKey: KEY, fetch: f.fetch });
  const ac = new AbortController();
  const p = reviral.jobs.waitUntilDone(JOB_ID, { signal: ac.signal, pollMs: 50 });
  ac.abort();
  await assert.rejects(p, { code: "aborted" });
});

test("ugcAd.generate requires an idempotency key and sends it", async () => {
  const { reviral, calls } = client([{ status: 202, body: { data: { jobId: JOB_ID, kind: "ugc-ad", creditsCharged: 40, status: "queued", statusUrl: "/api/v1/jobs/x" } } }]);
  const body = { uploadId: "u1", prompt: "a creator unboxes the mug", angle: "unboxing", creator: "lifestyle", scene: "kitchen" } as const;
  // @ts-expect-error missing idempotencyKey is a type error too
  await assert.rejects(reviral.ugcAd.generate(body, {}), { code: "idempotency_key_required" });
  const res = await reviral.ugcAd.generate(body, { idempotencyKey: "ugc-1" });
  assert.equal(res.kind, "ugc-ad");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.headers["idempotency-key"], "ugc-1");
});

test("unwraps both {data} and {ok,data} envelopes; builds discover query", async () => {
  const { reviral, calls } = client([
    { status: 200, body: { ok: true, data: { profileId: "p", plan: "pro", credits: 10 }, docs: "/docs/api" } },
    { status: 200, body: { ok: true, data: { items: [], page: 2, limit: 5, total: 0 }, docs: "/docs/api/discover" } },
  ]);
  const me = await reviral.me();
  assert.equal(me.credits, 10);
  const page = await reviral.discover({ page: 2, limit: 5, tag: "tiktok" });
  assert.equal(page.page, 2);
  assert.equal(calls[1]!.url, "https://reviral.ai/api/v1/discover?page=2&limit=5&tag=tiktok");
});

test("custom baseUrl without trailing slash duplication", async () => {
  const f = fakeFetch([{ status: 200, body: { data: [] } }]);
  const reviral = new Reviral({ apiKey: KEY, fetch: f.fetch, baseUrl: "http://localhost:3000/api/v1/" });
  await reviral.models.list();
  assert.equal(f.calls[0]!.url, "http://localhost:3000/api/v1/models");
});

test("signed upload PUT never sends the API key", async () => {
  const { reviral, calls } = client([{ status: 200 }]);
  await reviral.uploads.put({ id: "s1", uploadUrl: "https://storage.example.com/put", method: "PUT", headers: { "content-type": "video/mp4" }, expiresInSec: 600 }, new Uint8Array([1, 2, 3]));
  assert.equal(calls[0]!.method, "PUT");
  assert.equal(calls[0]!.headers.authorization, undefined);
  assert.equal(calls[0]!.headers["content-type"], "video/mp4");
});

test("parseWebhook accepts ready/failed payloads and rejects others", () => {
  const ready = parseWebhook(JSON.stringify({ ok: true, status: "ready", jobId: JOB_ID, kind: "video", modelUsed: "seedance-2", fallbackFired: false, outputUrl: "https://example.com/v.mp4" }));
  assert.equal(ready.status, "ready");
  const failed = parseWebhook({ ok: false, status: "failed", jobId: JOB_ID, modelUsed: "seedance-2", fallbackFired: false, error: "x" });
  assert.equal(failed.ok, false);
  assert.throws(() => parseWebhook({ hello: "world" }), { code: "invalid_webhook" });
});
