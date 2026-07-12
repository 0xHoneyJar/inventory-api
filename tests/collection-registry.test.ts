import { describe, it, expect } from "vitest";
import {
  resolveExternalCollection,
  resolveCollectionRouteParam,
  resolveMetadataStrategy,
  isRegisteredMiberaContract,
  listCollectionRegistry,
  MIBERA_CONTRACT,
  MST_CONTRACT,
  PYTHIANS_COLLECTION_MINT,
  PURUPURU_CONTRACT,
  FRACTURED_ADDRESSES,
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
});
