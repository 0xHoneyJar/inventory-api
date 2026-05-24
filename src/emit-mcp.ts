/**
 * Emit the MCP tool manifest to a file (default: mcp.json at repo root).
 * Run: `bun run mcp:emit` or `bun src/emit-mcp.ts [outPath]`.
 *
 * Discovery artifact mirroring the live `GET /.well-known/mcp.json` route —
 * committed so MCP-tool consumers can drift-CI against the tool surface.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildMCPManifest } from "./app.js";

const outArg = process.argv[2];
const defaultOut = fileURLToPath(new URL("../mcp.json", import.meta.url));
const out = outArg ?? defaultOut;

writeFileSync(out, `${JSON.stringify(buildMCPManifest(), null, 2)}\n`, "utf-8");
// eslint-disable-next-line no-console
console.log(`wrote MCP manifest -> ${out}`);
