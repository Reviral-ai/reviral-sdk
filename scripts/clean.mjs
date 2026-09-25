import { rmSync } from "node:fs";
for (const dir of process.argv.slice(2).length ? process.argv.slice(2) : ["dist", ".test-build"]) {
  rmSync(dir, { recursive: true, force: true });
}
