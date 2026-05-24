import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getHoldings, getNftsForOwner } from '../src/inventory.js';
import {
  liveOwnerTokenIds,
  liveCandiesBalances,
} from '../src/live-sonar.js';

/**
 * Hermetic live-mode tests for the DEP-2 ownership activation.
 *
 * The sonar belt-factory branch that publishes the per-token `Token` index
 * is NOT yet deployed/reindexed, so we cannot hit a real endpoint. Instead we
 * set SONAR_GRAPHQL_ENDPOINT (to flip the module into live mode) and stub
 * `fetch` with a tiny GraphQL responder that returns the KNOWN belt schema
 * shapes — `Token`, `CandiesHolderBalance`, `TrackedHolder`, `chain_metadata`.
 * This exercises the real query-construction + join code paths offline.
 */

const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
const HOLDER = '0x1111111111111111111111111111111111111111';
const EMPTY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const ENDPOINT = 'https://belt-gateway.test/v1/graphql';

// Minimal GraphQL responder: routes on the entity named in the query string.
// Mirrors the belt-gateway's `{ data, errors }` envelope.
function makeFetchStub(opts: {
  tokenIds?: string[];
  candies?: { contract: string; tokenId: string; amount: string }[];
  trackedCount?: number;
  failTokenIndex?: boolean;
  capture?: (gql: string) => void;
}) {
  const {
    tokenIds = [],
    candies = [],
    trackedCount = tokenIds.length,
    failTokenIndex = false,
    capture,
  } = opts;
  return async (_url: string, init: { body: string }) => {
    const { query: gql } = JSON.parse(init.body) as { query: string };
    capture?.(gql);
    const data: Record<string, unknown> = {};
    if (gql.includes('chain_metadata')) {
      data.chain_metadata = [{ latest_processed_block: 30_111_222 }];
    }
    if (gql.includes('TrackedHolder_aggregate')) {
      data.TrackedHolder_aggregate = { aggregate: { count: 4242 } };
    } else if (gql.includes('TrackedHolder')) {
      data.TrackedHolder =
        trackedCount > 0 ? [{ tokenCount: trackedCount }] : [];
    }
    if (gql.includes('Token(')) {
      if (failTokenIndex) {
        return {
          ok: true,
          json: async () => ({ errors: [{ message: 'Token index unavailable' }] }),
        };
      }
      data.Token = tokenIds.map((tokenId) => ({ tokenId }));
    }
    if (gql.includes('CandiesHolderBalance')) {
      data.CandiesHolderBalance = candies;
    }
    return { ok: true, json: async () => ({ data }) };
  };
}

describe('live ownership (DEP-2, hermetic via fetch stub)', () => {
  beforeEach(() => {
    process.env.SONAR_GRAPHQL_ENDPOINT = ENDPOINT;
  });
  afterEach(() => {
    delete process.env.SONAR_GRAPHQL_ENDPOINT;
    vi.unstubAllGlobals();
  });

  describe('liveOwnerTokenIds', () => {
    it('queries the Token index with owner + collection + isBurned=false', async () => {
      let captured = '';
      vi.stubGlobal(
        'fetch',
        makeFetchStub({ tokenIds: ['1', '12', '2769'], capture: (g) => {
          if (g.includes('Token(')) captured = g;
        } })
      );
      const ids = await liveOwnerTokenIds(HOLDER, MIBERA_CONTRACT);
      expect(ids).toEqual(['1', '12', '2769']);
      // Address + contract are lowercased in the filter.
      expect(captured).toContain(HOLDER.toLowerCase());
      expect(captured).toContain(MIBERA_CONTRACT.toLowerCase());
      expect(captured).toContain('isBurned');
      expect(captured).toContain('owner');
      expect(captured).toContain('collection');
    });

    it('returns an empty array when the holder owns no tokens', async () => {
      vi.stubGlobal('fetch', makeFetchStub({ tokenIds: [] }));
      const ids = await liveOwnerTokenIds(EMPTY, MIBERA_CONTRACT);
      expect(ids).toEqual([]);
    });

    it('coerces numeric tokenIds to strings', async () => {
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        json: async () => ({ data: { Token: [{ tokenId: 7 }, { tokenId: 8 }] } }),
      }));
      const ids = await liveOwnerTokenIds(HOLDER, MIBERA_CONTRACT);
      expect(ids).toEqual(['7', '8']);
    });
  });

  describe('liveCandiesBalances (ERC-1155)', () => {
    it('queries CandiesHolderBalance with the holder filter + amount > 0', async () => {
      let captured = '';
      vi.stubGlobal(
        'fetch',
        makeFetchStub({
          candies: [
            { contract: '0xcandy', tokenId: '5', amount: '3' },
            { contract: '0xcandy', tokenId: '9', amount: '1' },
          ],
          capture: (g) => {
            if (g.includes('CandiesHolderBalance')) captured = g;
          },
        })
      );
      const balances = await liveCandiesBalances(HOLDER);
      expect(balances).toHaveLength(2);
      expect(balances[0]).toEqual({ contract: '0xcandy', tokenId: '5', amount: '3' });
      expect(captured).toContain(HOLDER.toLowerCase());
      expect(captured).toContain('amount');
      expect(captured).toContain('_gt');
    });
  });

  describe('getHoldings (live) populates tokenIds from the Token index', () => {
    it('returns real tokenCount AND real tokenIds', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchStub({ tokenIds: ['1', '2', '3'], trackedCount: 3 })
      );
      const r = await getHoldings(HOLDER);
      expect(r.completeness.complete).toBe(true);
      expect(r.completeness.as_of_block).toBe(30_111_222);
      expect(r.holdings).toHaveLength(1);
      expect(r.holdings[0].tokenCount).toBe(3);
      expect(r.holdings[0].tokenIds).toEqual(['1', '2', '3']);
    });

    it('fail-soft: keeps real count with empty tokenIds when Token index errors', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchStub({ trackedCount: 5, failTokenIndex: true })
      );
      const r = await getHoldings(HOLDER);
      expect(r.holdings[0].tokenCount).toBe(5);
      expect(r.holdings[0].tokenIds).toEqual([]);
    });

    it('fail-soft: degrades to fixture holdings when endpoint is fully unreachable', async () => {
      vi.stubGlobal('fetch', () => {
        throw new Error('network down');
      });
      const r = await getHoldings(HOLDER);
      // README contract: unreachable -> fixture + degraded (never a crash).
      expect(r.completeness.complete).toBe('degraded');
      // Holdings degrade to the fixture (HOLDER owns 12 there).
      expect(r.holdings).toHaveLength(1);
      expect(r.holdings[0].tokenCount).toBe(12);
      expect(r.holdings[0].tokenIds).toHaveLength(12);
    });
  });

  describe('getNftsForOwner (live) joins codex metadata onto live tokenIds', () => {
    it('builds NFTs from the live Token index (real codex traits)', async () => {
      vi.stubGlobal('fetch', makeFetchStub({ tokenIds: ['1', '2769'] }));
      const col = await getNftsForOwner(HOLDER, MIBERA_CONTRACT);
      expect(col.nfts).toHaveLength(2);
      const ids = col.nfts.map((n) => n.tokenId);
      expect(ids).toContain('1');
      expect(ids).toContain('2769');
      // Codex join still works: token 1 is a real generative record.
      const gen = col.nfts.find((n) => n.tokenId === '1');
      expect(gen!.name).toBe('Mibera #1');
      expect(gen!.attributes.length).toBeGreaterThanOrEqual(10);
      // token 2769 is a pinned grail.
      const grail = col.nfts.find((n) => n.tokenId === '2769');
      expect(grail!.name).toBe('Air');
    });

    it('paginates over the live tokenId list', async () => {
      vi.stubGlobal(
        'fetch',
        makeFetchStub({ tokenIds: ['1', '2', '3', '4', '5'] })
      );
      const first = await getNftsForOwner(HOLDER, MIBERA_CONTRACT, { pageSize: 2 });
      expect(first.nfts).toHaveLength(2);
      expect(first.pageKey).toBeDefined();
    });

    it('fail-soft: falls back to fixtures when the Token index errors', async () => {
      vi.stubGlobal('fetch', makeFetchStub({ failTokenIndex: true }));
      // HOLDER (0x111..1) owns 12 tokens in the fixture.
      const col = await getNftsForOwner(HOLDER, MIBERA_CONTRACT);
      expect(col.nfts).toHaveLength(12);
    });
  });
});
