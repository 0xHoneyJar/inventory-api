import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getNftsForOwner } from "../src/inventory.js";
import {
  earnedBadgeToNFT,
  isBadgeFederationConfigured,
  spineUserIdToIdentityId,
  type EarnedBadgeWire,
} from "../src/activities-badges.js";
import {
  listPublicCollections,
  resolveCollectionRouteParam,
  MIBERA_BADGES_COLLECTION_ID,
} from "../src/collection-registry.js";
import { KINDLING_BADGE_FAMILY } from "../src/badge-families.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const SPINE_UUID = "550e8400-e29b-41d4-a716-446655440000";

const KINDLING_GRANT: EarnedBadgeWire = {
  badge_family_id: KINDLING_BADGE_FAMILY.id,
  activity_id: "act_firstlight",
  identity_id: "id_550e8400e29b41d4a716446655440000",
  source: "activity-completed",
  event_id: "evt_kindling_1",
  issued_at: "2026-07-01T00:00:00Z",
  uri: KINDLING_BADGE_FAMILY.uri,
  snapshot_id: null,
};

describe("badge holdings projection (br-badges-as-inventory-bzi.1)", () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env.ACTIVITIES_API_URL = "https://activities.test";
    process.env.ACTIVITIES_READ_TOKEN = "read-token";
    process.env.IDENTITY_API_URL = "https://identity.test";
    process.env.LINK_SERVICE_TOKEN = "link-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...prevEnv };
  });

  it("registers mibera-badges factory with badge-grant strategy (no contract)", () => {
    const entry = resolveCollectionRouteParam("mibera-badges");
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(MIBERA_BADGES_COLLECTION_ID);
    expect(entry!.metadataStrategy).toEqual({ kind: "badge-grant" });
    expect(entry!.evmContracts).toBeUndefined();
    expect(listPublicCollections().some((c) => c.id === MIBERA_BADGES_COLLECTION_ID)).toBe(
      true,
    );
  });

  it("maps spine UUID → activities identity id", () => {
    expect(spineUserIdToIdentityId(SPINE_UUID)).toBe(
      "id_550e8400e29b41d4a716446655440000",
    );
    expect(spineUserIdToIdentityId("id_abc123")).toBe("id_abc123");
    expect(spineUserIdToIdentityId("not-a-uuid")).toBeNull();
  });

  it("projects grant → Alchemy/SimpleHash-class NFT with fidelity=granted", () => {
    const nft = earnedBadgeToNFT(KINDLING_GRANT);
    expect(nft.tokenId).toBe("kindling");
    expect(nft.name).toBe("Kindling");
    expect(nft.imageUrl).toBe(KINDLING_BADGE_FAMILY.uri);
    expect(nft.attributes).toEqual(
      expect.arrayContaining([
        { trait_type: "kind", value: "badge" },
        { trait_type: "fidelity", value: "granted" },
        { trait_type: "badge_family_id", value: "kindling" },
        { trait_type: "issued_at", value: "2026-07-01T00:00:00Z" },
      ]),
    );
  });

  it("hermetic: unconfigured federation returns empty owner-list (no fetch)", async () => {
    delete process.env.ACTIVITIES_READ_TOKEN;
    delete process.env.IDENTITY_API_URL;
    expect(isBadgeFederationConfigured()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await getNftsForOwner(WALLET, "mibera-badges");
    expect(result.contractAddress).toBe(MIBERA_BADGES_COLLECTION_ID);
    expect(result.name).toBe("Mibera Badges");
    expect(result.nfts).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live federation: Kindling grantee appears on mibera-badges owner-list", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/resolve/wallet/")) {
        return new Response(JSON.stringify({ user_id: SPINE_UUID }), { status: 200 });
      }
      if (url.includes("/v1/identities/") && url.endsWith("/badges")) {
        return new Response(JSON.stringify({ items: [KINDLING_GRANT], next_cursor: null }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await getNftsForOwner(WALLET, MIBERA_BADGES_COLLECTION_ID);
    expect(result.nfts).toHaveLength(1);
    expect(result.nfts[0].tokenId).toBe("kindling");
    expect(result.nfts[0].imageUrl).toBe(KINDLING_BADGE_FAMILY.uri);
    expect(
      result.nfts[0].attributes.find((a) => a.trait_type === "fidelity")?.value,
    ).toBe("granted");
  });

  it("fail-soft: identity 404 → empty badges (no throw)", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/resolve/wallet/")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(getNftsForOwner(WALLET, "mibera-badges")).resolves.toMatchObject({
      nfts: [],
    });
  });
});
