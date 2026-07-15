import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app, buildOpenAPI, buildMCPManifest } from "../src/app.js";
import { stubSovereignCdn } from "./support/sovereign-cdn-stub.js";

/**
 * Hyper service tests. We call the app's Web-standard `fetch` handler
 * directly (no port bind, no Bun runtime needed) so the suite runs offline
 * under vitest/Node — Hyper's pipeline + response coercion are Web-standard.
 * The HTTP routes, the MCP JSON-RPC endpoint, and the OpenAPI/MCP discovery
 * surfaces all funnel through the same route graph (src/routes.ts), which
 * calls the domain functions (Part 1 logic) in src/inventory.ts.
 *
 * Both Mibera metadata routes (single-token and owner-list) read the sovereign
 * storage-api, so `fetch` is stubbed from the committed fixture. Without this the
 * file silently reached metadata.0xhoneyjar.xyz over the network — it did so from
 * PR #16 until bug 20260709-499c5a, which is why it ran ~20x slower than its peers.
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

beforeEach(() => {
  stubSovereignCdn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("GET /collections projects the enabled registry (the dashboard discovery seam)", async () => {
    const res = await get("/collections");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.collections)).toBe(true);
    expect(body.collections.length).toBeGreaterThan(0);

    // Every row carries the fields the dashboard resolves a community from.
    for (const c of body.collections) {
      expect(typeof c.id).toBe("string");
      expect(Array.isArray(c.aliases)).toBe(true);
      expect(["evm", "svm"]).toContain(c.chain);
      expect(typeof c.chainId).toBe("number");
      expect(typeof c.name).toBe("string");
      // rehost_policy is ALWAYS concrete — never undefined.
      expect(["mirror", "proxy", "excluded"]).toContain(c.rehost_policy);
      // imageHost (PYTH-2) is OMITTED when absent (undefined after JSON
      // round-trip) or an array — but MUST NEVER be an explicit `null`, which
      // would throw PYTH-3's whole /collections decode. See the wire test below.
      expect(c.imageHost === undefined || Array.isArray(c.imageHost)).toBe(true);
      expect(c.imageHost).not.toBeNull();
    }

    const byKey = (k: string) =>
      body.collections.find(
        (c: { id: string; aliases: string[] }) => c.id === k || c.aliases.includes(k),
      );
    // Mibera is ours -> mirror; Azuki is third-party -> proxy; Pythenians is
    // proxy too, resolved via sonar's own pass-through (PYTH-2).
    expect(byKey("mibera").rehost_policy).toBe("mirror");
    expect(byKey("azuki").rehost_policy).toBe("proxy");
    expect(byKey("azuki").metadataStrategy).toBe("tokenuri");
    expect(byKey("pythians").rehost_policy).toBe("proxy");
    expect(byKey("pythians").metadataStrategy).toBe("sonar-image");
    // PYTH-2: the dashboard image-optimizer allowlist seam — a real host.
    expect(byKey("pythians").imageHost).toEqual(["ipfs.pythenians.xyz"]);
    expect(byKey("mad_lads").imageHost).toEqual([
      "madlads.s3.us-west-2.amazonaws.com",
    ]);
    // A host-less row OMITS the key entirely (absent after JSON round-trip),
    // NOT `imageHost: null`. PYTH-3's effect Schema tolerates absent but
    // throws on explicit null — one null row would blank the whole registry.
    expect("imageHost" in byKey("mibera")).toBe(false);
    expect(byKey("mibera").imageHost).toBeUndefined();
  });

  it("GET /collections wire carries NO explicit `imageHost: null` — the PYTH-3 decode contract", async () => {
    const res = await get("/collections");
    expect(res.status).toBe(200);
    // Assert against the RAW wire bytes the dashboard actually decodes, not a
    // re-serialization: an explicit null anywhere throws effect Schema's whole
    // array decode -> loadCollectionRegistry() returns [] -> every community's
    // PFP path regresses to identicons. This is the specific hole that a
    // `imageHost ?? null` projection would reopen.
    const raw = await res.text();
    expect(raw).not.toContain('"imageHost":null');
    expect(raw).not.toContain('"imageHost": null');
    // ...and the one real host DID make it onto the wire (not omitted too).
    expect(raw).toContain('"imageHost":["ipfs.pythenians.xyz"]');
    expect(raw).toContain(
      '"imageHost":["madlads.s3.us-west-2.amazonaws.com"]',
    );
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
  it("serves /.well-known/mcp.json with the 5 tools", async () => {
    const res = await get("/.well-known/mcp.json");
    expect(res.status).toBe(200);
    const manifest = await res.json();
    const names = manifest.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([
      "getHoldings",
      "getNftMetadata",
      "getNftsForOwner",
      "getProfilePicture",
      "listCollections", // GET /collections — added for the dashboard seam (INV-A)
    ]);
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
    expect(manifest.tools).toHaveLength(5);
  });
});
