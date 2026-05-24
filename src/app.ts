/**
 * inventory-api — the Hyper (Bun) service entrypoint.
 *
 * Consumed over HTTP + MCP (the operator's no-npm decision: honeyroad reads
 * this over the wire, never as an npm package). One route declaration per
 * endpoint (src/routes.ts) drives every surface here:
 *
 *   HTTP        GET /holdings/:address, /nfts/:contract/owner/:address,
 *               /nfts/:contract/:tokenId
 *   OpenAPI 3.1 GET /openapi.json   (drift-CI anchor) + GET /docs (Swagger UI)
 *   MCP         POST /mcp (JSON-RPC 2.0) + GET /.well-known/mcp.json (manifest)
 *   health      GET /health
 *
 * Run: `bun run dev` (hot reload) or `bun run start`.
 */
import { Hyper, ok } from "@hyper/core";
import { openapiHandlers, generate, type OpenAPIDoc } from "@hyper/openapi";
import { zodConverter } from "@hyper/openapi-zod";
import { mcpServer } from "@hyper/mcp";
import { routes } from "./routes.js";

export const OPENAPI_CONFIG = {
  title: "inventory-api",
  version: "0.1.0",
  description:
    "Sovereign read-side inventory aggregator — joins sonar holdings with owned codex metadata + an ACVP completeness envelope.",
  converters: [zodConverter],
} as const;

// The business-route graph (the 3 endpoints) is the canonical source for
// OpenAPI + MCP generation — built once, never mutated by the meta routes
// below. `routes` is imported from src/routes.ts; `.build()` is memoized.
const businessApp = new Hyper({ name: "inventory-api" }).use(routes).build();

/** OpenAPI 3.1 document for the 3 business routes (drift-CI anchor). */
export function buildOpenAPI(): OpenAPIDoc {
  return generate(businessApp, OPENAPI_CONFIG);
}

/** The MCP tool manifest (meta.mcp routes only). */
export function buildMCPManifest() {
  return businessApp.toMCPManifest();
}

// OpenAPI 3.1 (+ Swagger UI) derived from the route declarations.
const oa = openapiHandlers(businessApp, { ...OPENAPI_CONFIG, specUrl: "/openapi.json" });

// MCP server (JSON-RPC) over the same route graph (meta.mcp routes only).
const mcp = mcpServer(businessApp, {
  info: { name: "inventory-api", version: "0.1.0" },
});

// The served app: business routes + meta/discovery routes.
export const app = new Hyper({ name: "inventory-api" })
  .use(routes)
  .get("/health", () =>
    ok({ ok: true, service: "inventory-api", routes: businessApp.routeList.length }),
  )
  .get("/openapi.json", ({ req }) => oa.spec(req))
  .get("/docs", ({ req }) => oa.docs(req))
  .get("/.well-known/mcp.json", () => ok(mcp.manifest))
  // Hyper's pipeline auto-parses + consumes the POST body before the handler
  // runs, so `mcp.handle` (which calls `req.json()`) would see an empty stream.
  // Reconstruct a fresh Request from the already-parsed `ctx.body` and hand
  // that to the JSON-RPC handler.
  .post("/mcp", ({ req, body }) =>
    mcp.handle(
      new Request(req.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    ),
  );

// `bun src/app.ts` boots Bun.serve; importing for tests does not (guarded on
// import.meta.main, which is false when imported by tests / emit scripts).
if (import.meta.main) {
  const port = Number(process.env.PORT) || 8787;
  // Bind 0.0.0.0 (not Hyper's localhost default) so the platform healthcheck
  // can reach the container — root cause of the Railway deploy failures.
  app.listen({ port, hostname: "0.0.0.0" });
  console.log(`[inventory-api] listening on 0.0.0.0:${port} (PORT=${process.env.PORT ?? "unset"})`);
}
