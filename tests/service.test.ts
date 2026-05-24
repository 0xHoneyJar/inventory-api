import { describe, it, expect } from "vitest";
import { app, buildOpenAPI, buildMCPManifest } from "../src/app.js";

/**
 * Hyper service tests. We call the app's Web-standard `fetch` handler
 * directly (no port bind, no Bun runtime needed) so the suite runs offline
 * under vitest/Node — Hyper's pipeline + response coercion are Web-standard.
 * The HTTP routes, the MCP JSON-RPC endpoint, and the OpenAPI/MCP discovery
 * surfaces all funnel through the same route graph (src/routes.ts), which
 * calls the domain functions (Part 1 logic) in src/inventory.ts.
 */
const MIBERA = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
const HOLDER = "0x1111111111111111111111111111111111111111";
const EMPTY = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const BASE = "http://localhost";

const get = (path: string) => app.fetch(new Request(`${BASE}${path}`));
const post = (path: string, body: unknown) =>
  app.fetch(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("HTTP routes (via app.fetch)", () => {
  it("GET /health", async () => {
    const res = await get("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("inventory-api");
  });

  it("GET /holdings/:address wraps getHoldings", async () => {
    const res = await get(`/holdings/${HOLDER}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings[0].tokenCount).toBe(12);
    expect(body.holdings[0].tokenIds).toHaveLength(12);
    expect(body.completeness.source).toBe("sonar");
  });

  it("GET /holdings/:address forwards the contracts query option", async () => {
    const res = await get(`/holdings/${HOLDER}?contracts=${MIBERA}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings[0].contractAddress).toBe(MIBERA);
  });

  it("GET /nfts/:contract/owner/:address wraps getNftsForOwner with pagination", async () => {
    const res = await get(`/nfts/${MIBERA}/owner/${HOLDER}?pageSize=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nfts).toHaveLength(5);
    expect(body.pageKey).toBeDefined();
    expect(body.name).toBe("Mibera");
  });

  it("GET /nfts/:contract/:tokenId wraps getNftMetadata", async () => {
    const res = await get(`/nfts/${MIBERA}/2769`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Air"); // pinned grail
  });

  it("maps ValidationError -> 400 with code", async () => {
    const res = await get("/holdings/not-an-address");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVENTORY_INVALID_INPUT");
  });

  it("maps NotFoundError -> 404 with code", async () => {
    const res = await get(`/nfts/${MIBERA}/99999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("INVENTORY_NOT_FOUND");
  });

  it("empty holder returns empty holdings (graceful)", async () => {
    const res = await get(`/holdings/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toHaveLength(0);
  });
});

describe("OpenAPI 3.1 surface", () => {
  it("serves /openapi.json as 3.1.0 with the 3 routes", async () => {
    const res = await get("/openapi.json");
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("inventory-api");
    expect(doc.paths["/holdings/{address}"]).toBeDefined();
    expect(doc.paths["/nfts/{contract}/owner/{address}"]).toBeDefined();
    expect(doc.paths["/nfts/{contract}/{tokenId}"]).toBeDefined();
  });

  it("operationIds + path params + query params are projected", async () => {
    const doc = buildOpenAPI();
    const holdings = doc.paths["/holdings/{address}"]!.get!;
    expect(holdings.operationId).toBe("getHoldings");
    const paramNames = (holdings.parameters ?? []).map((p) => p.name);
    expect(paramNames).toContain("address"); // path param
    expect(paramNames).toContain("contracts"); // query param (from zod)
    expect(paramNames).toContain("chains");
  });

  it("declared 4xx errors are projected (throws)", async () => {
    const doc = buildOpenAPI();
    const meta = doc.paths["/nfts/{contract}/{tokenId}"]!.get!;
    expect(meta.responses["404"]).toBeDefined();
  });

  it("response examples surface in the spec", async () => {
    const doc = buildOpenAPI();
    const holdings = doc.paths["/holdings/{address}"]!.get!;
    const example = holdings.responses["200"].content?.["application/json"]?.example as
      | { holdings: unknown[] }
      | undefined;
    expect(example?.holdings).toBeDefined();
  });
});

describe("MCP surface", () => {
  it("serves /.well-known/mcp.json with the 3 tools", async () => {
    const res = await get("/.well-known/mcp.json");
    expect(res.status).toBe(200);
    const manifest = await res.json();
    const names = manifest.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["getHoldings", "getNftMetadata", "getNftsForOwner"]);
  });

  it("POST /mcp tools/list returns the tools (JSON-RPC)", async () => {
    const res = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("getHoldings");
  });

  it("POST /mcp tools/call getNftMetadata runs the same domain path", async () => {
    const res = await post("/mcp", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "getNftMetadata", arguments: { params: { contract: MIBERA, tokenId: "2769" } } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const text = body.result.content[0].text;
    const doc = JSON.parse(text);
    expect(doc.name).toBe("Air");
  });

  it("buildMCPManifest matches the served manifest", async () => {
    const manifest = buildMCPManifest();
    expect(manifest.tools).toHaveLength(3);
  });
});
