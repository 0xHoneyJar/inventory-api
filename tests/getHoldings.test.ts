import { describe, it, expect } from 'vitest';
import { getHoldings } from '../src/inventory.js';
import { ValidationError } from '../src/errors.js';

const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
const ADDR_WITH_MANY = '0x1111111111111111111111111111111111111111';
const ADDR_WITH_GRAIL = '0x2222222222222222222222222222222222222222';
const ADDR_WITH_GRAIL_2 = '0x3333333333333333333333333333333333333333';
const ADDR_EMPTY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const KNOWN_HOLDER_COUNT = 5;
const KNOWN_MAX_BLOCK = 9123456;

describe('getHoldings', () => {
  it('returns holdings for an address with many tokens', async () => {
    const result = await getHoldings(ADDR_WITH_MANY);
    expect(result.holdings).toHaveLength(1);
    const holding = result.holdings[0];
    expect(holding.contractAddress).toBe(MIBERA_CONTRACT);
    expect(holding.chainId).toBe(80094);
    expect(holding.tokenCount).toBe(12);
    expect(holding.tokenIds).toHaveLength(12);
    expect(holding.tokenIds).toContain('1');
    expect(holding.tokenIds).toContain('12');
  });

  it('returns holdings for address with grail token', async () => {
    const result = await getHoldings(ADDR_WITH_GRAIL);
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].tokenIds).toContain('2769');
  });

  it('returns empty holdings array for address with no tokens', async () => {
    const result = await getHoldings(ADDR_EMPTY);
    expect(result.holdings).toHaveLength(0);
  });

  it('completeness envelope has correct holder_count', async () => {
    const result = await getHoldings(ADDR_WITH_MANY);
    expect(result.completeness.holder_count).toBe(KNOWN_HOLDER_COUNT);
  });

  it('completeness envelope has correct as_of_block', async () => {
    const result = await getHoldings(ADDR_WITH_MANY);
    expect(result.completeness.as_of_block).toBe(KNOWN_MAX_BLOCK);
  });

  it('completeness envelope has correct source and complete fields', async () => {
    const result = await getHoldings(ADDR_WITH_MANY);
    expect(result.completeness.source).toBe('sonar');
    expect(result.completeness.complete).toBe(true);
  });

  it('accepts checksummed address', async () => {
    const result = await getHoldings('0x1111111111111111111111111111111111111111');
    expect(result.holdings).toHaveLength(1);
  });

  it('accepts lowercase address', async () => {
    const result = await getHoldings('0x1111111111111111111111111111111111111111');
    expect(result.holdings).toHaveLength(1);
  });

  it('throws ValidationError for invalid address', async () => {
    await expect(getHoldings('not-an-address')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid address format', async () => {
    await expect(getHoldings('0xGGGG')).rejects.toBeInstanceOf(ValidationError);
  });

  it('supports contracts option to filter to specific contract', async () => {
    const result = await getHoldings(ADDR_WITH_MANY, {
      contracts: [MIBERA_CONTRACT],
    });
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].contractAddress).toBe(MIBERA_CONTRACT);
  });

  it('throws ValidationError for invalid contract address in options', async () => {
    await expect(
      getHoldings(ADDR_WITH_MANY, { contracts: ['not-a-contract'] })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns grail token IDs in holdings', async () => {
    const result = await getHoldings(ADDR_WITH_GRAIL_2);
    expect(result.holdings[0].tokenIds).toContain('876');
  });

  it('completeness is present even for address with no holdings', async () => {
    const result = await getHoldings(ADDR_EMPTY);
    expect(result.completeness).toBeDefined();
    expect(result.completeness.source).toBe('sonar');
    expect(result.completeness.as_of_block).toBe(KNOWN_MAX_BLOCK);
  });
});
