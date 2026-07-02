import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getNftsForOwner } from "../src/inventory.js";
import { ValidationError } from "../src/errors.js";
import {
  PYTHIANS_COLLECTION_MINT,
  PURUPURU_CONTRACT,
} from "../src/collection-registry.js";
import { sovereignMetadataUrl } from "../src/sovereign-metadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
const PYTHIANS_MINT = "PytheniansMint3180Example1111111111111111111";

const pytheniansMetadataFixture = JSON.parse(
  readFileSync(path.join(PKG_ROOT, "fixtures/pythenians-metadata.json"), "utf-8")
);

describe("getNftsForOwner — external collections (issue #19)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves pythenians by collection_key alias pythians", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe(
        sovereignMetadataUrl("pythenians", "pythians", PYTHIANS_MINT)
      );
      return new Response(JSON.stringify(pytheniansMetadataFixture[PYTHIANS_MINT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await getNftsForOwner(PYTHIANS_HOLDER, "pythians", { pageSize: 1 });

    expect(result.name).toBe("Pythenians");
    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].tokenId).toBe(PYTHIANS_MINT);
    expect(result.nfts[0].imageUrl).toBe("https://ipfs.pythenians.xyz/nft/example3180.png");
    expect(result.contractAddress).toBe(PYTHIANS_COLLECTION_MINT);
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

  it("fail-softs metadata to blank image when sovereign route 404s", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));

    const result = await getNftsForOwner(PYTHIANS_HOLDER, "pythians", { pageSize: 1 });
    expect(result.nfts[0].imageUrl).toBe("");
    expect(result.nfts[0].name).toBe("Pythenians #3180");
  });
});
