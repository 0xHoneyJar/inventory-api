import { describe, it, expect } from 'vitest';
import { getProfilePicture } from '../src/inventory.js';

// Fixture holders (mirrors getNftsForOwner.test.ts).
const ADDR_WITH_MANY = '0x1111111111111111111111111111111111111111';
const ADDR_EMPTY = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

describe('getProfilePicture', () => {
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
});
