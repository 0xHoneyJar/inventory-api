import { describe, it, expect } from "vitest";
import { getSvmNftsByOwner } from "../src/svm-sonar-client.js";

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";

describe("svm-sonar-client (hermetic fixture)", () => {
  it("filters by collectionKey and owner with case-sensitive base58 match", () => {
    const rows = getSvmNftsByOwner(PYTHIANS_HOLDER, "pythians");
    expect(rows).toHaveLength(3);
    expect(rows[0].nftMint).toBe("PytheniansMint3180Example1111111111111111111");
  });

  it("returns empty when owner case does not match fixture verbatim", () => {
    const rows = getSvmNftsByOwner(PYTHIANS_HOLDER.toLowerCase(), "pythians");
    expect(rows).toEqual([]);
  });

  it("returns empty for unknown collectionKey", () => {
    const rows = getSvmNftsByOwner(PYTHIANS_HOLDER, "unknown-collection");
    expect(rows).toEqual([]);
  });
});
