import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getProfilePicture } from "../src/inventory.js";
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
 * getProfilePicture — Azuki (INV-A). Proves the real live scenario end to
 * end: `GET /profile/0x3418fedc.../?contract=<azuki>` returns the real
 * token 4442 image, AND proves determinism (lowest held tokenId, not
 * "whatever the indexer returned first") when a wallet holds more than one.
 */
describe("getProfilePicture — Azuki (INV-A third-party proxy path)", () => {
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

  it("returns the real image URL for the real single-token holder (token 4442)", async () => {
    stubAzukiFetch({ tokenIds: ["4442"] });

    const pfp = await getProfilePicture(AZUKI_HOLDER, { contract: AZUKI_CONTRACT });

    expect(pfp).toBe(
      "https://ipfs.test/ipfs/QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/4442.png"
    );
  });

  it("picks the LOWEST held tokenId, not whichever the indexer returns first", async () => {
    // Indexer/fixture order deliberately NOT ascending — 9999 first, then 1.
    // The old `nfts[0]` behavior would have picked 9999 ("an accident of
    // indexer return order"); the fix must pick "1" regardless of order.
    stubAzukiFetch({ tokenIds: ["9999", "1", "4442"] });

    const pfp = await getProfilePicture(AZUKI_HOLDER, { contract: AZUKI_CONTRACT });

    expect(pfp).toBe("https://ipfs.test/ipfs/QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/1.png");
  });

  it("is stable across repeated calls regardless of the indexer's return order each time", async () => {
    stubAzukiFetch({ tokenIds: ["50", "3", "4442"] });
    const first = await getProfilePicture(AZUKI_HOLDER, { contract: AZUKI_CONTRACT });

    __clearTokenUriCacheForTests();
    stubAzukiFetch({ tokenIds: ["4442", "50", "3"] }); // same holdings, different order
    const second = await getProfilePicture(AZUKI_HOLDER, { contract: AZUKI_CONTRACT });

    expect(first).toBe(second);
    expect(first).toBe("https://ipfs.test/ipfs/QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg/3.png");
  });

  it("resolves ONLY the selected token's metadata, not the whole holding (still cheap)", async () => {
    stubAzukiFetch({ tokenIds: ["9999", "1", "4442"] });
    let gatewayFetches = 0;
    const wrapped = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("https://ipfs.test/ipfs/")) gatewayFetches += 1;
      return wrapped(url, init);
    });

    await getProfilePicture(AZUKI_HOLDER, { contract: AZUKI_CONTRACT });

    // pageSize: 1 -> exactly ONE token's metadata is resolved, never all 3.
    expect(gatewayFetches).toBe(1);
  });

  it("returns null for a wallet holding no Azuki", async () => {
    stubAzukiFetch({ tokenIds: [] });
    const pfp = await getProfilePicture(AZUKI_HOLDER, { contract: AZUKI_CONTRACT });
    expect(pfp).toBeNull();
  });
});
