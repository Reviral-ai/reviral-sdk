// Photobooth pattern: many devices, ONE server holding ONE key. Generation is limited to
// 10/minute and 1,000/day per key, so the server queues shots and starts at most one every
// 6 s. Devices never hold the key. Run: REVIRAL_API_KEY=your_key node examples/05-photobooth-queue.ts
import { Reviral, ReviralError } from "@reviral/sdk";

const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });
const PER_MINUTE = 10;
const GAP_MS = 60_000 / PER_MINUTE; // spread starts evenly instead of bursting
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Shot = { deviceId: string; shotId: string; prompt: string };
const queue: Shot[] = [];
// In production the devices POST shots to your server; here 3 devices x 5 shots.
for (const deviceId of ["booth-a", "booth-b", "booth-c"]) {
  for (let n = 1; n <= 5; n++) queue.push({ deviceId, shotId: `${deviceId}-${n}`, prompt: `Party portrait, confetti, neon light, frame ${n}` });
}

async function start(shot: Shot) {
  for (;;) {
    try {
      // Idempotency-Key = the shot id: a retried shot can never be charged twice.
      return await reviral.generateMedia({ model: "gpt-image-2.5-flare", prompt: shot.prompt, count: 1 }, { idempotencyKey: shot.shotId });
    } catch (err) {
      // The SDK already retried once. Still limited: wait Retry-After and re-queue.
      if (err instanceof ReviralError && err.status === 429) {
        await sleep((err.retryAfterSec ?? 60) * 1000);
        continue;
      }
      throw err;
    }
  }
}

const pending: Promise<void>[] = [];
while (queue.length) {
  const shot = queue.shift()!;
  const job = await start(shot);
  console.log(`${shot.shotId} -> job ${job.jobId} (${job.status})`);
  // Poll in the background; job status has its own larger budget (120/min per key).
  pending.push(
    reviral.jobs.waitUntilDone(job.jobId, { pollMs: 3_000 }).then((done) => {
      console.log(`${shot.shotId} ${done.status}: ${done.outputUrls?.[0] ?? done.error}`);
    }),
  );
  if (queue.length) await sleep(GAP_MS);
}
await Promise.allSettled(pending);
