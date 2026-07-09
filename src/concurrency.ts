/**
 * Bounded-concurrency map — order-preserving, zero-dependency.
 *
 * Owner-list metadata resolves one HTTP fetch per token, and a page carries up
 * to 100 tokens (`applyPagination` clamps pageSize to 100 — src/pagination.ts).
 * An unbounded `Promise.all(page.map(...))` therefore opens up to 100 sockets to
 * the sovereign origin for a single inbound request. This caps the in-flight
 * count while preserving input order.
 *
 * ERROR POLICY — fail-fast. A rejecting mapper rejects the returned promise, the same
 * default as `p-map`'s `stopOnError`. Per-item resilience is deliberately the CALLER's
 * job: see `resolveSovereignPage`, which try/catches every token so one unresolvable
 * token cannot fail a page. Swallowing rejections here would hide programming errors
 * from every future caller, and would make this primitive lie about what happened.
 * (Sprint AC amended 2026-07-09 — see sprint.md Task 2, review item R4.)
 *
 * Zero new runtime deps by ecosystem convention (cf. score-api's
 * `runWithConcurrency`) — inventory-api ships only `ethereum-cryptography` +
 * `zod`, and a ~20-line worker pool does not justify pulling in `p-limit`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const size = items.length;
  if (size === 0) return [];

  // A NaN / zero / negative limit must never spawn zero workers: the pool would
  // drain nothing and the returned promise would never settle. Coerce to >= 1,
  // then never exceed the item count.
  const requested = Math.max(1, Math.trunc(limit)) || 1;
  const workers = Math.min(requested, size);

  const results = new Array<R>(size);
  let next = 0;

  async function drain(): Promise<void> {
    while (next < size) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workers }, drain));
  return results;
}
