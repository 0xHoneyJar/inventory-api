import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import {
  sovereignMetadataUrl,
  fetchSovereignMetadata,
} from '../src/sovereign-metadata.js';
import { NotFoundError } from '../src/errors.js';

// Tarot / Archetype — chain 80094. Input lowercase on purpose: the resolver MUST
// checksum it before the registry lookup (EIP-55-consistent), not raw-case string
// compare. tokenId === quiz_metadata.tokenid (integer PK).
const TAROT_CONTRACT = '0x4b08a069381efbb9f08c73d6b2e975c9be3c4684';
// Candies stays in this file as the regression guard that registering a SECOND
// sovereign slug did not disturb the first fan-out's routing.
const CANDIES_CONTRACT = '0xeca03517c5195f1edd634da6d690d6c72407c40c';
const TOKEN_ID = '1';

// Shaped like the live sovereign JSON for a tarot token (per the seam contract:
// the pre-formatted OpenSea-style doc from quiz_metadata.metadata, with the image
// already normalized to the sovereign assets host
// assets.0xhoneyjar.xyz/Mibera/quiz_archetypes/{tokenId}.webp). value may be
// string|number on the wire.
const tarotFixture = {
  name: 'The Magician',
  description: 'A hermetic tarot archetype.',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/quiz_archetypes/1.webp',
  attributes: [
    { trait_type: 'Arcana', value: 'Major' },
    { trait_type: 'Number', value: 1 },
    { trait_type: 'Element', value: 'Air' },
  ],
};

const candiesFixture = {
  name: 'Test Candy',
  description: 'A hermetic candies listing.',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/Drugs/candy-1.png',
  attributes: [{ trait_type: 'Category', value: 'edibles' }],
};

/**
 * Hermetic: global fetch is mocked so the suite stays fully offline. The sovereign
 * path is the ONLY getNftMetadata branch that touches the network; Mibera-main stays
 * fixture-backed and fetch-free. Tarot is the new sovereign collection (fan-out #1);
 * the candies assertions are the regression guard that registering a second slug did
 * not change candies behavior.
 */
describe('getNftMetadata — Tarot sovereign path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the tarot sovereign URL and returns the decoded MetadataDocument', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // Confirms the resolver hits the tarot sovereign storage-api route,
      // not the candies/mst slug, not chain/sonar/codex.
      expect(url).toBe(sovereignMetadataUrl('tarot', TOKEN_ID));
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/tarot/1');
      return new Response(JSON.stringify(tarotFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const doc = await getNftMetadata(TAROT_CONTRACT, TOKEN_ID);

    expect(doc.name).toBe('The Magician');
    expect(doc.description).toBe('A hermetic tarot archetype.');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/quiz_archetypes/1.webp'
    );
    // attributes coerced to {trait_type, value} string pairs (numeric Number -> "1")
    expect(doc.attributes).toEqual([
      { trait_type: 'Arcana', value: 'Major' },
      { trait_type: 'Number', value: '1' },
      { trait_type: 'Element', value: 'Air' },
    ]);
  });

  it('returns the plain MetadataDocument shape (no extra keys)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(tarotFixture), { status: 200 })
    );

    const doc = await getNftMetadata(TAROT_CONTRACT, TOKEN_ID);
    expect(Object.keys(doc).sort()).toEqual(
      ['attributes', 'description', 'image', 'name'].sort()
    );
  });

  it('throws NotFoundError on 403 (unminted) / 404 (absent)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const err = await getNftMetadata(TAROT_CONTRACT, '999999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('999999');
  });

  it('does NOT collapse a 429 (throttle) into NotFound', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));

    const err = await getNftMetadata(TAROT_CONTRACT, TOKEN_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotFoundError);
  });
});

describe('getNftMetadata — Candies regression (second slug registered)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still resolves the candies sovereign URL — slug "candies" unchanged', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // Registering "tarot" must not change the route candies resolves to.
      expect(url).toBe(sovereignMetadataUrl('candies', TOKEN_ID));
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/candies/1');
      return new Response(JSON.stringify(candiesFixture), { status: 200 });
    });

    const doc = await getNftMetadata(CANDIES_CONTRACT, TOKEN_ID);
    expect(doc.name).toBe('Test Candy');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/Drugs/candy-1.png'
    );
  });
});

describe('sovereign-metadata — tarot slug routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchSovereignMetadata("tarot", ...) hits the tarot route directly', async () => {
    let seenUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify(tarotFixture), { status: 200 });
    });

    const doc = await fetchSovereignMetadata('tarot', TAROT_CONTRACT, '7');
    expect(seenUrl).toBe('https://metadata.0xhoneyjar.xyz/mibera/tarot/7');
    expect(doc.name).toBe('The Magician');
  });
});
