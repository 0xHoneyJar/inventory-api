import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getProfilePicture } from "../src/inventory.js";
import { ValidationError } from "../src/errors.js";
import { PURUPURU_CONTRACT } from "../src/collection-registry.js";
import { sovereignMetadataUrl } from "../src/sovereign-metadata.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";
const PYTHIANS_MINT = "PytheniansMint3180Example1111111111111111111";

const pytheniansMetadataFixture = JSON.parse(
  readFileSync(path.join(PKG_ROOT, "fixtures/pythenians-metadata.json"), "utf-8")
);

describe("getProfilePicture — external communities (INV-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns pythenians sovereign image for SVM holder via collection_key alias", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toBe(sovereignMetadataUrl("pythenians", "pythians", PYTHIANS_MINT));
      return new Response(JSON.stringify(pytheniansMetadataFixture[PYTHIANS_MINT]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const pfp = await getProfilePicture(PYTHIANS_HOLDER, { contract: "pythians" });

    expect(pfp).toBe("https://ipfs.pythenians.xyz/nft/example3180.png");
  });

  it("returns null when pythenians metadata is absent (consumer fallback)", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));

    const pfp = await getProfilePicture(PYTHIANS_HOLDER, { contract: "pythenians" });

    expect(pfp).toBeNull();
  });

  it("returns null for purupuru holder with no indexed Base holdings yet", async () => {
    const pfp = await getProfilePicture(
      "0x1111111111111111111111111111111111111111",
      { contract: PURUPURU_CONTRACT }
    );

    expect(pfp).toBeNull();
  });

  it("rejects EVM address when resolving pythenians SVM collection", async () => {
    await expect(
      getProfilePicture("0x1111111111111111111111111111111111111111", {
        contract: "pythenians",
      })
    ).rejects.toThrow(ValidationError);
  });
});
