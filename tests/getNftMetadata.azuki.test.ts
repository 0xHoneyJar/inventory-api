import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNftMetadata } from "../src/inventory.js";
import { __clearTokenUriCacheForTests } from "../src/tokenuri-metadata.js";
import {
  AZUKI_CONTRACT,
  AZUKI_4442_METADATA,
  installAzukiEnv,
  uninstallAzukiEnv,
  stubAzukiFetch,
} from "./support/azuki-fixture-stub.js";

describe("getNftMetadata — Azuki single-token proxy path (INV-A)", () => {
  beforeEach(() => {
    installAzukiEnv();
    __clearTokenUriCacheForTests();
  });
  afterEach(() => {
    uninstallAzukiEnv();
    __clearTokenUriCacheForTests();
    vi.unstubAllGlobals();
  });

  it("resolves single-token metadata via tokenURI + IPFS gateway, not the sovereign CDN", async () => {
    stubAzukiFetch();

    const doc = await getNftMetadata(AZUKI_CONTRACT, "4442");

    expect(doc.name).toBe(AZUKI_4442_METADATA.name);
    expect(doc.image).toBe(
      "https://ipfs.test/ipfs/QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/4442.png"
    );
    expect(doc.attributes).toHaveLength(AZUKI_4442_METADATA.attributes.length);
  });

  it("rejects a non-numeric tokenId", async () => {
    await expect(getNftMetadata(AZUKI_CONTRACT, "not-a-number")).rejects.toMatchObject({
      code: "INVENTORY_INVALID_INPUT",
    });
  });
});
