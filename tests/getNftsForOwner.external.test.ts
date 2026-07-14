import { describe, it, expect, vi, afterEach } from "vitest";
import { getNftsForOwner } from "../src/inventory.js";
import { ValidationError } from "../src/errors.js";
import {
  PYTHIANS_COLLECTION_MINT,
  PURUPURU_CONTRACT,
} from "../src/collection-registry.js";

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
const PYTHIANS_MINT = "PytheniansMint3180Example1111111111111111111";

// NOTE (INV-A): `fixtures/pythenians-metadata.json` is no longer loaded here.
// That fixture WAS the fiction — tests stubbed `fetch` to answer the sovereign
// URL with it, then asserted the image from that same file. The real sovereign
// host serves nothing for pythenians (404, probed live 2026-07-13). The fixture
// is left on disk (harmless, and it documents what the art WOULD look like) but
// nothing may assert against it as if it were served.

describe("getNftsForOwner — external collections (issue #19)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // REWRITTEN again (PYTH-2, 2026-07-13) — the row is no longer `unresolved`.
  //
  // History: INV-A declared this row `{ kind: "unresolved" }` because sonar's
  // svm_collection_nft published no `uri`/`image` to proxy to. PYTH-1 closed
  // that gap (sonar now publishes the resolved `image`), so PYTH-2 flipped
  // this row to `{ kind: "sonar-image" }` — a pure pass-through, zero fetch.
  // The bundled hermetic fixture below has no real DAS data for these mints
  // (fake "...Example..." mint addresses), so `image` is `null` for all
  // three — same imageless outcome as before, but now via the working
  // pass-through arm reading a genuinely-absent value, not the declared-
  // broken arm. See tests/pythenians-sonar-image.test.ts for the REAL-image
  // proof (real DAS fixture data, live-mode fetch stub).
  it("pythenians (hermetic fixture has no image data) resolves to real ids + real NAMES with no art, and makes NO network call", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`sonar-image strategy must make no network call, attempted: ${String(url)}`);
    });

    const result = await getNftsForOwner(PYTHIANS_HOLDER, "pythians", { pageSize: 1 });

    expect(result.name).toBe("Pythenians");
    expect(result.contractAddress).toBe(PYTHIANS_COLLECTION_MINT);
    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].tokenId).toBe(PYTHIANS_MINT);
    // The name IS real — sonar publishes it (svm_collection_nft.name).
    expect(result.nfts[0].name).toBe("Pythenians #3180");
    // The bundled fixture has no `image` for this mint -> fail-soft imageless,
    // same floor as every other arm. No warn: this is a working strategy that
    // legitimately has nothing to show for THIS mint, not a declared defect.
    expect(result.nfts[0].imageUrl).toBe("");
  });

  it("returns all pythenians for conviction-board holder in hermetic mode", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ name: "x", description: "", image: "", attributes: [] }), {
        status: 404,
      })
    );

    const result = await getNftsForOwner(PYTHIANS_HOLDER, PYTHIANS_COLLECTION_MINT);
    expect(result.nfts).toHaveLength(3);
    expect(result.nfts.map((n) => n.name)).toEqual([
      "Pythenians #3180",
      "Pythenians #1563",
      "Pythenians #3150",
    ]);
  });

  it("rejects invalid Solana owner address", async () => {
    await expect(getNftsForOwner("not-a-solana-wallet", "pythians")).rejects.toThrow(
      ValidationError
    );
  });

  it("registers purupuru by contract address", async () => {
    const result = await getNftsForOwner(
      "0x1111111111111111111111111111111111111111",
      PURUPURU_CONTRACT
    );
    expect(result.name).toBe("Purupuru");
    expect(result.symbol).toBe("PURU");
    expect(result.nfts).toEqual([]);
  });

  it("a sonar-image row with no published image still returns the DEFAULT contentType, not a guess from an empty string", async () => {
    const result = await getNftsForOwner(PYTHIANS_HOLDER, "pythians", { pageSize: 1 });
    expect(result.nfts[0].imageUrl).toBe("");
    expect(result.nfts[0].contentType).toBe("image/png");
  });

  // MOVED (INV-A, 2026-07-13): two tests here proved the external path DERIVES
  // contentType from the image extension (.webp -> image/webp) rather than
  // hardcoding image/png. They used pythenians as their vehicle — but pythenians
  // (at the time) was a declared-`unresolved` row that resolved NO image, so it
  // could not carry that assertion (and purupuru, the only other sovereign
  // external row, has no indexed holdings to resolve). PYTH-2 later gave
  // pythenians a real image path (sonar-image), but this coverage stayed put
  // on Azuki rather than moving back — no need to re-churn it.
  //
  // That coverage did not disappear: it moved to the external row that DOES
  // resolve real art — Azuki, on the tokenuri/proxy path — in
  // tests/getNftsForOwner.azuki.test.ts ("derives contentType from the image
  // extension", .png + .webp). The underlying helper is also unit-tested in
  // tests/transform.test.ts (contentTypeForImageUrl).
});
