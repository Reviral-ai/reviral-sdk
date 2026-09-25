export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** In-process fake fetch: returns the queued replies in order and records every call. */
export function fakeFetch(replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    calls.push({ url, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : undefined });
    const next = queue.shift();
    if (!next) throw new Error(`fakeFetch: no reply queued for ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    const text = next.body === undefined ? "" : typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text === "" ? null : text, {
      status: next.status,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  };
  return { fetch, calls, remaining: () => queue.length };
}

/** Sleep stub that records requested delays and returns immediately. */
export function fakeSleep() {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { sleep, waits };
}

export const JOB_ID = "550e8400-e29b-41d4-a716-446655440000";

export function job(status: "queued" | "running" | "ready" | "failed", extra: Record<string, unknown> = {}) {
  return {
    data: {
      jobId: JOB_ID,
      kind: "image",
      model: "gpt-image-2.5-flare",
      modelUsed: "gpt-image-2.5-flare",
      modelsUsed: ["gpt-image-2.5-flare"],
      fallbackFired: false,
      status,
      creditsCharged: 2,
      ...extra,
    },
  };
}
