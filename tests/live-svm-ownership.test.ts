import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNftsForOwner } from "../src/inventory.js";
import { liveSvmNftsForOwner } from "../src/live-sonar.js";
import { PYTHIANS_COLLECTION_MINT } from "../src/collection-registry.js";

/**
 * Hermetic live-mode tests for INV-2 — SVM `svm_collection_nft` ownership.
 */

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
const PYTHIANS_MINT = "PytheniansMint3180Example1111111111111111111";
const PYTHIANS_COLLECTION_KEY = "pythians";
const ENDPOINT = "https://belt-gateway.test/v1/graphql";

type GqlRequest = {
  query: string;
  variables?: { owner?: string; collectionKey?: string };
};

function makeSvmFetchStub(opts: {
  svmNfts?: { nft_mint: string; name: string | null }[];
  failSvmIndex?: boolean;
  capture?: (body: GqlRequest) => void;
}) {
  const { svmNfts = [], failSvmIndex = false, capture } = opts;
  return async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as GqlRequest;
    capture?.(body);
    if (body.query.includes("svm_collection_nft")) {
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
    vi.stubEnv("SONAR_GRAPHQL_ENDPOINT", ENDPOINT);
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("liveSvmNftsForOwner", () => {
    it("queries svm_collection_nft via GraphQL variables with verbatim base58 owner", async () => {
      let captured: GqlRequest | undefined;
      vi.stubGlobal(
        "fetch",
        makeSvmFetchStub({
          svmNfts: [{ nft_mint: PYTHIANS_MINT, name: "Pythenians #3180" }],
          capture: (body) => {
            captured = body;
          },
        })
      );

      const rows = await liveSvmNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);

      expect(rows).toEqual([{ nftMint: PYTHIANS_MINT, name: "Pythenians #3180" }]);
      expect(captured?.variables?.collectionKey).toBe(PYTHIANS_COLLECTION_KEY);
      expect(captured?.variables?.owner).toBe(PYTHIANS_HOLDER);
      expect(captured?.variables?.owner).not.toBe(PYTHIANS_HOLDER.toLowerCase());
      expect(captured?.query).toContain("$owner");
      expect(captured?.query).toContain("$collectionKey");
    });

    it("returns an empty array when the holder owns no SVM NFTs", async () => {
      vi.stubGlobal("fetch", makeSvmFetchStub({ svmNfts: [] }));
      const rows = await liveSvmNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);
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

      const col = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);

      expect(col.contractAddress).toBe(PYTHIANS_COLLECTION_MINT);
      expect(col.nfts).toHaveLength(2);
      expect(col.nfts.map((n) => n.tokenId)).toEqual([
        PYTHIANS_MINT,
        "PytheniansMint1563Example1111111111111111111",
      ]);
      expect(col.nfts[0].name).toBe("Pythenians #3180");
    });

    it("fail-soft: falls back to hermetic fixture when svm_collection_nft errors (non-production)", async () => {
      vi.stubGlobal("fetch", makeSvmFetchStub({ failSvmIndex: true }));

      const col = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);

      expect(col.nfts).toHaveLength(3);
      expect(col.nfts.map((n) => n.name)).toEqual([
        "Pythenians #3180",
        "Pythenians #1563",
        "Pythenians #3150",
      ]);
    });

    it("returns empty holdings in production when svm_collection_nft errors", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubGlobal("fetch", makeSvmFetchStub({ failSvmIndex: true }));

      const col = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);

      expect(col.nfts).toEqual([]);
    });

    it("fail-soft: falls back to fixture when the endpoint is unreachable (non-production)", async () => {
      const fetchMock = vi.fn(() => {
        throw new Error("network down");
      });
      vi.stubGlobal("fetch", fetchMock);

      const col = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);

      expect(fetchMock).toHaveBeenCalled();
      expect(col.nfts).toHaveLength(3);
    });

    it("returns empty holdings in production when the endpoint is unreachable", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const fetchMock = vi.fn(() => {
        throw new Error("network down");
      });
      vi.stubGlobal("fetch", fetchMock);

      const col = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_KEY);

      expect(fetchMock).toHaveBeenCalled();
      expect(col.nfts).toEqual([]);
    });
  });
});
