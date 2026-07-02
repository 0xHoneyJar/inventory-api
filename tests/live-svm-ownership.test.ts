import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNftsForOwner } from "../src/inventory.js";
import { liveSvmNftsForOwner } from "../src/live-sonar.js";
import { PYTHIANS_COLLECTION_MINT } from "../src/collection-registry.js";

/**
 * Hermetic live-mode tests for INV-2 — SVM `svm_collection_nft` ownership.
 *
 * The belt-gateway entity may not be deployed in production yet; we flip
 * SONAR_GRAPHQL_ENDPOINT and stub fetch with the documented schema shape.
 */

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
const PYTHIANS_MINT = "PytheniansMint3180Example1111111111111111111";
const ENDPOINT = "https://belt-gateway.test/v1/graphql";

function makeSvmFetchStub(opts: {
  svmNfts?: { nft_mint: string; name: string | null }[];
  failSvmIndex?: boolean;
  capture?: (gql: string) => void;
}) {
  const { svmNfts = [], failSvmIndex = false, capture } = opts;
  return async (_url: string, init: { body: string }) => {
    const { query: gql } = JSON.parse(init.body) as { query: string };
    capture?.(gql);
    if (gql.includes("svm_collection_nft")) {
      if (failSvmIndex) {
        return {
          ok: true,
          json: async () => ({ errors: [{ message: "svm_collection_nft unavailable" }] }),
        };
      }
      return {
        ok: true,
        json: async () => ({ data: { svm_collection_nft: svmNfts } }),
      };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
}

describe("live SVM ownership (INV-2, hermetic via fetch stub)", () => {
  beforeEach(() => {
    process.env.SONAR_GRAPHQL_ENDPOINT = ENDPOINT;
  });
  afterEach(() => {
    delete process.env.SONAR_GRAPHQL_ENDPOINT;
    vi.unstubAllGlobals();
  });

  describe("liveSvmNftsForOwner", () => {
    it("queries svm_collection_nft by collection_key with verbatim base58 owner", async () => {
      let captured = "";
      vi.stubGlobal(
        "fetch",
        makeSvmFetchStub({
          svmNfts: [{ nft_mint: PYTHIANS_MINT, name: "Pythenians #3180" }],
          capture: (gql) => {
            if (gql.includes("svm_collection_nft")) captured = gql;
          },
        })
      );

      const rows = await liveSvmNftsForOwner(PYTHIANS_HOLDER, "pythians");

      expect(rows).toEqual([{ nftMint: PYTHIANS_MINT, name: "Pythenians #3180" }]);
      expect(captured).toContain("collection_key");
      expect(captured).toContain('"pythians"');
      expect(captured).toContain(PYTHIANS_HOLDER);
      expect(captured).not.toContain(PYTHIANS_HOLDER.toLowerCase());
    });

    it("returns an empty array when the holder owns no SVM NFTs", async () => {
      vi.stubGlobal("fetch", makeSvmFetchStub({ svmNfts: [] }));
      const rows = await liveSvmNftsForOwner(PYTHIANS_HOLDER, "pythians");
      expect(rows).toEqual([]);
    });
  });

  describe("getNftsForOwner (live external SVM)", () => {
    it("joins pythenians holdings from the live svm_collection_nft index", async () => {
      vi.stubGlobal(
        "fetch",
        makeSvmFetchStub({
          svmNfts: [
            { nft_mint: PYTHIANS_MINT, name: "Pythenians #3180" },
            { nft_mint: "PytheniansMint1563Example1111111111111111111", name: "Pythenians #1563" },
          ],
        })
      );

      const col = await getNftsForOwner(PYTHIANS_HOLDER, "pythians");

      expect(col.contractAddress).toBe(PYTHIANS_COLLECTION_MINT);
      expect(col.nfts).toHaveLength(2);
      expect(col.nfts.map((n) => n.tokenId)).toEqual([
        PYTHIANS_MINT,
        "PytheniansMint1563Example1111111111111111111",
      ]);
      expect(col.nfts[0].name).toBe("Pythenians #3180");
    });

    it("fail-soft: falls back to hermetic fixture when svm_collection_nft errors", async () => {
      vi.stubGlobal("fetch", makeSvmFetchStub({ failSvmIndex: true }));

      const col = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_MINT);

      expect(col.nfts).toHaveLength(3);
      expect(col.nfts.map((n) => n.name)).toEqual([
        "Pythenians #3180",
        "Pythenians #1563",
        "Pythenians #3150",
      ]);
    });

    it("fail-soft: falls back to fixture when the endpoint is unreachable", async () => {
      vi.stubGlobal("fetch", () => {
        throw new Error("network down");
      });

      const col = await getNftsForOwner(PYTHIANS_HOLDER, "pythenians");

      expect(col.nfts).toHaveLength(3);
    });
  });
});
