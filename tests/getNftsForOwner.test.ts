import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNftsForOwner } from '../src/inventory.js';
import { ValidationError } from '../src/errors.js';
import { stubSovereignCdn } from './support/sovereign-cdn-stub.js';

const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
const ADDR_WITH_MANY = '0x1111111111111111111111111111111111111111';
const ADDR_WITH_GRAIL = '0x2222222222222222222222222222222222222222';
const ADDR_EMPTY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// Per-token metadata now resolves from the sovereign storage-api (the codex
// fixture holds 55 of 10,000 tokens), so these hermetic tests stub the CDN.
describe('getNftsForOwner', () => {
  beforeEach(() => {
    stubSovereignCdn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns all NFTs for address with 12 tokens (default pageSize)', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT);
    expect(result.nfts).toHaveLength(12);
    expect(result.pageKey).toBeUndefined();
  });

  it('returns paginated NFTs with pageSize=5', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 5 });
    expect(result.nfts).toHaveLength(5);
    expect(result.pageKey).toBeDefined();
  });

  it('returns next page using pageKey', async () => {
    const first = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 5 });
    expect(first.pageKey).toBeDefined();
    const second = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, {
      pageSize: 5,
      pageKey: first.pageKey,
    });
    expect(second.nfts).toHaveLength(5);
    // Token IDs should be different between pages
    const firstIds = first.nfts.map((n) => n.tokenId);
    const secondIds = second.nfts.map((n) => n.tokenId);
    expect(firstIds).not.toEqual(secondIds);
  });

  it('returns final page with remaining items', async () => {
    const first = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 5 });
    const second = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, {
      pageSize: 5,
      pageKey: first.pageKey,
    });
    const third = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, {
      pageSize: 5,
      pageKey: second.pageKey,
    });
    expect(third.nfts).toHaveLength(2); // 12 total, pages of 5: 5+5+2
    expect(third.pageKey).toBeUndefined();
  });

  it('NFT shape has all required fields', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 1 });
    const nft = result.nfts[0];
    expect(nft).toHaveProperty('tokenId');
    expect(nft).toHaveProperty('name');
    expect(nft).toHaveProperty('description');
    expect(nft).toHaveProperty('imageUrl');
    expect(nft).toHaveProperty('contentType');
    expect(nft).toHaveProperty('attributes');
    expect(nft.contentType).toBe('image/png');
  });

  it('NFT imageUrl is set from the sovereign route', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 1 });
    const nft = result.nfts[0];
    expect(nft.imageUrl).toMatch(/^https:\/\/assets\.0xhoneyjar\.xyz\/.+\.png$/);
  });

  it('NFT name follows Mibera #N pattern for non-grail', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 1 });
    const nft = result.nfts[0];
    expect(nft.name).toMatch(/^Mibera #\d+$/);
  });

  // The codex models a grail twice: generative traits in miberas.jsonl, and a
  // curated art record in grails.jsonl whose `attributes` the sovereign route
  // renders verbatim. Grail identity is `tier: Grail` — the old
  // {trait_type:'Grail', value:'true'} was an inventory-api synthesis present in
  // neither codex file nor the CDN.
  it('grail NFT is identified by the codex tier attribute', async () => {
    const result = await getNftsForOwner(ADDR_WITH_GRAIL, MIBERA_CONTRACT);
    const grailNft = result.nfts.find((n) => n.tokenId === '2769');
    expect(grailNft).toBeDefined();
    const tier = grailNft!.attributes.find((a) => a.trait_type === 'tier');
    expect(tier).toBeDefined();
    expect(tier!.value).toBe('Grail');
  });

  it('grail NFT contentType tracks its actual image format (.webp, not image/png)', async () => {
    const result = await getNftsForOwner(ADDR_WITH_GRAIL, MIBERA_CONTRACT);
    const grailNft = result.nfts.find((n) => n.tokenId === '2769');
    expect(grailNft!.imageUrl).toMatch(/\.webp$/);
    expect(grailNft!.contentType).toBe('image/webp');
  });

  it('grail NFT uses grail name from grail record', async () => {
    const result = await getNftsForOwner(ADDR_WITH_GRAIL, MIBERA_CONTRACT);
    const grailNft = result.nfts.find((n) => n.tokenId === '2769');
    expect(grailNft).toBeDefined();
    expect(grailNft!.name).toBe('Air');
  });

  it('grail NFT description comes from grail record', async () => {
    const result = await getNftsForOwner(ADDR_WITH_GRAIL, MIBERA_CONTRACT);
    const grailNft = result.nfts.find((n) => n.tokenId === '2769');
    expect(grailNft!.description).toContain('Cloud');
  });

  it('collection metadata is correct', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT);
    expect(result.contractAddress).toBe(MIBERA_CONTRACT);
    expect(result.name).toBe('Mibera');
    expect(result.symbol).toBe('MIBERA');
    expect(result.totalSupply).toBe(10000);
  });

  it('returns empty nfts array for address with no tokens', async () => {
    const result = await getNftsForOwner(ADDR_EMPTY, MIBERA_CONTRACT);
    expect(result.nfts).toHaveLength(0);
    expect(result.pageKey).toBeUndefined();
  });

  it('throws ValidationError for invalid address', async () => {
    await expect(
      getNftsForOwner('not-an-address', MIBERA_CONTRACT)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid contract address', async () => {
    await expect(
      getNftsForOwner(ADDR_WITH_MANY, 'not-a-contract')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('pageSize is clamped to maximum of 100', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 9999 });
    // 12 total tokens, all fit within max 100 pageSize
    expect(result.nfts).toHaveLength(12);
    expect(result.pageKey).toBeUndefined();
  });

  it('attributes array has at least 10 non-null attributes for generative token', async () => {
    const result = await getNftsForOwner(ADDR_WITH_MANY, MIBERA_CONTRACT, { pageSize: 1 });
    const nft = result.nfts[0];
    // Each fixture token has at least 14 non-null trait fields
    expect(nft.attributes.length).toBeGreaterThanOrEqual(10);
  });
});
