import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "../src/app.js";
import { getNftMetadata } from "../src/inventory.js";
import { fetchTokenUriMetadata, __clearTokenUriCacheForTests } from "../src/tokenuri-metadata.js";
import { AZUKI_CONTRACT } from "../src/collection-registry.js";

/**
 * SECURITY REGRESSION — an operator's RPC API key must NEVER reach an anonymous
 * caller through an error path.
 *
 * `RPC_URL_<chainId>` legitimately embeds a paid-provider key in its path
 * (Alchemy: /v2/<KEY>, Infura: /v3/<KEY>). This test sets a URL with a REAL
 * key-shaped secret and forces the RPC to fail, then asserts the secret appears
 * in NONE of the caller-facing surfaces: the thrown Error, the HTTP 500 body,
 * or the /collections projection. A test fed only a clean URL proves nothing —
 * the secret must be in the input for its absence in the output to mean
 * anything.
 *
 * Path proven end-to-end: ethCallTokenUri throws URL-free -> getNftMetadata's
 * containing catch -> toHyperError collapses uncoded errors to a generic 500.
 */
const SECRET = "SUPERSECRET_alchemy_key_do_not_leak";
const LEAKY_RPC_URL = `https://eth-mainnet.g.alchemy.com/v2/${SECRET}`;

describe("SECURITY: RPC API key must not leak to anonymous callers", () => {
  beforeEach(() => {
    process.env.RPC_URL_1 = LEAKY_RPC_URL;
    process.env.IPFS_GATEWAY_HOST = "ipfs.io";
    __clearTokenUriCacheForTests();
  });
  afterEach(() => {
    delete process.env.RPC_URL_1;
    delete process.env.IPFS_GATEWAY_HOST;
    __clearTokenUriCacheForTests();
    vi.unstubAllGlobals();
  });

  it("the thrown Error carries no fragment of the RPC URL or key — and neither does the server log", async () => {
    // Capture (not swallow) the server-side warn: the log is a SIBLING exposure
    // channel — a fetch/undici rejection echoes the full URL back, and if that
    // reached the log verbatim the key would be written to log aggregation.
    const warnLines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      warnLines.push(a.map(String).join(" "));
    });
    vi.stubGlobal("fetch", async () => {
      throw new Error(`connect ECONNREFUSED for ${LEAKY_RPC_URL}`);
    });

    let caught: unknown;
    try {
      await fetchTokenUriMetadata(AZUKI_CONTRACT, 1, "4442");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).not.toContain(SECRET);
    expect(msg).not.toContain("alchemy");
    expect(msg).not.toContain("/v2/");
    // It IS the generic chain-scoped message.
    expect(msg).toBe("RPC request failed for chain 1");

    // Server log carries the host for diagnosis but NOT the key or path.
    const log = warnLines.join("\n");
    expect(log).not.toContain(SECRET);
    expect(log).not.toContain("/v2/");
    expect(log).toContain("eth-mainnet.g.alchemy.com"); // host is fine
  });

  it("getNftMetadata's single-token path never rethrows the secret", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => {
      throw new Error(`fetch failed: ${LEAKY_RPC_URL}`);
    });

    let caught: unknown;
    try {
      await getNftMetadata(AZUKI_CONTRACT, "4442");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(SECRET);
    expect((caught as Error).message).not.toMatch(/alchemy|\/v2\//);
  });

  it("GET /nfts/:contract/:tokenId returns a 500 whose BODY contains no key (the live leak PoC)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Any RPC blip: the fetch rejects with a message that echoes the full URL.
    vi.stubGlobal("fetch", async () => {
      throw new Error(`getaddrinfo ENOTFOUND ${LEAKY_RPC_URL}`);
    });

    const res = await app.fetch(
      new Request(`http://local/nfts/${AZUKI_CONTRACT}/4442`)
    );
    expect(res.status).toBe(500);
    const raw = await res.text(); // the RAW body a client would see
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("alchemy");
    expect(raw).not.toContain("/v2/");
    // ...and it is the generic body, not the raw reason.
    const body = JSON.parse(raw);
    expect(body.error.message).toBe("internal error");
  });

  it("GET /collections never contains a key either (a projection sibling channel)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await app.fetch(new Request("http://local/collections"));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("alchemy");
    // The RPC URL is config, not registry data — it must never appear here.
    expect(raw).not.toContain("RPC_URL");
  });
});
