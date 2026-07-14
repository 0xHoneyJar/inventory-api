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

  // REWRITTEN (INV-A, 2026-07-13). This asserted that the sovereign route
  // serves pythenians art — it does not, and never did. The old test stubbed
  // `fetch` to return `fixtures/pythenians-metadata.json` and then asserted the
  // image from that same fixture: a closed loop that could only ever pass. The
  // live host 404s on every pythenians path, we hold no rights to mirror it,
  // and sonar publishes no `uri` to proxy to — so the row is now declared
  // `unresolved` and the honest answer is null.
  it("returns null for pythenians — no working metadata source, and makes NO network call", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string) => {
      throw new Error(`unresolved row must make no network call, attempted: ${String(url)}`);
    });

    const pfp = await getProfilePicture(PYTHIANS_HOLDER, { contract: "pythians" });

    expect(pfp).toBeNull();
    // The defect is declared out loud, with its reason, not swallowed.
    expect(warn).toHaveBeenCalled();
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("metadata unresolved");
    expect(line).toContain("DECLARED defect");
    warn.mockRestore();
  });

  it("returns null via the pythenians alias too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pfp = await getProfilePicture(PYTHIANS_HOLDER, { contract: "pythenians" });
    expect(pfp).toBeNull();
    warn.mockRestore();
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
