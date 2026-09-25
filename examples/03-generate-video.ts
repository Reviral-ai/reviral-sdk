// Generate a short video with a Veo, Seedance or Kling model at its default settings.
// Run: REVIRAL_API_KEY=your_key MODEL=veo-3.1-lite node examples/03-generate-video.ts
import { Reviral, generateIdempotencyKey } from "@reviral/sdk";

const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });
const MODEL = process.env.MODEL ?? "veo-3.1-lite";

const model = (await reviral.models.list()).find((m) => m.id === MODEL && m.kind === "video");
if (!model) throw new Error(`${MODEL} is not a video model in the live catalog`);

const { resolution, aspectRatio, durationSec } = model.defaults;
const price = model.credits[resolution];
// Default-duration price for per-second and flat models alike.
const quote =
  price?.creditsAtDefaultDuration ??
  (durationSec !== undefined ? price?.byDuration?.[String(durationSec)] : undefined) ??
  price?.perVideo;
console.log(`${model.label}: ${durationSec}s ${resolution} ${aspectRatio}, quoted ${quote} credits`);

// Keep this key with your own record of the request. If the POST times out,
// resend the SAME body with the SAME key: you get the original job back.
const idempotencyKey = generateIdempotencyKey();

const job = await reviral.generateMedia(
  {
    model: MODEL,
    prompt: "Slow dolly-in on a steaming espresso cup on a cafe counter at sunrise, shallow depth of field",
    resolution,
    aspectRatio,
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(quote !== undefined ? { maxCredits: quote } : {}),
  },
  { idempotencyKey },
);
console.log(`job ${job.jobId} accepted (${job.creditsCharged} credits), key ${idempotencyKey}`);

const done = await reviral.jobs.waitUntilDone(job.jobId, {
  timeoutMs: 30 * 60_000,
  onPoll: (j) => console.log(`  ${j.status}${j.outputPending ? " (delivery URL pending)" : ""}`),
});

if (done.status === "ready") {
  console.log(`video: ${done.outputUrl}`);
  console.log(`model used: ${done.modelUsed}${done.fallbackFired ? " (fallback)" : ""}`);
} else {
  console.error(`failed: ${done.error}; net charge ${done.creditsCharged} credits`);
}
