/**
 * Emit the OpenAPI 3.1 document to a file (default: openapi.json at repo root).
 * Run: `bun run openapi:emit` or `bun src/server/emit-openapi.ts [outPath]`.
 *
 * The committed openapi.json is the drift-CI anchor: the consumer (Next.js
 * frontend) checks its generated client against this spec; regenerate it
 * whenever the ROUTES table or response shapes change.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenAPIDocument } from "./openapi.js";

const outArg = process.argv[2];
const defaultOut = fileURLToPath(new URL("../../openapi.json", import.meta.url));
const out = outArg ?? defaultOut;

const doc = buildOpenAPIDocument();
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
// eslint-disable-next-line no-console
console.log(`wrote OpenAPI 3.1 spec -> ${out}`);
