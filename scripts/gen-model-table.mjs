#!/usr/bin/env node
// Regenerates the model table in README.md from the live public catalog
// (GET https://reviral.ai/api/v1/models). Rewrites ONLY the text between
// <!-- models:start --> and <!-- models:end -->. Node >= 20, no dependencies.
// Usage: npm run gen:models   (override the endpoint with REVIRAL_MODELS_URL)
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const URL_ = process.env.REVIRAL_MODELS_URL ?? "https://reviral.ai/api/v1/models";
const README = fileURLToPath(new URL("../README.md", import.meta.url));
const START = "<!-- models:start -->";
const END = "<!-- models:end -->";

class GenError extends Error {}
function fail(msg) {
  throw new GenError(msg);
}

async function main() {
let res;
try {
  res = await fetch(URL_, { headers: { accept: "application/json" } });
} catch (err) {
  fail(`could not reach ${URL_}: ${err?.message ?? err}`);
}
if (res.status !== 200) fail(`${URL_} returned HTTP ${res.status}; README left untouched`);
const body = await res.json().catch(() => fail("response was not JSON; README left untouched"));
const models = Array.isArray(body?.data) ? body.data : null;
if (!models || models.length === 0) fail("response had no data[] models; README left untouched");

const esc = (s) => String(s ?? "").replace(/\|/g, "\|");
const num = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));

function credits(m) {
  const parts = [];
  for (const [res, c] of Object.entries(m.credits ?? {})) {
    if (c == null) continue;
    if (typeof c.perSecond === "number") parts.push(`${res}: ${num(c.perSecond)}/s`);
    else if (typeof c.perVideo === "number") parts.push(`${res}: ${num(c.perVideo)}/video`);
    else if (typeof c.perImage === "number") parts.push(`${res}: ${num(c.perImage)}/image`);
  }
  return parts.length ? parts.join(", ") : "—";
}

function durations(m) {
  const d = m.durations;
  if (!d) return "—";
  if (d.kind === "range") return `${d.min}–${d.max}`;
  if (Array.isArray(d.values) && d.values.length) return d.values.join(", ");
  return "—";
}

const cmp = (a, b) =>
  String(a.family).localeCompare(String(b.family), "en", { sensitivity: "base" }) ||
  String(a.label).localeCompare(String(b.label), "en", { sensitivity: "base", numeric: true }) ||
  String(a.id).localeCompare(String(b.id));

const video = models.filter((m) => m.kind === "video").sort(cmp);
const image = models.filter((m) => m.kind === "image").sort(cmp);
const other = models.filter((m) => m.kind !== "video" && m.kind !== "image").sort(cmp);

const header =
  "| Public id | Name | Kind | Billing | Credits (credits per second `/s`, per video or per image) | Durations (s) | Resolutions |\n" +
  "|---|---|---|---|---|---|---|";
const row = (m) =>
  `| \`${esc(m.id)}\` | ${esc(m.label)} | ${esc(m.kind)} | ${esc(m.billing)} | ${esc(credits(m))} | ${esc(durations(m))} | ${esc((m.resolutions ?? []).join(", ") || "—")} |`;

const date = new Date().toISOString().slice(0, 10);
const table = [
  `Generated from GET /api/v1/models on ${date} (UTC); run \`npm run gen:models\` to refresh.`,
  "",
  `${models.length} models: ${video.length} video, ${image.length} image${other.length ? `, ${other.length} other` : ""}.`,
  "",
  header,
  ...[...video, ...image, ...other].map(row),
].join("\n");

const readme = await readFile(README, "utf8");
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) fail(`markers ${START} / ${END} not found in README.md`);
const before = readme.slice(0, s + START.length);
const after = readme.slice(e);
const oldInner = readme.slice(s + START.length, e);
// Keep the file byte-identical when only the date would change.
const strip = (t) => t.replace(/on \d{4}-\d{2}-\d{2} \(UTC\)/, "on DATE (UTC)");
const newInner = `\n${table}\n`;
if (strip(oldInner) === strip(newInner)) {
  console.log(`gen-model-table: ${models.length} models, no change`);
} else {
  await writeFile(README, before + newInner + after);
  console.log(`gen-model-table: wrote ${models.length} models (${video.length} video, ${image.length} image)`);
}
}

try {
  await main();
} catch (err) {
  // exitCode (not process.exit) lets pending sockets close cleanly on Windows.
  console.error(`gen-model-table: ${err instanceof GenError ? err.message : err?.stack ?? err}`);
  process.exitCode = 1;
}
