// dist/cjs needs its own package.json so Node treats the .js files as CommonJS
// even though the package root is "type": "module".
import { writeFileSync } from "node:fs";
writeFileSync("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }, null, 2) + "\n");
