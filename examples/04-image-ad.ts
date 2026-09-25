// Upload a product photo and generate an image ad from the "headline" template.
// Run: REVIRAL_API_KEY=your_key node examples/04-image-ad.ts ./product.jpg
import { readFile } from "node:fs/promises";
import { Reviral } from "@reviral/sdk";

const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });
const photoPath = process.argv[2];
if (!photoPath) throw new Error("usage: node examples/04-image-ad.ts <photo.jpg>");

// 1. Read the template: required fields, constraints and its credit price.
const template = (await reviral.imageAds.templates()).find((t) => t.id === "headline");
if (!template) throw new Error("headline template not found");
console.log(`${template.name}: ${template.credits} credits; needs ${template.requiredFields.join(", ")}`);

// 2. Upload the photo (JPG/PNG/WebP up to 4 MB). Only owned upload URLs are accepted.
const bytes = await readFile(photoPath);
const upload = await reviral.uploads.create({ file: new Blob([bytes], { type: "image/jpeg" }), filename: "product.jpg" });

// 3. Start the ad. maxCredits locks the exact price read above.
const job = await reviral.imageAds.generate(
  {
    templateId: template.id,
    product: {
      title: "Trail shoe",
      bullets: ["Grippy rubber outsole", "Water-resistant upper"],
      price: "$89",
      photos: [upload.url],
      rating: 4.7,
      reviews: ["Held up on wet trails"],
      brand: "North",
    },
    brand: { colors: ["#112233", "#DDEEFF", "#F4F4F4"], fonts: ["Inter"], voice: ["direct"], neverSay: ["cheap"], logoUrl: null },
    copy: { headline: "Grip that keeps going", subhead: "Built for wet trails" },
    creative: { surface: "wet slate rock" },
    language: "en",
    maxCredits: template.credits,
  },
  { idempotencyKey: `ad-headline-${upload.id}` },
);

// 4. Poll until ready or failed.
const done = await reviral.jobs.waitUntilDone(job.jobId);
console.log(done.status === "ready" ? done.outputUrls ?? done.outputUrl : `failed: ${done.error}`);
