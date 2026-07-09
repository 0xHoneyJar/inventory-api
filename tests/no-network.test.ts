import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { getHoldings, getNftsForOwner, getNftMetadata } from '../src/inventory.js';

const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
// Mibera-main resolves metadata via the sovereign route (a network fetch), so the
// codex no-network assertion runs against an unregistered contract.
const CODEX_CONTRACT = '0x000000000000000000000000000000000000C0DE';
const ADDR_WITH_MANY = '0x1111111111111111111111111111111111111111';

/**
 * Where the network boundary actually sits.
 *
 * Ownership and the completeness envelope are fixture-backed in hermetic mode.
 * Mibera METADATA is not: the bundled codex fixture carries 55 of 10,000 tokens,
 * so per-token metadata resolves from the sovereign storage-api on BOTH the
 * single-token and the owner-list routes.
 *
 * These tests assert that boundary with a spy rather than by relying on a
 * throwing stub. A throwing stub proves nothing here — the domain fail-softs on
 * metadata failure, so the call still resolves and the test would pass while
 * silently making network calls.
 */
describe('no-network: fixture-backed reads', () => {
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi.fn(
      (): Promise<Response> =>
        Promise.reject(new Error('Network access is forbidden for fixture-backed reads'))
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getHoldings does not make network calls', async () => {
    await expect(getHoldings(ADDR_WITH_MANY)).resolves.toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getNftMetadata (codex path) does not make network calls', async () => {
    await expect(getNftMetadata(CODEX_CONTRACT, '1')).resolves.toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getHoldings is deterministic across multiple calls', async () => {
    const r1 = await getHoldings(ADDR_WITH_MANY);
    const r2 = await getHoldings(ADDR_WITH_MANY);
    expect(r1).toEqual(r2);
  });

  it('completeness envelope is stable across calls', async () => {
    const r1 = await getHoldings(ADDR_WITH_MANY);
    const r2 = await getHoldings(ADDR_WITH_MANY);
    expect(r1.completeness).toEqual(r2.completeness);
  });
});

describe('Mibera owner-list metadata crosses the network', () => {
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi.fn(
      (): Promise<Response> => Promise.reject(new Error('metadata origin unreachable'))
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves per-token metadata from the sovereign route, one fetch per token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 2 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(
      /^https:\/\/metadata\.0xhoneyjar\.xyz\/mibera\/\d+$/
    );
    warn.mockRestore();
  });

  it('degrades to imageless NFTs — and warns — when the metadata origin is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 2 });

    // Fail-soft: an unreachable origin must not fail the whole page...
    expect(result.nfts).toHaveLength(2);
    expect(result.nfts.every((n) => n.imageUrl === '')).toBe(true);
    // ...but it must NOT be silent, or a CDN outage is indistinguishable from the
    // fixture-miss defect this path replaced (bug 20260709-499c5a). One aggregated
    // line per page, not one per token.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('2 failed');
    warn.mockRestore();
  });
});
