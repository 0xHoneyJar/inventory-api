import { describe, it, expect } from 'vitest';
import { getHoldings } from '../src/inventory.js';

/**
 * Live smoke against the real belt-gateway. SKIPPED by default (keeps the suite
 * hermetic/offline); runs only when SONAR_GRAPHQL_ENDPOINT is set, e.g.:
 *   SONAR_GRAPHQL_ENDPOINT=https://<belt-gateway-host>/v1/graphql npx vitest run live-smoke
 */
const LIVE = !!process.env.SONAR_GRAPHQL_ENDPOINT;

// the Liquid-Backing contract is the largest Mibera holder on-chain
const WHALE = '0xaa04f13994a7fcd86f3bbbf4054d239b88f2744d';

describe.skipIf(!LIVE)('live sonar smoke (belt-gateway)', () => {
  it('completeness envelope carries a real Berachain block + holder count', async () => {
    const r = await getHoldings(WHALE);
    expect(r.completeness.source).toBe('sonar');
    expect(r.completeness.complete).toBe(true); // not degraded — endpoint reachable
    expect(r.completeness.as_of_block).toBeGreaterThan(20_000_000);
    expect(r.completeness.holder_count).toBeGreaterThan(1000);
    // eslint-disable-next-line no-console
    console.log('LIVE completeness:', JSON.stringify(r.completeness), '| holdings:', JSON.stringify(r.holdings));
  });

  it('returns a real live token count for the whale holder', async () => {
    const r = await getHoldings(WHALE);
    expect(r.holdings.length).toBeGreaterThan(0);
    expect(r.holdings[0].tokenCount).toBeGreaterThan(100);
  });
});
