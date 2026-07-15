import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNftsForOwner, getProfilePicture } from "../src/inventory.js";
import { MAD_LADS_COLLECTION_MINT } from "../src/collection-registry.js";

// Fixed production identities captured from svm_collection_nft on 2026-07-14.
const MINT = "JEGruwYE13mhX2wi2MGrPmeLiVyZtbBptmVy9vG3pXRC";
const OWNER = "CxBhuJwhVgNMc7yjnRx3XFAsTnnbYDc2bhAGSaLBjNqZ";
const NAME = "Mad Lads #6867";
const IMAGE = "https://metadata.example.invalid/mad-lads/6867.png";
const URI = "https://metadata.example.invalid/mad-lads/6867.json";

describe("Mad Lads ownership-gated sonar-image proxy", () => {
  beforeEach(() => {
    vi.stubEnv("SONAR_GRAPHQL_ENDPOINT", "https://belt-gateway.test/v1/graphql");
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("passes through metadata only from the owner-scoped Sonar result", async () => {
    let request: { query: string; variables: Record<string, string> } | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      request = JSON.parse(init.body);
      return { ok: true, json: async () => ({ data: { svm_collection_nft: [{ nft_mint: MINT, name: NAME, image: IMAGE, uri: URI }] } }) };
    });
    const collection = await getNftsForOwner(OWNER, MAD_LADS_COLLECTION_MINT);
    expect(request?.variables).toEqual({ owner: OWNER, collectionKey: "mad_lads" });
    expect(collection.nfts).toEqual([expect.objectContaining({ tokenId: MINT, name: NAME, imageUrl: IMAGE, metadataUri: URI })]);
    expect(await getProfilePicture(OWNER, { contract: "mad-lads" })).toBe(IMAGE);
  });

  it("does not fetch metadata or fabricate art when Sonar has not been backfilled", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return { ok: true, json: async () => ({ data: { svm_collection_nft: [{ nft_mint: MINT, name: NAME, image: null, uri: null }] } }) };
    });
    const collection = await getNftsForOwner(OWNER, "mad_lads");
    expect(collection.nfts[0]?.imageUrl).toBe("");
    expect(calls).toBe(1);
  });
});
