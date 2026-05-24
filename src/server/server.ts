/**
 * Bun HTTP transport for inventory-api.
 *
 * A THIN transport over the existing library functions (index.ts /
 * src/inventory.ts). The library stays the core; this just exposes
 * getHoldings / getNftsForOwner / getNftMetadata over HTTP, plus discovery
 * docs: an OpenAPI 3.1 spec (/openapi.json) and an MCP tool manifest
 * (/.well-known/mcp.json), both derived from the single ROUTES table.
 *
 * Why a minimal Bun.serve rather than full Hyper: see src/server/README.md.
 *
 * Run:  bun src/server/server.ts          (PORT env, default 8787)
 * Spec: bun run openapi:emit              (writes openapi.json to repo root)
 */
import { ROUTES, type RouteDef } from "./routes.js";
import { buildOpenAPIDocument } from "./openapi.js";
import { buildMCPManifest } from "./mcp.js";

// Library error codes (src/errors.ts) → HTTP status.
const ERROR_STATUS: Record<string, number> = {
  INVENTORY_INVALID_INPUT: 400,
  INVENTORY_NOT_FOUND: 404,
  INVENTORY_FIXTURE_LOAD: 500,
};

interface CompiledRoute {
  readonly def: RouteDef;
  readonly regex: RegExp;
  readonly paramNames: readonly string[];
}

/** Compile `/nfts/{contract}/{tokenId}` into a matcher + param names. */
function compileRoute(def: RouteDef): CompiledRoute {
  const paramNames: string[] = [];
  const pattern = def.path.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { def, regex: new RegExp(`^${pattern}$`), paramNames };
}

const COMPILED: readonly CompiledRoute[] = ROUTES.map(compileRoute);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

/** Map a thrown library error to an HTTP response. */
function errorResponse(err: unknown): Response {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : undefined;
  const status = code && ERROR_STATUS[code] ? ERROR_STATUS[code] : 500;
  const message = err instanceof Error ? err.message : "internal error";
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

/** The fetch handler — exported so it can be unit-tested without binding a port. */
export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  // Discovery + health.
  if (pathname === "/" || pathname === "/health") {
    return json({ ok: true, service: "inventory-api", routes: ROUTES.length });
  }
  if (pathname === "/openapi.json") {
    return json(buildOpenAPIDocument());
  }
  if (pathname === "/.well-known/mcp.json" || pathname === "/mcp.json") {
    return json(buildMCPManifest());
  }

  // Dispatch to a route.
  for (const { def, regex, paramNames } of COMPILED) {
    if (def.method !== req.method) continue;
    const m = regex.exec(pathname);
    if (!m) continue;
    const pathParams: Record<string, string> = {};
    paramNames.forEach((name, i) => {
      pathParams[name] = decodeURIComponent(m[i + 1]);
    });
    try {
      const result = await def.handler(pathParams, url.searchParams);
      return json(result);
    } catch (err) {
      return errorResponse(err);
    }
  }

  return json({ error: "not found", code: "ROUTE_NOT_FOUND" }, 404);
}

/** Start the server. Skipped at import time so tests can use `handle` directly. */
export function start(port = Number(process.env.PORT) || 8787): Bun.Server {
  const server = Bun.serve({ port, fetch: handle });
  // eslint-disable-next-line no-console
  console.log(
    `inventory-api listening on http://${server.hostname}:${server.port} (${ROUTES.length} routes) — spec at /openapi.json, mcp at /.well-known/mcp.json`,
  );
  return server;
}

// `bun src/server/server.ts` runs this directly; importing for tests does not.
if (import.meta.main) {
  start();
}
