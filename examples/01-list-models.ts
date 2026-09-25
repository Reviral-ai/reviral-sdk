// List every model the Reviral API offers right now, with its live credit price.
// Run: REVIRAL_API_KEY=your_key node examples/01-list-models.ts   (after `npm run build`)
import { Reviral, type Model } from "@reviral/sdk";

const reviral = new Reviral({ apiKey: process.env.REVIRAL_API_KEY });

function priceAtDefaults(model: Model): string {
  const price = model.credits[model.defaults.resolution];
  if (!price) return "see credits";
  if (model.kind === "image") return `${price.perImage} credits / image`;
  if (price.perSecond !== undefined) return `${price.perSecond} credits / second`;
  return `${price.perVideo} credits / video`;
}

const models = await reviral.models.list();
console.log(`${models.length} models available`);
for (const kind of ["video", "image"] as const) {
  console.log(`\n${kind.toUpperCase()}`);
  for (const m of models.filter((x) => x.kind === kind)) {
    console.log(`  ${m.id.padEnd(34)} ${m.label.padEnd(40)} ${priceAtDefaults(m)}`);
  }
}
