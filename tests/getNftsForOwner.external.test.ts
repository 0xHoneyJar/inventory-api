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

  // REWRITTEN (INV-A, 2026-07-13) — this test asserted a fiction.
  //
  // It stubbed `fetch` to answer the sovereign URL with
  // `fixtures/pythenians-metadata.json`, then asserted the image FROM THAT SAME
  // FIXTURE. A closed loop: it could only ever pass, and it proved nothing about
  // the real seam. The real seam is empty — the sovereign host 404s on every
  // pythenians path (probed live). Pythenians art was never ingested, so this
  // green test sat on top of every holder rendering a grey box.
  //
  // The row is now declared `{ kind: "unresolved" }`: we hold no rights to
  // mirror it, and there is nothing to proxy to (sonar's svm_collection_nft
  // publishes no `uri`). Real ids + real names, no art, said out loud.
  it("pythenians resolves to real ids + real NAMES with no art, and makes NO network call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`unresolved row must make no network call, attempted: ${String(url)}`);
    });

    const result = await getNftsForOwner(PYTHIANS_HOLDER, "pythians", { pageSize: 1 });

    expect(result.name).toBe("Pythenians");
    expect(result.contractAddress).toBe(PYTHIANS_COLLECTION_MINT);
    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].tokenId).toBe(PYTHIANS_MINT);
    // The name IS real — sonar publishes it (svm_collection_nft.name).
    expect(result.nfts[0].name).toBe("Pythenians #3180");
    // The art is not, and we say so rather than inventing it.
    expect(result.nfts[0].imageUrl).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("metadata unresolved");
    warn.mockRestore();
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

  it("an unresolved row still returns the DEFAULT contentType, not a guess from an empty string", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await getNftsForOwner(PYTHIANS_HOLDER, "pythians", { pageSize: 1 });
    expect(result.nfts[0].imageUrl).toBe("");
    expect(result.nfts[0].contentType).toBe("image/png");
    warn.mockRestore();
  });

  // MOVED (INV-A, 2026-07-13): two tests here proved the external path DERIVES
  // contentType from the image extension (.webp -> image/webp) rather than
  // hardcoding image/png. They used pythenians as their vehicle — but pythenians
  // is now a declared-`unresolved` row that resolves NO image, so it can no
  // longer carry that assertion (and purupuru, the only other sovereign external
  // row, has no indexed holdings to resolve).
  //
  // That coverage did not disappear: it moved to the external row that DOES
  // resolve real art — Azuki, on the tokenuri/proxy path — in
  // tests/getNftsForOwner.azuki.test.ts ("derives contentType from the image
  // extension", .png + .webp). The underlying helper is also unit-tested in
  // tests/transform.test.ts (contentTypeForImageUrl).
});
