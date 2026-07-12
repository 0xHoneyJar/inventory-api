import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProfilePicture } from '../src/inventory.js';
import { stubSovereignCdn } from './support/sovereign-cdn-stub.js';

// Fixture holders (mirrors getNftsForOwner.test.ts).
const ADDR_WITH_MANY = '0x1111111111111111111111111111111111111111';
const ADDR_EMPTY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// getProfilePicture reads the first NFT of the owner-list, whose metadata now
// resolves over the sovereign route — stub it to keep this suite offline.
describe('getProfilePicture', () => {
  beforeEach(() => {
    stubSovereignCdn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a real NFT image url for a holder who owns NFTs', async () => {
    const pfp = await getProfilePicture(ADDR_WITH_MANY);
    expect(pfp).toBeTruthy();
    expect(typeof pfp).toBe('string');
    expect((pfp as string).length).toBeGreaterThan(0);
  });

  it('returns null when the wallet owns none — consumer falls back to its own pfp (Issue #87)', async () => {
    const pfp = await getProfilePicture(ADDR_EMPTY);
    expect(pfp).toBeNull();
  });

  it('rejects an invalid address (same guard as getNftsForOwner)', async () => {
    await expect(getProfilePicture('not-an-address')).rejects.toThrow();
  });

  it('rejects a well-formed-but-unregistered contract with a typed INVENTORY_INVALID_INPUT error', async () => {
    const UNREGISTERED = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    await expect(
      getProfilePicture(ADDR_WITH_MANY, { contract: UNREGISTERED }),
    ).rejects.toMatchObject({ code: 'INVENTORY_INVALID_INPUT' });
  });
});
