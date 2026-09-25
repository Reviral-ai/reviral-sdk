// Generate one image with GPT Image 2.5 Flare (2 credits per image at 1K on 2026-09-25),
// safely retryable with an Idempotency-Key, then wait for the result.
// Run: REVIRAL_API_KEY=your_key node examples/02-generate-image.ts
import { Reviral, ReviralError } from "@reviral/sdk";

const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });
const MODEL = "gpt-image-2.5-flare";

// Read the live price instead of hardcoding it. maxCredits is an exact-match
// price lock: if the live charge differs, the API returns 409 and starts nothing.
const model = (await reviral.models.list()).find((m) => m.id === MODEL);
if (!model) throw new Error(`${MODEL} is not in the catalog right now`);
const perImage = model.credits[model.defaults.resolution]?.perImage;

// Use a stable business id (order id, row id) so a retry never double-charges.
const idempotencyKey = `demo-image-${new Date().toISOString().slice(0, 10)}-001`;

try {
  const job = await reviral.generateMedia(
    {
      model: MODEL,
      prompt: "Studio product photo of a matte black water bottle on pale stone, soft window light",
      aspectRatio: "1:1",
      count: 1,
      ...(perImage !== undefined ? { maxCredits: perImage } : {}),
    },
    { idempotencyKey },
  );
  console.log(`job ${job.jobId} ${job.status}, ${job.creditsCharged} credits`);

  const done = await reviral.jobs.waitUntilDone(job.jobId); // 2 s -> 10 s backoff
  if (done.status === "failed") {
    console.error(`failed: ${done.error}`);
  } else {
    // Signed URLs expire: download them promptly.
    for (const url of done.outputUrls ?? []) console.log(url);
  }
} catch (err) {
  if (err instanceof ReviralError && err.code === "price_changed") {
    console.error(`price changed, live charge is now ${err.required} credits`);
  } else if (err instanceof ReviralError && (err.code === "timeout" || err.code === "network_error")) {
    console.error(`no answer; resend the same body with Idempotency-Key ${err.idempotencyKey}`);
  } else {
    throw err;
  }
}
