import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getNftsForOwner, getProfilePicture } from "../src/inventory.js";
import { METADATA_FETCH_CONCURRENCY } from "../src/sovereign-metadata.js";
import { stubSovereignCdn, sovereignCdnResponse } from "./support/sovereign-cdn-stub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

const MIBERA_CONTRACT = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
// Lowercase on purpose — the resolver must checksum before the registry lookup.
const MST_CONTRACT = "0x048327a187b944ddac61c6e202bfccd20d17c008";

/**
 * Regression suite for bug 20260709-499c5a.
 *
 * `getNftsForOwner` resolved per-token metadata against `fixtures/codex-tokens.json`
 * — 55 of the 10,000 Mibera. Any token outside that sample fell into the miss
 * branch and returned `imageUrl: ""`, so `getProfilePicture` (which nulls on an
 * empty image) served `null` to ~99.5% of real holders in production.
 *
 * The defect was invisible to the suite because the fixtures were mutually
 * consistent: every sonar token id had a codex record, so the miss branch was
 * unreachable. `ORPHAN_HOLDER` owns token 8485 — present in the real codex and on
 * the sovereign CDN, absent from the codex fixture — which makes it reachable.
 */
const ORPHAN_HOLDER = "0x7777777777777777777777777777777777777777";
const ORPHAN_TOKEN = "8485";

// The image the live CDN serves for 8485 — the same URL the single-token route
// (GET /nfts/:contract/8485) already returned while the owner-list served "".
const ORPHAN_IMAGE =
  "https://assets.0xhoneyjar.xyz/reveal_phase8/images/21c35dd0a10646721a60c1f8d39dfb01a691f686.png";

describe("getNftsForOwner — sovereign metadata for tokens absent from the codex fixture", () => {
  beforeEach(() => {
    stubSovereignCdn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a non-empty imageUrl for a token absent from fixtures/codex-tokens.json", async () => {
    const result = await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);

    expect(result.nfts).toHaveLength(1);
    const nft = result.nfts[0];
    expect(nft.tokenId).toBe(ORPHAN_TOKEN);
    expect(nft.imageUrl).toBe(ORPHAN_IMAGE);
    expect(nft.imageUrl.length).toBeGreaterThan(0);
  });

  it("resolves description and attributes too — not just the image", async () => {
    const result = await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);
    const nft = result.nfts[0];

    expect(nft.name).toBe(`Mibera #${ORPHAN_TOKEN}`);
    expect(nft.description).not.toBe("Unknown");
    expect(nft.attributes.length).toBeGreaterThanOrEqual(10);
    expect(nft.attributes.map((a) => a.trait_type)).toContain("archetype");
  });

  it("getProfilePicture returns a real image for a holder outside the codex fixture", async () => {
    const pfp = await getProfilePicture(ORPHAN_HOLDER);
    expect(pfp).toBe(ORPHAN_IMAGE);
  });

  it("returns the collection identity for Mibera", async () => {
    // NOTE: this cannot distinguish registry-sourcing from the old codex-sourcing —
    // the codex fixture's `collection` block carries identical values. The MST suite
    // below is what actually pins the registry as the source, because MST has no
    // entry in the codex fixture at all.
    const result = await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);
    expect(result.contractAddress).toBe(MIBERA_CONTRACT);
    expect(result.name).toBe("Mibera");
    expect(result.symbol).toBe("MIBERA");
    expect(result.totalSupply).toBe(10000);
  });
});

/**
 * The owner-list attribute grid now IS the codex's own rendering, served by the
 * sovereign route. Two shapes that inventory-api used to synthesize are gone, and
 * nothing else pins their absence — so pin it here.
 *
 *   - `{trait_type:"Grail", value:"true"}` existed in neither codex file nor the CDN;
 *     `transform.ts` invented it. Grail identity is the codex's own `tier: "Grail"`.
 *   - trait keys were the codex's internal COLUMN names (`time_period`). The codex's
 *     rendering — and honeyroad's own pipeline — use the spaced form (`time period`).
 */
describe("getNftsForOwner — the synthesized codex attribute shape is retired", () => {
  const ADDR_WITH_GRAIL = "0x2222222222222222222222222222222222222222";
  const ADDR_WITH_MANY = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    stubSovereignCdn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a grail carries NO synthesized {trait_type:'Grail'} attribute", async () => {
    const result = await getNftsForOwner(ADDR_WITH_GRAIL, MIBERA_CONTRACT);
    const grail = result.nfts.find((n) => n.tokenId === "2769")!;

    expect(grail.attributes.map((a) => a.trait_type)).not.toContain("Grail");
    expect(grail.attributes).toContainEqual({ trait_type: "tier", value: "Grail" });
  });

  it("generative trait keys are the codex's spaced labels, not its snake_case columns", async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 1 });
    const keys = result.nfts[0].attributes.map((a) => a.trait_type);

    expect(keys).toContain("time period");
    expect(keys).toContain("sun sign");
    expect(keys).not.toContain("time_period");
    expect(keys).not.toContain("sun_sign");
  });
});

describe("getNftsForOwner — sovereign failure handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an absent token (404) yields an imageless NFT rather than failing the page", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));

    const result = await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);
    const nft = result.nfts[0];

    expect(nft.tokenId).toBe(ORPHAN_TOKEN);
    expect(nft.name).toBe(`Mibera #${ORPHAN_TOKEN}`);
    expect(nft.imageUrl).toBe("");
    expect(nft.attributes).toEqual([]);
  });

  it("an absent token does NOT warn — 404 is an expected, silent outcome", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a degraded upstream (5xx) warns — it must not masquerade as an absent token", async () => {
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 503 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);

    // Same fail-soft payload as a 404 — so the log line is the ONLY signal that
    // separates "origin is down" from "token has no metadata".
    expect(result.nfts[0].imageUrl).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("sovereign metadata");
    expect(String(warn.mock.calls[0][0])).toContain("1 failed");
    warn.mockRestore();
  });

  it("a network failure warns and still resolves the page", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);

    expect(result.nfts[0].imageUrl).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns ONCE per page, not once per token — a down origin must not flood the log", async () => {
    const HOLDER_WITH_MANY = "0x1111111111111111111111111111111111111111";
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 503 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await getNftsForOwner(HOLDER_WITH_MANY, MIBERA_CONTRACT);

    expect(result.nfts).toHaveLength(12);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("12 failed");
    warn.mockRestore();
  });

  it("collapses newlines from upstream error text so a hostile origin cannot forge log lines", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("boom\n[inventory-api] FORGED LINE");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getNftsForOwner(ORPHAN_HOLDER, MIBERA_CONTRACT);

    const detail = String(warn.mock.calls[0][1]);
    expect(detail).not.toContain("\n");
    expect(detail).toContain("FORGED LINE");
    warn.mockRestore();
  });
});

/**
 * Mibera-main is the world's NAMESAKE collection (`/mibera/{id}`, no slug). The
 * other five registered sovereign collections carry a slug (`/mibera/mst/{id}`).
 *
 * Before this change the slug collections never reached metadata resolution at
 * all: `getNftsForOwner` read collection identity from the codex fixture, whose
 * `collection` block describes only Mibera-main, so MST/candies/tarot/gif/fractures
 * owner-lists threw a 400 despite the registry marking them `enabled: true`.
 */
describe("getNftsForOwner — sovereign slug collections (MST)", () => {
  const HOLDER = "0x1111111111111111111111111111111111111111";
  const mstDoc = JSON.parse(
    readFileSync(path.join(PKG_ROOT, "fixtures/mst-token-234.json"), "utf-8")
  );

  beforeEach(() => {
    process.env.SONAR_GRAPHQL_ENDPOINT = "https://belt-gateway.test/v1/graphql";
  });
  afterEach(() => {
    delete process.env.SONAR_GRAPHQL_ENDPOINT;
    vi.unstubAllGlobals();
  });

  it("resolves MST metadata from the slug route and registry-sourced identity", async () => {
    const metadataUrls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      if (init?.body) {
        // Belt-gateway GraphQL: this holder owns MST #234.
        return { ok: true, json: async () => ({ data: { Token: [{ tokenId: "234" }] } }) };
      }
      metadataUrls.push(String(url));
      return new Response(JSON.stringify(mstDoc), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await getNftsForOwner(HOLDER, MST_CONTRACT);

    expect(metadataUrls).toEqual(["https://metadata.0xhoneyjar.xyz/mibera/mst/234"]);
    expect(result.name).toBe("Mibera Shadow");
    expect(result.symbol).toBe("MST");
    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].name).toBe("MST #234");
    expect(result.nfts[0].imageUrl).toBe(mstDoc.image);
    // MST art is .webp — contentType must follow the image, not a hardcoded png.
    expect(result.nfts[0].contentType).toBe("image/webp");
  });
});

describe("getNftsForOwner — metadata fan-out is bounded", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never exceeds METADATA_FETCH_CONCURRENCY in-flight fetches for a full page", async () => {
    const HOLDER_WITH_MANY = "0x1111111111111111111111111111111111111111";
    const TOKENS_OWNED = 12;
    let inFlight = 0;
    let peak = 0;

    vi.stubGlobal("fetch", async (url: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return sovereignCdnResponse(String(url)) ?? new Response("", { status: 404 });
    });

    const result = await getNftsForOwner(HOLDER_WITH_MANY, MIBERA_CONTRACT);

    expect(result.nfts).toHaveLength(TOKENS_OWNED);
    // Assert against the constant the SUT actually reads, not a literal — the bound is
    // documented as overridable "for tests/ops", so a hardcoded 8 makes this test fail
    // under a legitimate override while the production code is correct.
    expect(peak).toBe(Math.min(METADATA_FETCH_CONCURRENCY, TOKENS_OWNED));
  });
});
