import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../src/concurrency.js";

const tick = (ms = 1) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const items = [5, 1, 4, 2, 3];
    // Slower items finish last, so completion order != input order.
    const result = await mapWithConcurrency(items, 3, async (n) => {
      await tick(n);
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBe(4);
  });

  it("runs concurrently rather than serially", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2, 3, 4], 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(2);
      inFlight -= 1;
    });
    expect(peak).toBe(4);
  });

  it("returns [] for empty input without invoking the mapper", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("never spawns more workers than items", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2], 100, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });

  it("passes the index to the mapper", async () => {
    const seen: number[] = [];
    await mapWithConcurrency(["a", "b", "c"], 1, async (_item, i) => {
      seen.push(i);
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  // A limit that coerces to zero would spawn zero workers, drain nothing, and
  // leave the returned promise forever pending. Each of these must still settle.
  it.each([0, -1, NaN, 0.4])("settles for a degenerate limit (%s)", async (limit) => {
    const result = await mapWithConcurrency([1, 2, 3], limit, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
  });

  // Error policy is fail-fast, and it belongs to the CALLER, not the helper. The one
  // production caller (resolveSovereignPage) try/catches every token, which is where
  // per-item resilience lives. See src/concurrency.ts and sprint.md Task 2 (R4).
  it("fails fast: a rejecting mapper rejects the whole call", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      })
    ).rejects.toThrow("boom");
  });

  it("a rejection does not surface as an unhandled rejection from sibling workers", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (n) => {
        await tick(n);
        if (n % 2 === 0) throw new Error(`boom-${n}`);
        return n;
      })
    ).rejects.toThrow(/^boom-/);

    // Let any stray rejection settle before asserting.
    await tick(20);
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });
});
