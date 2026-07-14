import { describe, it, expect, vi, afterEach } from "vitest";
import { getProfilePicture } from "../src/inventory.js";
import { ValidationError } from "../src/errors.js";
import { PURUPURU_CONTRACT } from "../src/collection-registry.js";

const PYTHIANS_HOLDER = "HdLiAKti95C7eNK78bfPEKbUrSP1roZgWxDnsbyWXour";

// NOTE (INV-A): `fixtures/pythenians-metadata.json` is deliberately NOT loaded
// here anymore — see tests/getNftsForOwner.external.test.ts. Asserting an image
// served from a fixture the real host does not serve is how this suite stayed
// green while every pythenians holder rendered a grey box.

describe("getProfilePicture — external communities (INV-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // REWRITTEN again (PYTH-2, 2026-07-13). The row moved from `{ kind:
  // "unresolved" }` (INV-A) to `{ kind: "sonar-image" }` — a real, zero-fetch
  // pass-through of sonar's resolved image. The bundled hermetic fixture has
  // no real DAS image data for this holder's mints (fake mint addresses), so
  // the answer is STILL null — but now because sonar published nothing for
  // these particular (fake) mints, not because the row is declared broken.
  it("returns null for pythenians (hermetic fixture has no image data), and makes NO network call", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`sonar-image strategy must make no network call, attempted: ${String(url)}`);
    });

    const pfp = await getProfilePicture(PYTHIANS_HOLDER, { contract: "pythians" });

    expect(pfp).toBeNull();
  });

  it("returns null via the pythenians alias too", async () => {
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
