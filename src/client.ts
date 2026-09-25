import { ReviralError, errorFromResponse } from "./errors.js";
import type {
  AcceptedJob,
  Account,
  CalculateCreditsRequest,
  CharacterRequest,
  DirectorChatReply,
  DirectorChatRequest,
  DiscoverPage,
  DiscoverQuery,
  GenerateMediaRequest,
  HookWriterRequest,
  ImageAdAccepted,
  ImageAdRequest,
  ImageAdTemplate,
  Job,
  MediaSearchRequest,
  Model,
  ProductPhotoUpload,
  PromptBuilderRequest,
  RenderAccepted,
  RenderRequest,
  ScriptWriterRequest,
  SignedUpload,
  SignedUploadRequest,
  StitchAccepted,
  StitchRequest,
  UgcAdAccepted,
  UgcAdOptions,
  UgcAdRequest,
  VerifiedUpload,
  WebhookPayload,
  WriterResult,
} from "./types.js";
import { VERSION } from "./version.js";

export const DEFAULT_BASE_URL = "https://reviral.ai/api/v1";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ReviralOptions {
  /** Secret API key. Defaults to process.env.REVIRAL_API_KEY on Node. Server-side only. */
  apiKey?: string;
  /** Defaults to https://reviral.ai/api/v1. */
  baseUrl?: string;
  /** Custom fetch (tests, proxies, older runtimes). Defaults to global fetch. */
  fetch?: FetchLike;
  /** Extra text appended to the User-Agent header. */
  userAgent?: string;
  /** Per-request timeout in ms. Default 60,000. A timed-out POST is NOT retried. */
  requestTimeoutMs?: number;
  /**
   * Longest Retry-After the SDK will wait for its single automatic retry
   * (429 and 503 rate_limit_unavailable only). Longer waits throw instead.
   * Default 60,000 ms. Set 0 to disable the automatic retry.
   */
  maxRetryWaitMs?: number;
  /** Injectable sleep, mainly for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface IdempotentRequestOptions extends RequestOptions {
  /**
   * 1-128 characters. Reuse the same key ONLY with the same body to recover a
   * timed-out request; a different body returns 409 idempotency_key_reuse.
   * If omitted, the SDK generates one and exposes it on ReviralError.idempotencyKey.
   */
  idempotencyKey?: string;
}

export interface WaitOptions extends RequestOptions {
  /** First poll delay in ms. Default 2,000 (docs: start around 2 s). */
  pollMs?: number;
  /** Backoff ceiling in ms. Default 10,000 (docs: increase to 5-10 s). */
  maxPollMs?: number;
  /** Backoff multiplier. Default 1.5. */
  backoff?: number;
  /** Give up after this many ms. Default 1,200,000 (20 minutes). */
  timeoutMs?: number;
  /** Called after every poll with the latest job. */
  onPoll?: (job: Job) => void;
}

export type ContractEndpoint = "generate-media" | "render" | "calculate-credits" | "media-search";

interface CallOptions {
  body?: unknown;
  formData?: FormData;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string | undefined;
  signal?: AbortSignal | undefined;
}

const RETRYABLE_503_CODES = new Set(["rate_limit_unavailable"]);

/** Generates a random Idempotency-Key (UUID v4). Prefer a stable business id such as an order id. */
export function generateIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i++) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(17, 20)}-${out.slice(20)}`;
}

/** True when a job has reached its final state and, for videos, its delivery URL exists. */
export function isTerminal(job: Pick<Job, "status" | "outputPending">): boolean {
  if (job.status === "failed") return true;
  return job.status === "ready" && job.outputPending !== true;
}

/**
 * Narrows an incoming webhook body. Callbacks are best effort and sent once;
 * always confirm with client.jobs.get(jobId) before taking sensitive action.
 */
export function parseWebhook(body: unknown): WebhookPayload {
  const b = typeof body === "string" ? (JSON.parse(body) as unknown) : body;
  if (b && typeof b === "object") {
    const r = b as Record<string, unknown>;
    if (typeof r.jobId === "string" && (r.status === "ready" || r.status === "failed")) {
      return r as unknown as WebhookPayload;
    }
  }
  throw new ReviralError({ status: 0, code: "invalid_webhook", message: "Body is not a Reviral webhook payload", body: b });
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): ReviralError {
  return new ReviralError({ status: 0, code: "aborted", message: "The operation was aborted", cause: signal?.reason });
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && !Array.isArray(body) && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function envApiKey(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.REVIRAL_API_KEY;
}

/**
 * Reviral API client.
 *
 * ```ts
 * const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });
 * const job = await reviral.generateMedia({ model: "gpt-image-2.5-flare", prompt: "A red sneaker", maxCredits: 2 });
 * const done = await reviral.jobs.waitUntilDone(job.jobId);
 * ```
 */
export class Reviral {
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetryWaitMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: ReviralOptions = {}) {
    this.apiKey = options.apiKey ?? envApiKey();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new Error("No fetch implementation found. Use Node 20+ or pass options.fetch.");
    }
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.userAgent = `@reviral/sdk/${VERSION}${options.userAgent ? ` ${options.userAgent}` : ""}`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    this.maxRetryWaitMs = options.maxRetryWaitMs ?? 60_000;
    this.sleep = options.sleep ?? defaultSleep;
  }

  // ---------------- catalog & pricing ----------------

  readonly models = {
    /** GET /models — live catalog: ids, durations, resolutions, reference limits, credit prices. */
    list: (opts: RequestOptions = {}): Promise<Model[]> => this.call<Model[]>("GET", "/models", opts),
  };

  readonly creditCosts = {
    /** GET /credit-costs — credit cost reference (no key needed). */
    get: (opts: RequestOptions = {}): Promise<Record<string, unknown>> =>
      this.call("GET", "/credit-costs", opts),
  };

  /** POST /calculate-credits — free estimate for a full render, an image ad, or a UGC ad. */
  calculateCredits(body: CalculateCreditsRequest, opts: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.call("POST", "/calculate-credits", { ...opts, body });
  }

  /** GET on a contract endpoint — machine-readable description of its body. */
  describe(endpoint: ContractEndpoint, opts: RequestOptions = {}): Promise<Record<string, unknown>> {
    return this.call("GET", `/${endpoint}`, opts);
  }

  // ---------------- generation ----------------

  /**
   * POST /generate-media — start one video or 1-4 images. Returns 202 AcceptedJob.
   * A replay with the same Idempotency-Key returns the job's CURRENT status
   * (possibly "failed" with `error`) as a normal result, not an exception.
   */
  generateMedia(body: GenerateMediaRequest, opts: IdempotentRequestOptions = {}): Promise<AcceptedJob> {
    return this.call("POST", "/generate-media", {
      body,
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey ?? generateIdempotencyKey(),
    });
  }

  readonly imageAds = {
    /** GET /image-ads/templates — the template catalog with required fields and credits. */
    templates: (opts: RequestOptions = {}): Promise<ImageAdTemplate[]> =>
      this.call("GET", "/image-ads/templates", opts),
    /** POST /image-ads — start an image ad job (shares the generate-media rate budget). */
    generate: (body: ImageAdRequest, opts: IdempotentRequestOptions = {}): Promise<ImageAdAccepted> =>
      this.call("POST", "/image-ads", {
        body,
        signal: opts.signal,
        idempotencyKey: opts.idempotencyKey ?? generateIdempotencyKey(),
      }),
  };

  readonly ugcAd = {
    /** GET /ugc-ad/options — accepted angles, creators, scenes, modes, durations. */
    options: (opts: RequestOptions = {}): Promise<UgcAdOptions> => this.call("GET", "/ugc-ad/options", opts),
    /** POST /ugc-ad — Idempotency-Key is REQUIRED by the API for this endpoint. */
    generate: (
      body: UgcAdRequest,
      opts: RequestOptions & { idempotencyKey: string },
    ): Promise<UgcAdAccepted> => {
      if (!opts?.idempotencyKey) {
        return Promise.reject(
          new ReviralError({ status: 0, code: "idempotency_key_required", message: "ugcAd.generate requires opts.idempotencyKey" }),
        );
      }
      return this.call("POST", "/ugc-ad", { body, signal: opts.signal, idempotencyKey: opts.idempotencyKey });
    },
  };

  /**
   * POST /render — full short-form video render (script, voice, captions, music).
   * This endpoint does NOT support Idempotency-Key: do not resend after a timeout
   * without checking your projects first. Errors may use the legacy/render shapes;
   * ReviralError normalises all of them.
   */
  render(body: RenderRequest, opts: RequestOptions = {}): Promise<RenderAccepted> {
    return this.call("POST", "/render", { body, signal: opts.signal });
  }

  /** POST /stitch — join 2-8 owned video jobs of the same aspect ratio. 0 credits. */
  stitch(body: StitchRequest, opts: RequestOptions = {}): Promise<StitchAccepted> {
    return this.call("POST", "/stitch", { ...opts, body });
  }

  // ---------------- jobs ----------------

  readonly jobs = {
    /** GET /jobs/{id} — 120 requests/minute per key. */
    get: (id: string, opts: RequestOptions = {}): Promise<Job> =>
      this.call("GET", `/jobs/${encodeURIComponent(id)}`, opts),
    /**
     * Polls GET /jobs/{id} with backoff (2 s growing to 10 s) until the job is
     * `failed`, or `ready` with its delivery URL present. Resolves with the same
     * shape as jobs.get — a failed job is a RESULT, check `job.status`.
     */
    waitUntilDone: (id: string, opts: WaitOptions = {}): Promise<Job> => this.waitUntilDone(id, opts),
  };

  private async waitUntilDone(id: string, opts: WaitOptions): Promise<Job> {
    const maxPollMs = opts.maxPollMs ?? 10_000;
    const backoff = opts.backoff ?? 1.5;
    const timeoutMs = opts.timeoutMs ?? 1_200_000;
    let delay = opts.pollMs ?? 2_000;
    const started = Date.now();
    for (;;) {
      const job = await this.jobs.get(id, opts.signal ? { signal: opts.signal } : {});
      opts.onPoll?.(job);
      if (isTerminal(job)) return job;
      if (Date.now() - started + delay > timeoutMs) {
        throw new ReviralError({
          status: 0,
          code: "timeout",
          message: `Job ${id} still ${job.status} after ${timeoutMs} ms`,
          body: job,
        });
      }
      await this.sleep(delay, opts.signal);
      delay = Math.min(Math.round(delay * backoff), maxPollMs);
    }
  }

  // ---------------- uploads ----------------

  readonly uploads = {
    /** POST /uploads — direct image upload (JPG/PNG/WebP, max 4 MB). Returns an owned URL + id. */
    create: (
      input: { file: Blob; filename?: string; kind?: "image" } | { base64: string },
      opts: RequestOptions = {},
    ): Promise<ProductPhotoUpload> => {
      if ("base64" in input) {
        return this.call("POST", "/uploads", { ...opts, body: { kind: "image", base64: input.base64 } });
      }
      const form = new FormData();
      form.append("kind", input.kind ?? "image");
      form.append("file", input.file, input.filename ?? "upload");
      return this.call("POST", "/uploads", { ...opts, formData: form });
    },
    /** POST /uploads/sign — signed PUT for video/audio/large images (max 64 MB). */
    sign: (body: SignedUploadRequest, opts: RequestOptions = {}): Promise<SignedUpload> =>
      this.call("POST", "/uploads/sign", { ...opts, body }),
    /** PUTs bytes to a signed upload URL. Your API key is NOT sent to the storage host. */
    put: async (signed: SignedUpload, data: Blob | ArrayBuffer | Uint8Array, opts: RequestOptions = {}): Promise<void> => {
      const res = await this.fetchImpl(signed.uploadUrl, {
        method: signed.method,
        headers: signed.headers,
        body: data as BodyInit,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) {
        throw new ReviralError({ status: res.status, code: "upload_failed", message: `Signed upload PUT failed with HTTP ${res.status}` });
      }
    },
    /** POST /uploads/verify — only the URL returned here may be used as a reference. */
    verify: (id: string, opts: RequestOptions = {}): Promise<VerifiedUpload> =>
      this.call("POST", "/uploads/verify", { ...opts, body: { id } }),
  };

  // ---------------- writers & director ----------------

  readonly director = {
    /** POST /director/chat — talk a prompt into shape; status becomes "prompt_ready". */
    chat: (body: DirectorChatRequest, opts: RequestOptions = {}): Promise<DirectorChatReply> =>
      this.call("POST", "/director/chat", { ...opts, body }),
  };

  readonly writers = {
    /** POST /script — free script writer (text only). */
    script: (body: ScriptWriterRequest, opts: RequestOptions = {}): Promise<WriterResult> =>
      this.call("POST", "/script", { ...opts, body }),
    /** POST /hooks — free hook writer: opening lines for short videos. */
    hooks: (body: HookWriterRequest, opts: RequestOptions = {}): Promise<WriterResult> =>
      this.call("POST", "/hooks", { ...opts, body }),
    /** POST /prompt-builder — builds a video prompt from a brief. */
    promptBuilder: (body: PromptBuilderRequest, opts: RequestOptions = {}): Promise<WriterResult> =>
      this.call("POST", "/prompt-builder", { ...opts, body }),
  };

  // ---------------- account & library ----------------

  /** GET /me — the account that owns the key, including its credit balance. */
  me(opts: RequestOptions = {}): Promise<Account> {
    return this.call("GET", "/me", opts);
  }

  readonly characters = {
    list: (opts: RequestOptions = {}): Promise<unknown> => this.call("GET", "/characters", opts),
    create: (body: CharacterRequest, opts: RequestOptions = {}): Promise<unknown> =>
      this.call("POST", "/characters", { ...opts, body }),
    get: (id: string, opts: RequestOptions = {}): Promise<unknown> =>
      this.call("GET", `/characters/${encodeURIComponent(id)}`, opts),
    delete: (id: string, opts: RequestOptions = {}): Promise<unknown> =>
      this.call("DELETE", `/characters/${encodeURIComponent(id)}`, opts),
  };

  /** GET /discover — public trending feed. */
  discover(query: DiscoverQuery = {}, opts: RequestOptions = {}): Promise<DiscoverPage> {
    return this.call("GET", "/discover", { ...opts, query: { ...query } });
  }

  /** POST /media-search — search available stock media. */
  mediaSearch(body: MediaSearchRequest, opts: RequestOptions = {}): Promise<unknown> {
    return this.call("POST", "/media-search", { ...opts, body });
  }

  // ---------------- transport ----------------

  private buildUrl(path: string, query?: CallOptions["query"]): string {
    const url = `${this.baseUrl}${path}`;
    if (!query) return url;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    return qs ? `${url}?${qs}` : url;
  }

  private async call<T>(method: string, path: string, options: CallOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": this.userAgent };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;
    let payload: BodyInit | undefined;
    if (options.formData) payload = options.formData;
    else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(options.body);
    }
    const url = this.buildUrl(path, options.query);

    for (let attempt = 1; ; attempt++) {
      const res = await this.send(url, method, headers, payload, options);
      const text = await res.text();
      let body: unknown = undefined;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (res.ok) {
        if (typeof body === "string") {
          throw new ReviralError({ status: res.status, code: "invalid_response", message: "Response was not JSON", body, idempotencyKey: options.idempotencyKey });
        }
        return unwrap<T>(body);
      }
      const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"));
      const error = errorFromResponse(res.status, body, retryAfterSec, options.idempotencyKey);
      const retryable = res.status === 429 || (res.status === 503 && RETRYABLE_503_CODES.has(error.code));
      if (retryable && attempt === 1) {
        const waitMs = (retryAfterSec ?? 1) * 1000;
        if (this.maxRetryWaitMs > 0 && waitMs <= this.maxRetryWaitMs) {
          await this.sleep(waitMs + Math.floor(Math.random() * 250), options.signal);
          continue;
        }
      }
      throw error;
    }
  }

  private async send(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: BodyInit | undefined,
    options: CallOptions,
  ): Promise<Response> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) throw abortError(options.signal);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer =
      this.requestTimeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.requestTimeoutMs)
        : undefined;
    try {
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (body !== undefined) init.body = body;
      return await this.fetchImpl(url, init);
    } catch (cause) {
      if (timedOut) {
        throw new ReviralError({
          status: 0,
          code: "timeout",
          message: `${method} ${url} timed out after ${this.requestTimeoutMs} ms. Not retried; resend with the same Idempotency-Key and body to recover the job safely.`,
          idempotencyKey: options.idempotencyKey,
          cause,
        });
      }
      if (options.signal?.aborted) throw abortError(options.signal);
      throw new ReviralError({
        status: 0,
        code: "network_error",
        message: `${method} ${url} failed before a response arrived`,
        idempotencyKey: options.idempotencyKey,
        cause,
      });
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
}
