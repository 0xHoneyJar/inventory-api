import { describe, it, expect, vi, afterEach } from "vitest";

const MIBERA_CONTRACT = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
const HOLDER_WITH_MANY = "0x1111111111111111111111111111111111111111"; // owns 12 tokens
const TOKENS_OWNED = 12;

/**
 * A per-fetch timeout does not bound a page.
 *
 * `applyPagination` clamps pageSize to 100 and `METADATA_FETCH_CONCURRENCY` defaults to 8,
 * so a hung origin would cost ceil(100/8) = 13 sequential waves x METADATA_FETCH_TIMEOUT_MS
 * (8000ms) = ~104s of wall time for a single inbound request — well past the 30s service
 * request timeout (src/hyper/core/security.ts). The client would get a dropped request
 * while the detached handler kept holding origin sockets open.
 *
 * `METADATA_PAGE_BUDGET_MS` is one deadline shared by every token in the page.
 *
 * Both knobs are read at module load, so this file pins them via stubEnv + resetModules
 * and re-imports. It must never depend on the ambient environment: these constants are
 * documented as overridable "for tests/ops".
 */
describe("sovereign metadata page budget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("bounds a hung origin: aborts in-flight fetches and skips the untried remainder", async () => {
    vi.stubEnv("METADATA_PAGE_BUDGET_MS", "25");
    vi.stubEnv("METADATA_FETCH_CONCURRENCY", "8");
    vi.resetModules();

    let socketsOpened = 0;
    // An origin that accepts the connection and then never answers — the case a
    // per-fetch timeout handles per token but never bounds across a page.
    vi.stubGlobal("fetch", (_url: string, init: { signal: AbortSignal }) => {
      socketsOpened += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("AbortError")));
      });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { METADATA_FETCH_CONCURRENCY } = await import("../src/sovereign-metadata.js");
    const { getNftsForOwner } = await import("../src/inventory.js");

    const startedAt = performance.now();
    const result = await getNftsForOwner(HOLDER_WITH_MANY, MIBERA_CONTRACT);
    const elapsedMs = performance.now() - startedAt;

    // The page still resolves — fail-soft, not a thrown request.
    expect(result.nfts).toHaveLength(TOKENS_OWNED);
    expect(result.nfts.every((n) => n.imageUrl === "")).toBe(true);
    expect(result.nfts.map((n) => n.tokenId)).toEqual(
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
    );

    // Only the first concurrency-wave ever opened a socket. The remaining tokens
    // observed the spent budget and were skipped without a fetch.
    const attempted = METADATA_FETCH_CONCURRENCY;
    const skipped = TOKENS_OWNED - attempted;
    expect(socketsOpened).toBe(attempted);
    expect(elapsedMs).toBeLessThan(2000);

    // Exactly one aggregated warning, carrying both counts.
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(`${attempted} failed`);
    expect(message).toContain(`${skipped} skipped`);
    expect(message).toContain(`${TOKENS_OWNED} token(s)`);
    warn.mockRestore();
  });

  it("a healthy origin under budget resolves every token and never warns", async () => {
    vi.stubEnv("METADATA_PAGE_BUDGET_MS", "5000");
    vi.resetModules();

    const { sovereignCdnResponse } = await import("./support/sovereign-cdn-stub.js");
    vi.stubGlobal("fetch", async (url: string) => sovereignCdnResponse(String(url)));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getNftsForOwner } = await import("../src/inventory.js");
    const result = await getNftsForOwner(HOLDER_WITH_MANY, MIBERA_CONTRACT);

    expect(result.nfts).toHaveLength(TOKENS_OWNED);
    expect(result.nfts.every((n) => n.imageUrl.length > 0)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("passes the page budget signal into every metadata fetch", async () => {
    const signals: unknown[] = [];
    const { sovereignCdnResponse } = await import("./support/sovereign-cdn-stub.js");
    vi.stubGlobal("fetch", async (url: string, init: { signal?: AbortSignal }) => {
      signals.push(init?.signal);
      return sovereignCdnResponse(String(url));
    });

    const { getNftsForOwner } = await import("../src/inventory.js");
    await getNftsForOwner(HOLDER_WITH_MANY, MIBERA_CONTRACT, { pageSize: 3 });

    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});

/**
 * The budget only bounds the request if it expires BEFORE the service gives up on it.
 * A budget at or above `requestTimeoutMs` lets a hung origin outlive the inbound
 * request — the client gets a dropped request rather than a fail-soft page, while the
 * detached handler holds origin sockets to budget-end. That is the exact hazard the
 * budget exists to kill, so an over-large override must be clamped, not honoured.
 *
 * The domain layer is framework-free by design, so the relationship between the two
 * constants is pinned here rather than by importing hyper into src/sovereign-metadata.ts.
 */
describe("page budget is bounded by the service request timeout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the ceiling sits strictly below DEFAULT_SECURITY.requestTimeoutMs", async () => {
    const { METADATA_PAGE_BUDGET_MAX_MS } = await import("../src/sovereign-metadata.js");
    const { DEFAULT_SECURITY } = await import("@hyper/core");

    expect(METADATA_PAGE_BUDGET_MAX_MS).toBeLessThan(DEFAULT_SECURITY.requestTimeoutMs);
  });

  it("clamps an over-large override down to the ceiling", async () => {
    vi.stubEnv("METADATA_PAGE_BUDGET_MS", "600000");
    vi.resetModules();

    const { METADATA_PAGE_BUDGET_MS, METADATA_PAGE_BUDGET_MAX_MS } = await import(
      "../src/sovereign-metadata.js"
    );
    expect(METADATA_PAGE_BUDGET_MS).toBe(METADATA_PAGE_BUDGET_MAX_MS);
  });

  it("honours a legitimate override below the ceiling", async () => {
    vi.stubEnv("METADATA_PAGE_BUDGET_MS", "3000");
    vi.resetModules();

    const { METADATA_PAGE_BUDGET_MS } = await import("../src/sovereign-metadata.js");
    expect(METADATA_PAGE_BUDGET_MS).toBe(3000);
  });

  it.each(["0", "-5", "not-a-number", ""])(
    "falls back to the default for a degenerate override (%s)",
    async (value) => {
      vi.stubEnv("METADATA_PAGE_BUDGET_MS", value);
      vi.resetModules();

      const { METADATA_PAGE_BUDGET_MS } = await import("../src/sovereign-metadata.js");
      expect(METADATA_PAGE_BUDGET_MS).toBe(15_000);
    }
  );
});

/**
 * The degraded warning is the ONLY signal separating a down origin from absent tokens,
 * so it must never degrade into noise. The budget can expire while every ATTEMPTED fetch
 * succeeded — leaving tokens skipped but no error to report.
 */
describe("degraded-page warning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports an exhausted budget rather than stringifying a missing error", async () => {
    const { warnSovereignMetadataDegraded } = await import("../src/sovereign-metadata.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnSovereignMetadataDegraded("mibera", { failed: 0, skipped: 4, total: 12 });

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, ...rest] = warn.mock.calls[0];
    expect(String(message)).toContain("page budget exhausted");
    expect(String(message)).not.toContain("undefined");
    expect(rest).toEqual([]); // no second argument to stringify
  });

  it("reports the upstream error detail when there is one", async () => {
    const { warnSovereignMetadataDegraded } = await import("../src/sovereign-metadata.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnSovereignMetadataDegraded(
      "mibera",
      { failed: 3, skipped: 0, total: 3 },
      new Error("HTTP 503")
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("3 failed");
    expect(String(warn.mock.calls[0][1])).toContain("HTTP 503");
  });

  it("collapses line breaks in upstream error text (CWE-117)", async () => {
    const { warnSovereignMetadataDegraded } = await import("../src/sovereign-metadata.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnSovereignMetadataDegraded(
      "mibera",
      { failed: 1, skipped: 0, total: 1 },
      new Error("boom\r\n[inventory-api] FORGED LINE")
    );

    const detail = String(warn.mock.calls[0][1]);
    expect(detail).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(detail).toContain("FORGED LINE");
  });
});
