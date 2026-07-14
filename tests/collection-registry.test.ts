import { describe, it, expect } from "vitest";
import {
  resolveExternalCollection,
  resolveCollectionRouteParam,
  resolveMetadataStrategy,
  isRegisteredMiberaContract,
  listCollectionRegistry,
  effectiveRehostPolicy,
  assertRehostPolicyInvariant,
  MIBERA_CONTRACT,
  MST_CONTRACT,
  PYTHIANS_COLLECTION_MINT,
  PURUPURU_CONTRACT,
  AZUKI_CONTRACT,
  AZUKI_CHAIN_ID,
  AZUKI_COLLECTION_KEY,
  FRACTURED_ADDRESSES,
  type CollectionRegistryEntry,
} from "../src/collection-registry.js";
import { sovereignMetadataUrl } from "../src/sovereign-metadata.js";
import { toChecksumAddress } from "../src/address.js";

describe("collection-registry v2", () => {
  it("lists mibera sovereign and external rows", () => {
    const rows = listCollectionRegistry();
    expect(rows.some((r) => r.collectionKey === "mibera" && !r.external)).toBe(true);
    expect(rows.some((r) => r.collectionKey === "pythians" && r.external)).toBe(true);
    expect(rows.some((r) => r.collectionKey === "purupuru" && r.external)).toBe(true);
  });

  it("resolves mibera metadata strategy by checksum contract", () => {
    expect(resolveMetadataStrategy(toChecksumAddress(MIBERA_CONTRACT))).toEqual({
      kind: "sovereign-world",
    });
    expect(resolveMetadataStrategy(toChecksumAddress(MST_CONTRACT))).toEqual({
      kind: "sovereign",
      slug: "mst",
    });
    expect(resolveMetadataStrategy(toChecksumAddress(FRACTURED_ADDRESSES[3]))).toEqual({
      kind: "sovereign",
      slug: "fractures",
    });
  });

  it("registers all fracture contracts as mibera sovereign", () => {
    for (const addr of FRACTURED_ADDRESSES) {
      expect(isRegisteredMiberaContract(toChecksumAddress(addr))).toBe(true);
    }
  });

  it("resolves pythenians by collection mint, sonar key, and community slug", () => {
    expect(resolveCollectionRouteParam(PYTHIANS_COLLECTION_MINT)?.name).toBe("Pythenians");
    expect(resolveCollectionRouteParam("pythians")?.collectionKey).toBe("pythians");
    expect(resolveCollectionRouteParam("pythenians")?.chain).toBe("svm");
    expect(resolveExternalCollection("pythians")?.sonarCollectionKey).toBe("pythians");
  });

  it("resolves purupuru by checksum contract and alias", () => {
    expect(resolveCollectionRouteParam(PURUPURU_CONTRACT)?.chainId).toBe(8453);
    expect(resolveExternalCollection("purupuru")?.metadataSlug).toBe("genesis");
  });

  it("builds external-world sovereign metadata URLs", () => {
    expect(sovereignMetadataUrl("pythenians", "pythians", "SomeMint111")).toBe(
      "https://metadata.0xhoneyjar.xyz/pythenians/pythians/SomeMint111"
    );
    expect(sovereignMetadataUrl("purupuru", "genesis", "7")).toBe(
      "https://metadata.0xhoneyjar.xyz/purupuru/genesis/7"
    );
  });

  // ── INV-A: Azuki (first chain-1 row) + rehost_policy fail-safe ──────────

  it("registers Azuki as an external, chain-1, tokenuri-strategy row", () => {
    const entry = resolveCollectionRouteParam(AZUKI_CONTRACT);
    expect(entry).not.toBeNull();
    expect(entry!.chain).toBe("evm");
    expect(entry!.chainId).toBe(AZUKI_CHAIN_ID);
    expect(entry!.chainId).toBe(1);
    expect(entry!.collectionKey).toBe(AZUKI_COLLECTION_KEY);
    expect(entry!.collectionKey).toBe("azuki"); // sonar's tracked-erc721 key, origin/main
    expect(entry!.totalSupply).toBe(10_000);
    expect(entry!.external).toBe(true);
    expect(entry!.enabled).toBe(true);
    expect(entry!.metadataStrategy).toEqual({ kind: "tokenuri" });

    const external = resolveExternalCollection(AZUKI_CONTRACT);
    expect(external?.sonarCollectionKey).toBe("azuki");
    expect(external?.metadataStrategy).toEqual({ kind: "tokenuri" });
  });

  it("resolves Azuki by alias and lists it among external collections", () => {
    expect(resolveCollectionRouteParam("azuki")?.id).toBe(AZUKI_CONTRACT);
    const rows = listCollectionRegistry();
    expect(rows.some((r) => r.collectionKey === "azuki" && r.external)).toBe(true);
  });

  it("defaults Azuki's rehost_policy to proxy (no explicit flag set)", () => {
    const entry = resolveCollectionRouteParam(AZUKI_CONTRACT)!;
    expect(entry.rehost_policy).toBeUndefined();
    expect(effectiveRehostPolicy(entry)).toBe("proxy");
  });

  it("gives every mirror-hosted (sovereign/sovereign-world) row an EXPLICIT rehost_policy: mirror", () => {
    const rows = listCollectionRegistry();
    const mirrorHosted = rows.filter(
      (r) => r.metadataStrategy.kind === "sovereign" || r.metadataStrategy.kind === "sovereign-world"
    );
    expect(mirrorHosted.length).toBeGreaterThan(0);
    for (const row of mirrorHosted) {
      expect(row.rehost_policy).toBe("mirror");
      expect(effectiveRehostPolicy(row)).toBe("mirror");
    }
  });

  it("the real registry passes assertRehostPolicyInvariant (already proven at module load — re-asserted directly)", () => {
    expect(() => assertRehostPolicyInvariant(listCollectionRegistry())).not.toThrow();
  });

  it("FAIL-SAFE: refuses a mirror-hosted strategy without an explicit rehost_policy: mirror flag", () => {
    const unflagged: CollectionRegistryEntry = {
      id: "0x1234567890123456789012345678901234567890",
      chain: "evm",
      chainId: 1,
      collectionKey: "unflagged",
      worldSlug: "unflagged",
      metadataSlug: "unflagged",
      name: "Unflagged",
      symbol: "UNF",
      totalSupply: 1,
      aliases: ["unflagged"],
      metadataStrategy: { kind: "sovereign", slug: "unflagged" },
      external: true,
      enabled: true,
      // rehost_policy omitted -> defaults to "proxy" -> mechanically REFUSED,
      // exactly the fail-safe INV-A requires: a collection cannot enter the
      // mirror (our-CDN) path without a human explicitly setting the flag.
    };
    expect(() => assertRehostPolicyInvariant([unflagged])).toThrow(/explicit "mirror"/);

    // The SAME row, explicitly flagged, is accepted.
    const flagged: CollectionRegistryEntry = { ...unflagged, rehost_policy: "mirror" };
    expect(() => assertRehostPolicyInvariant([flagged])).not.toThrow();
  });

  // ── Pythenians: proxy, and honestly declared broken (operator ruling + live probe) ──

  it("Pythenians is rehost_policy: proxy — we do not own it, so it may NOT be mirrored", () => {
    const entry = resolveCollectionRouteParam("pythians")!;
    expect(effectiveRehostPolicy(entry)).toBe("proxy");
    expect(entry.rehost_policy).toBe("proxy");
  });

  // ── Pythenians: PYTH-2 sonar-image pass-through ──────────────────────────
  //
  // History: this row declared `{ kind: "unresolved" }` from INV-A
  // (2026-07-13) because sonar's svm_collection_nft published no
  // `uri`/`image` at the time to proxy to. PYTH-1 taught sonar to publish
  // the RESOLVED image URL directly (Helius DAS content.links.image) — this
  // row is now a real (pure pass-through, zero-fetch) SVM proxy arm.

  it("Pythenians resolves via sonar's own resolved image (PYTH-2) — not a fictional sovereign route", () => {
    const entry = resolveCollectionRouteParam("pythians")!;
    // It must NOT claim a mirror-hosted strategy it cannot satisfy: probed live
    // 2026-07-13, the sovereign host 404s on every pythenians path.
    expect(entry.metadataStrategy.kind).not.toBe("sovereign");
    expect(entry.metadataStrategy.kind).not.toBe("sovereign-world");
    expect(entry.metadataStrategy.kind).toBe("sonar-image");
    // Still routable + enabled.
    expect(entry.enabled).toBe(true);
    expect(entry.external).toBe(true);
  });

  it("Pythenians publishes its resolved-image host for the dashboard's image optimizer (PYTH-2)", () => {
    const entry = resolveCollectionRouteParam("pythians")!;
    expect(entry.imageHost).toEqual(["ipfs.pythenians.xyz"]);
  });

  it("FAIL-SAFE: sonar-image + proxy is a legal combination — assertRehostPolicyInvariant does not throw", () => {
    const row: CollectionRegistryEntry = {
      id: PYTHIANS_COLLECTION_MINT,
      chain: "svm",
      chainId: 101,
      collectionKey: "pythians",
      worldSlug: "pythenians",
      metadataSlug: "pythians",
      name: "Pythenians",
      symbol: "PTN",
      totalSupply: 3682,
      aliases: ["pythians"],
      metadataStrategy: { kind: "sonar-image" },
      external: true,
      enabled: true,
      rehost_policy: "proxy",
    };
    // sonar-image is not mirror-hosted, so the invariant's `mirrorHosted`
    // check does not apply — proxy stays legal.
    expect(() => assertRehostPolicyInvariant([row])).not.toThrow();
  });

  it("FAIL-SAFE: the invariant would REFUSE the old pythenians row (sovereign + proxy)", () => {
    // This is the row as it was before INV-A: it declared a mirror-hosted
    // sovereign strategy while (per the operator) we hold no rights to mirror
    // it. The invariant now makes that combination impossible to ship.
    const oldPythenians: CollectionRegistryEntry = {
      id: PYTHIANS_COLLECTION_MINT,
      chain: "svm",
      chainId: 101,
      collectionKey: "pythians",
      worldSlug: "pythenians",
      metadataSlug: "pythians",
      name: "Pythenians",
      symbol: "PTN",
      totalSupply: 3682,
      aliases: ["pythians"],
      metadataStrategy: { kind: "sovereign", slug: "pythians" },
      external: true,
      enabled: true,
      rehost_policy: "proxy", // the truthful policy...
    };
    // ...which is mechanically incompatible with the mirror-hosted strategy.
    expect(() => assertRehostPolicyInvariant([oldPythenians])).toThrow(/explicit "mirror"/);
  });

  it("FAIL-SAFE (symmetric): refuses rehost_policy: mirror on a row that does not actually mirror-host", () => {
    const lying: CollectionRegistryEntry = {
      id: "0x1234567890123456789012345678901234567890",
      chain: "evm",
      chainId: 1,
      collectionKey: "lying",
      worldSlug: "lying",
      metadataSlug: null,
      name: "Lying",
      symbol: "LIE",
      totalSupply: 1,
      aliases: ["lying"],
      metadataStrategy: { kind: "tokenuri" },
      external: true,
      enabled: true,
      rehost_policy: "mirror", // claims mirror rights while actually pointing at third-party art
    };
    expect(() => assertRehostPolicyInvariant([lying])).toThrow(/does not mirror-host/);
  });
});
