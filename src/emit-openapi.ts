/**
 * Emit the OpenAPI 3.1 document to a file (default: openapi.json at repo root).
 * Run: `bun run openapi:emit` or `bun src/emit-openapi.ts [outPath]`.
 *
 * The committed openapi.json is the drift-CI anchor the honeyroad frontend
 * checks its generated client against. Regenerate whenever the route
 * declarations (src/routes.ts) or domain response shapes change.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenAPI } from "./app.js";

const outArg = process.argv[2];
const defaultOut = fileURLToPath(new URL("../openapi.json", import.meta.url));
const out = outArg ?? defaultOut;

writeFileSync(out, `${JSON.stringify(buildOpenAPI(), null, 2)}\n`, "utf-8");
// eslint-disable-next-line no-console
console.log(`wrote OpenAPI 3.1 spec -> ${out}`);
