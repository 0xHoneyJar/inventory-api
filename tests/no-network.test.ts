import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getHoldings, getNftsForOwner, getNftMetadata } from '../src/inventory.js';

const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
// Mibera-main now resolves metadata via the sovereign route (a network fetch), so
// the metadata no-network assertion runs against the codex path (unknown contract).
const CODEX_CONTRACT = '0x000000000000000000000000000000000000C0DE';
const ADDR_WITH_MANY = '0x1111111111111111111111111111111111111111';

/**
 * These tests verify the module works entirely from fixtures with no network calls.
 * They monkey-patch global fetch to throw if called, ensuring no HTTP requests escape.
 */
describe('no-network: all data comes from fixtures', () => {
  beforeEach(() => {
    // Block any accidental network calls
    vi.stubGlobal('fetch', () => {
      throw new Error('Network access is forbidden in inventory module — use fixtures');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getHoldings does not make network calls', async () => {
    await expect(getHoldings(ADDR_WITH_MANY)).resolves.toBeDefined();
  });

  it('getNftsForOwner does not make network calls', async () => {
    await expect(
      getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT)
    ).resolves.toBeDefined();
  });

  it('getNftMetadata (codex path) does not make network calls', async () => {
    await expect(
      getNftMetadata(CODEX_CONTRACT, '1')
    ).resolves.toBeDefined();
  });

  it('module works deterministically across multiple calls', async () => {
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
