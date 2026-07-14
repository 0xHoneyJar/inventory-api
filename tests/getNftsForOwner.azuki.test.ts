import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNftsForOwner } from "../src/inventory.js";
import { __clearTokenUriCacheForTests } from "../src/tokenuri-metadata.js";
import {
  AZUKI_CONTRACT,
  AZUKI_HOLDER,
  AZUKI_TEST_SONAR_ENDPOINT,
  installAzukiEnv,
  uninstallAzukiEnv,
  stubAzukiFetch,
} from "./support/azuki-fixture-stub.js";

/**
 * End-to-end owner-list resolution for Azuki (INV-A) — sonar's live Token
 * index (per-owner tokenIds) joined with the tokenuri (proxy) metadata
 * resolver, hermetically via a fetch stub. Sonar already indexes Azuki
 * ownership today (ground-verified live 2026-07-13: chain-1 TrackedHolder =
 * 4,407; Token(owner: 0x3418fedc...) -> tokenId 4442) — this proves the
 * JOIN, offline.
 */
describe("getNftsForOwner — Azuki (INV-A third-party proxy path)", () => {
  beforeEach(() => {
    process.env.SONAR_GRAPHQL_ENDPOINT = AZUKI_TEST_SONAR_ENDPOINT;
    installAzukiEnv();
    __clearTokenUriCacheForTests();
  });
  afterEach(() => {
    delete process.env.SONAR_GRAPHQL_ENDPOINT;
    uninstallAzukiEnv();
    __clearTokenUriCacheForTests();
    vi.unstubAllGlobals();
  });

  it("resolves the real held token (4442) with its real image via the tokenURI proxy path", async () => {
    stubAzukiFetch({ tokenIds: ["4442"] });

    const result = await getNftsForOwner(AZUKI_HOLDER, AZUKI_CONTRACT);

    expect(result.name).toBe("Azuki");
    expect(result.symbol).toBe("AZUKI");
    expect(result.contractAddress).toBe(AZUKI_CONTRACT);
    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].tokenId).toBe("4442");
    expect(result.nfts[0].name).toBe("Azuki #4442");
    expect(result.nfts[0].imageUrl).toMatch(/QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg\/4442\.png$/);
    expect(result.nfts[0].contentType).toBe("image/png");
  });

  it("resolves multiple held tokens with ONE RPC call total (baseURI cached across the page)", async () => {
    stubAzukiFetch({ tokenIds: ["1", "4442", "9999"] });
    let rpcCalls = 0;
    const wrapped = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes("eth_call")) rpcCalls += 1;
      return wrapped(url, init);
    });

    const result = await getNftsForOwner(AZUKI_HOLDER, AZUKI_CONTRACT);

    expect(result.nfts.map((n) => n.tokenId).sort()).toEqual(["1", "4442", "9999"]);
    expect(rpcCalls).toBe(1);
  });

  it("resolves by the azuki alias, not just the checksummed contract", async () => {
    stubAzukiFetch({ tokenIds: ["4442"] });
    const result = await getNftsForOwner(AZUKI_HOLDER, "azuki");
    expect(result.contractAddress).toBe(AZUKI_CONTRACT);
    expect(result.nfts[0].tokenId).toBe("4442");
  });

  it("fail-softs to an imageless NFT (and warns) when the metadata gateway is unreachable", async () => {
    process.env.SONAR_GRAPHQL_ENDPOINT = AZUKI_TEST_SONAR_ENDPOINT;
    vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (typeof url === "string" && url === AZUKI_TEST_SONAR_ENDPOINT) {
        const { query: gql } = JSON.parse(body) as { query: string };
        const data: Record<string, unknown> = {};
        if (gql.includes("Token(")) data.Token = [{ tokenId: "4442" }];
        return new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // RPC + gateway both unreachable.
      throw new Error("network down");
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await getNftsForOwner(AZUKI_HOLDER, AZUKI_CONTRACT);

    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].tokenId).toBe("4442");
    expect(result.nfts[0].imageUrl).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("tokenuri metadata");
    expect(String(warn.mock.calls[0][0])).toContain("1 failed");
    warn.mockRestore();
  });
});
