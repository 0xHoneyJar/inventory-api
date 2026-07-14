import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNftsForOwner, getProfilePicture } from "../src/inventory.js";
import { PYTHIANS_COLLECTION_MINT } from "../src/collection-registry.js";

/**
 * PYTH-2 — real-fixture proof that the `sonar-image` strategy is a genuine
 * pass-through of sonar's RESOLVED image URL, not a fixture asserted against
 * itself.
 *
 * The mint / owner / name / image values below are copied VERBATIM from a
 * real production Helius DAS response captured this cycle
 * (SHARED-pyth-das-fixture.json, items[0] — `id`, `ownership.owner`,
 * `content.metadata.name`, `content.links.image`) — not invented. This is
 * exactly the shape PYTH-1 taught sonar's `svm_collection_nft` to publish as
 * `nft_mint` / `owner` / `name` / `image`. inventory-api never talks to
 * Helius or IPFS itself — it only ever sees what sonar's GraphQL query
 * returns, which is why these tests stub `liveSvmNftsForOwner`'s HTTP
 * transport (fetch) rather than DAS.
 *
 * IMPORTANT: this suite is written to FAIL against the registry's OLD
 * `{ kind: "unresolved" }` Pythenians row. That arm short-circuits before
 * ever reading a `svm_collection_nft.image` field — it always returns
 * `imageUrl: ""` regardless of what a stubbed sonar hands back. A green run
 * here is proof the `sonar-image` seam in src/inventory.ts is actually wired
 * end-to-end (registry -> getExternalNftsForOwner -> NFT.imageUrl), not a
 * fixture-consistency tautology. (Verified by hand this cycle: reverting
 * collection-registry.ts's Pythenians row to `{ kind: "unresolved" }` turns
 * every `imageUrl` assertion below red — see PYTH-2 handoff notes.)
 */

const REAL_MINT = "JE8siizFxfGFRAgifYivW9pwJH7ninQMWYJZBpuz2wiK";
const REAL_OWNER = "a8Ge9XL3ji1tHjBZz2WDCXT4jYx49Zmbmic4eZH9iZG";
const REAL_NAME = "Pythenians #2559";
const REAL_IMAGE =
  "https://ipfs.pythenians.xyz/nft/607b3aca9b41aaf6d1cae53e7960658928cb7240.png";
const REAL_URI = "https://ipfs.pythenians.xyz/metadata/2559.json";
const ENDPOINT = "https://belt-gateway.test/v1/graphql";

interface SvmRow {
  nft_mint: string;
  name: string | null;
  image: string | null;
  uri: string | null;
}

function makeSvmFetchStub(rows: SvmRow[]) {
  return async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { query: string };
    if (body.query.includes("svm_collection_nft")) {
      return { ok: true, json: async () => ({ data: { svm_collection_nft: rows } }) };
    }
    return { ok: true, json: async () => ({ data: {} }) };
  };
}

describe("Pythenians sonar-image pass-through (PYTH-2, real DAS fixture data)", () => {
  beforeEach(() => {
    vi.stubEnv("SONAR_GRAPHQL_ENDPOINT", ENDPOINT);
    vi.stubEnv("NODE_ENV", "test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("getNftsForOwner returns sonar's resolved image VERBATIM, host ipfs.pythenians.xyz", async () => {
    vi.stubGlobal(
      "fetch",
      makeSvmFetchStub([{ nft_mint: REAL_MINT, name: REAL_NAME, image: REAL_IMAGE, uri: REAL_URI }])
    );

    const col = await getNftsForOwner(REAL_OWNER, PYTHIANS_COLLECTION_MINT);

    expect(col.nfts).toHaveLength(1);
    expect(col.nfts[0].tokenId).toBe(REAL_MINT);
    expect(col.nfts[0].name).toBe(REAL_NAME);
    expect(col.nfts[0].imageUrl).toBe(REAL_IMAGE);
    expect(new URL(col.nfts[0].imageUrl).host).toBe("ipfs.pythenians.xyz");
  });

  it("getProfilePicture returns the same sonar-resolved image URL", async () => {
    vi.stubGlobal(
      "fetch",
      makeSvmFetchStub([{ nft_mint: REAL_MINT, name: REAL_NAME, image: REAL_IMAGE, uri: null }])
    );

    const pfp = await getProfilePicture(REAL_OWNER, { contract: PYTHIANS_COLLECTION_MINT });

    expect(pfp).toBe(REAL_IMAGE);
    expect(pfp).not.toBeNull();
    expect(new URL(pfp!).host).toBe("ipfs.pythenians.xyz");
  });

  it("null image (sonar has none for this mint yet) fails soft to imageless — never invents art", async () => {
    vi.stubGlobal(
      "fetch",
      makeSvmFetchStub([{ nft_mint: REAL_MINT, name: REAL_NAME, image: null, uri: null }])
    );

    const col = await getNftsForOwner(REAL_OWNER, PYTHIANS_COLLECTION_MINT);

    expect(col.nfts[0].imageUrl).toBe("");
    expect(col.nfts[0].name).toBe(REAL_NAME); // the name is still real, per the passthrough contract
  });

  it("makes NO network call beyond the single sonar GraphQL query — no RPC, no IPFS, no Metaplex read", async () => {
    let fetchCalls = 0;
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      fetchCalls += 1;
      const body = JSON.parse(init.body) as { query: string };
      if (!body.query.includes("svm_collection_nft")) {
        throw new Error(`unexpected non-sonar fetch: ${String(url)}`);
      }
      return {
        ok: true,
        json: async () => ({
          data: { svm_collection_nft: [{ nft_mint: REAL_MINT, name: REAL_NAME, image: REAL_IMAGE, uri: REAL_URI }] },
        }),
      };
    });

    await getNftsForOwner(REAL_OWNER, PYTHIANS_COLLECTION_MINT);

    expect(fetchCalls).toBe(1);
  });
});
