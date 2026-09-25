import type { FieldError } from "./types.js";

export interface ReviralErrorInit {
  status: number;
  code: string;
  message: string;
  retryAfterSec?: number | undefined;
  details?: FieldError[] | undefined;
  required?: number | undefined;
  balance?: number | undefined;
  idempotencyKey?: string | undefined;
  body?: unknown;
  cause?: unknown;
}

/**
 * Every failed call throws a ReviralError.
 *
 * - `status`: HTTP status, or 0 when no response arrived (network error, abort).
 * - `code`: machine-readable code, e.g. `validation_error`, `rate_limited`,
 *   `price_changed`, `idempotency_key_reuse`, `insufficient_credits`.
 *   Client-side codes: `network_error`, `aborted`, `timeout`, `invalid_response`.
 * - `retryAfterSec`: parsed from the Retry-After header when present.
 * - `idempotencyKey`: the key that was sent, so a timed-out generation can be
 *   resent safely with the same key and the same body.
 */
export class ReviralError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | undefined;
  readonly details: FieldError[] | undefined;
  readonly required: number | undefined;
  readonly balance: number | undefined;
  readonly idempotencyKey: string | undefined;
  readonly body: unknown;

  constructor(init: ReviralErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ReviralError";
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSec = init.retryAfterSec;
    this.details = init.details;
    this.required = init.required;
    this.balance = init.balance;
    this.idempotencyKey = init.idempotencyKey;
    this.body = init.body;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Parses all three error shapes the API returns:
 * 1. standard:  { error: { code, message, details?, required?, balance? }, docs }
 * 2. legacy:    { ok: false, error: "code", message?, detail?, docs }
 * 3. render:    { error: "code", required?, balance? }
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  retryAfterSec: number | undefined,
  idempotencyKey: string | undefined,
): ReviralError {
  const record = asRecord(body);
  const nested = asRecord(record?.error);
  let code = `http_${status}`;
  let message = `Request failed with HTTP ${status}`;
  let details: FieldError[] | undefined;
  let required: number | undefined;
  let balance: number | undefined;
  let echoedKey: string | undefined;

  if (nested) {
    if (typeof nested.code === "string") code = nested.code;
    if (typeof nested.message === "string") message = nested.message;
    if (Array.isArray(nested.details)) details = nested.details as FieldError[];
    required = num(nested.required);
    balance = num(nested.balance);
    if (typeof nested.idempotencyKey === "string") echoedKey = nested.idempotencyKey;
  } else if (record && typeof record.error === "string") {
    code = record.error;
    if (typeof record.message === "string") message = record.message;
    else if (typeof record.detail === "string") message = record.detail;
    else message = record.error;
    required = num(record.required);
    balance = num(record.balance);
  }

  return new ReviralError({
    status,
    code,
    message,
    retryAfterSec,
    details,
    required,
    balance,
    idempotencyKey: echoedKey ?? idempotencyKey,
    body,
  });
}
