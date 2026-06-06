import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import {
  sovereignMetadataUrl,
  mstMetadataUrl,
  fetchSovereignMetadata,
} from '../src/sovereign-metadata.js';
import { NotFoundError } from '../src/errors.js';

// Candies (Mibera "Drugs") — ERC-1155, chain 80094. Input lowercase on purpose:
// the resolver MUST checksum it before the registry lookup (EIP-55-consistent),
// not raw-case string compare.
const CANDIES_CONTRACT = '0xeca03517c5195f1edd634da6d690d6c72407c40c';
// MST stays in this file as the regression guard for the generalized resolver.
const MST_CONTRACT = '0x048327a187b944ddac61c6e202bfccd20d17c008';
const TOKEN_ID = '1';

// Shaped like the live sovereign JSON for a candies token (per the seam contract:
// name=listing.title, description=listing.description, image=sovereign host,
// attributes from listing fields). value may be string|number on the wire.
const candiesFixture = {
  name: 'Test Candy',
  description: 'A hermetic candies listing.',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/Drugs/candy-1.png',
  attributes: [
    { trait_type: 'Category', value: 'edibles' },
    { trait_type: 'Ships From', value: 'US' },
    { trait_type: 'Ships To', value: 'Worldwide' },
    { trait_type: 'Price', value: 42 },
  ],
};

const mstFixture = {
  name: 'MST #234',
  description: 'shadow',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/generated/234.webp',
  attributes: [{ trait_type: 'background', value: 'no more walls' }],
};

/**
 * Hermetic: global fetch is mocked so the suite stays fully offline. The sovereign
 * path is the ONLY getNftMetadata branch that touches the network; Mibera-main stays
 * fixture-backed and fetch-free. Candies is the new sovereign collection; the MST
 * assertions are the regression guard that generalizing the resolver did not change
 * MST behavior.
 */
describe('getNftMetadata — Candies sovereign path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the candies sovereign URL and returns the decoded MetadataDocument', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // Confirms the resolver hits the candies sovereign storage-api route,
      // not the MST slug, not chain/sonar/codex.
      expect(url).toBe(sovereignMetadataUrl('candies', TOKEN_ID));
      expect(url).toBe(
        'https://metadata.0xhoneyjar.xyz/mibera/candies/1'
      );
      return new Response(JSON.stringify(candiesFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const doc = await getNftMetadata(CANDIES_CONTRACT, TOKEN_ID);

    expect(doc.name).toBe('Test Candy');
    expect(doc.description).toBe('A hermetic candies listing.');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/Drugs/candy-1.png'
    );
    // attributes coerced to {trait_type, value} string pairs (numeric Price -> "42")
    expect(doc.attributes).toEqual([
      { trait_type: 'Category', value: 'edibles' },
      { trait_type: 'Ships From', value: 'US' },
      { trait_type: 'Ships To', value: 'Worldwide' },
      { trait_type: 'Price', value: '42' },
    ]);
  });

  it('returns the plain MetadataDocument shape (no extra keys)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(candiesFixture), { status: 200 })
    );

    const doc = await getNftMetadata(CANDIES_CONTRACT, TOKEN_ID);
    expect(Object.keys(doc).sort()).toEqual(
      ['attributes', 'description', 'image', 'name'].sort()
    );
  });

  it('throws NotFoundError on 403 (unminted) / 404 (absent)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const err = await getNftMetadata(CANDIES_CONTRACT, '999999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('999999');
  });

  it('does NOT collapse a 429 (throttle) into NotFound', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));

    const err = await getNftMetadata(CANDIES_CONTRACT, TOKEN_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotFoundError);
  });
});

describe('getNftMetadata — MST regression (resolver generalized)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still resolves the MST sovereign URL — slug "mst" unchanged', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // The generalized resolver must hit the SAME MST route it did before.
      expect(url).toBe(mstMetadataUrl('234'));
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/mst/234');
      return new Response(JSON.stringify(mstFixture), { status: 200 });
    });

    const doc = await getNftMetadata(MST_CONTRACT, '234');
    expect(doc.name).toBe('MST #234');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/generated/234.webp'
    );
    const bg = doc.attributes.find((a) => a.trait_type === 'background');
    expect(bg?.value).toBe('no more walls');
  });
});

describe('sovereign-metadata — slug-parameterized URL + resolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mstMetadataUrl is the "mst" slug of the generalized helper (back-compat)', () => {
    expect(mstMetadataUrl('234')).toBe(sovereignMetadataUrl('mst', '234'));
  });

  it('fetchSovereignMetadata("candies", ...) hits the candies route directly', async () => {
    let seenUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify(candiesFixture), { status: 200 });
    });

    const doc = await fetchSovereignMetadata('candies', CANDIES_CONTRACT, '7');
    expect(seenUrl).toBe('https://metadata.0xhoneyjar.xyz/mibera/candies/7');
    expect(doc.name).toBe('Test Candy');
  });
});
