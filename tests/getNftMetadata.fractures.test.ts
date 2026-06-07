import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import {
  sovereignMetadataUrl,
  fetchSovereignMetadata,
} from '../src/sovereign-metadata.js';
import { NotFoundError } from '../src/errors.js';

// Fractures (Mibera "Fractured" set) — chain 80094. TEN contracts, ALL routed to
// the SINGLE sovereign slug "fractures" (routing is by contract address; the slug
// is shared). Inputs are lowercase on purpose: the resolver MUST checksum each
// before the registry lookup (EIP-55-consistent), not raw-case string compare.
//
// Two distinct fractures contracts are exercised here to prove the "10 contracts →
// 1 slug" routing: parcels (the first registered address) and a reveal_phase
// contract. Both must resolve to the SAME .../mibera/fractures/{tokenId} path.
const FRACTURES_PARCELS = '0x86db98cf1b81e833447b12a077ac28c36b75c8e1'; // miparcels
const FRACTURES_REVEAL = '0x144b27b1a267ee71989664b3907030da84cc4754'; // mireveal #1.1
const FRACTURES_LADIES = '0x8d4972bd5d2df474e71da6676a365fb549853991'; // miladies
const TOKEN_ID = '1';

// MST + candies stay in-file as the regression guard that registering ten more
// sovereign contracts under one slug did not perturb the existing collections.
const MST_CONTRACT = '0x048327a187b944ddac61c6e202bfccd20d17c008';
const CANDIES_CONTRACT = '0xeca03517c5195f1edd634da6d690d6c72407c40c';

// Shaped like the live sovereign JSON for a fractures token (per the seam contract:
// the storage-api projects the canonical fracture_expanded row — codex/Mibera shape,
// flattened trait columns → attributes; "swag score" numeric on the wire; image is
// the sovereign host normalized from the phase-1 image hash). The resolver consumes
// the SAME { name, description, image, attributes } contract every sovereign slug
// uses — no per-collection transform here.
const fracturesFixture = {
  name: 'Fracture #1',
  description: 'A fractured Mibera.',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/fractures/8a7e39404ebf.png',
  attributes: [
    { trait_type: 'Background', value: 'no more walls' },
    { trait_type: 'Archetype', value: 'wanderer' },
    { trait_type: 'Sun Sign', value: 'aries' },
    { trait_type: 'Swag Rank', value: 'S' },
    // numeric on the wire (the "swag score" column is an integer) — coerced to
    // string by the generic resolver's mapAttributes, same as candies' Price.
    { trait_type: 'Swag Score', value: 9001 },
  ],
};

const mstFixture = {
  name: 'MST #234',
  description: 'shadow',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/generated/234.webp',
  attributes: [{ trait_type: 'background', value: 'no more walls' }],
};

const candiesFixture = {
  name: 'Test Candy',
  description: 'A hermetic candies listing.',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/Drugs/candy-1.png',
  attributes: [{ trait_type: 'Category', value: 'edibles' }],
};

/**
 * Hermetic: global fetch is mocked so the suite stays fully offline. The sovereign
 * path is the ONLY getNftMetadata branch that touches the network. Fractures is the
 * new sovereign collection (slug "fractures") — TEN contracts, ONE slug. It reuses
 * the merged generic resolver: no resolver changes, just ten registry rows pointing
 * at the same slug.
 */
describe('getNftMetadata — Fractures sovereign path (10 contracts → 1 slug)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the fractures sovereign URL and returns the decoded MetadataDocument', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // Confirms the resolver hits the fractures sovereign storage-api route,
      // not the MST/candies slug, not chain/sonar/codex.
      expect(url).toBe(sovereignMetadataUrl('fractures', TOKEN_ID));
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/fractures/1');
      return new Response(JSON.stringify(fracturesFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const doc = await getNftMetadata(FRACTURES_PARCELS, TOKEN_ID);

    expect(doc.name).toBe('Fracture #1');
    expect(doc.description).toBe('A fractured Mibera.');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/fractures/8a7e39404ebf.png'
    );
    // Codex-shape attributes pass through; numeric "Swag Score" is coerced to string.
    expect(doc.attributes).toEqual([
      { trait_type: 'Background', value: 'no more walls' },
      { trait_type: 'Archetype', value: 'wanderer' },
      { trait_type: 'Sun Sign', value: 'aries' },
      { trait_type: 'Swag Rank', value: 'S' },
      { trait_type: 'Swag Score', value: '9001' },
    ]);
  });

  it('routes a SECOND fractures contract to the SAME slug path', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(fracturesFixture), { status: 200 });
    });

    // Two distinct registered contracts (parcels + a reveal_phase contract) must
    // both resolve to the identical fractures route for the same tokenId — the
    // proof that all ten contracts share one slug, routed by address.
    await getNftMetadata(FRACTURES_PARCELS, '5');
    await getNftMetadata(FRACTURES_REVEAL, '5');

    expect(seen).toEqual([
      'https://metadata.0xhoneyjar.xyz/mibera/fractures/5',
      'https://metadata.0xhoneyjar.xyz/mibera/fractures/5',
    ]);
    expect(seen[0]).toBe(seen[1]);
  });

  it('resolves a THIRD fractures contract (miladies) to the same slug', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/fractures/42');
      return new Response(JSON.stringify(fracturesFixture), { status: 200 });
    });

    const doc = await getNftMetadata(FRACTURES_LADIES, '42');
    expect(doc.name).toBe('Fracture #1');
  });

  it('checksum-routes a lowercase fractures address (EIP-55-consistent)', async () => {
    // Lowercase input (above) already exercises this, but assert explicitly: the
    // registry is keyed by checksum, so a raw-lowercase contract must still route.
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(fracturesFixture), { status: 200 })
    );
    const doc = await getNftMetadata(FRACTURES_PARCELS.toLowerCase(), '7');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/fractures/8a7e39404ebf.png'
    );
  });

  it('returns the plain MetadataDocument shape (no extra keys)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(fracturesFixture), { status: 200 })
    );

    const doc = await getNftMetadata(FRACTURES_PARCELS, TOKEN_ID);
    expect(Object.keys(doc).sort()).toEqual(
      ['attributes', 'description', 'image', 'name'].sort()
    );
  });

  it('throws NotFoundError on 403 (unminted) / 404 (absent)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const err = await getNftMetadata(FRACTURES_PARCELS, '999999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('999999');
  });

  it('does NOT collapse a 429 (throttle) into NotFound', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));

    const err = await getNftMetadata(FRACTURES_REVEAL, TOKEN_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotFoundError);
  });
});

describe('getNftMetadata — MST + candies regression (fractures registered)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still resolves the MST sovereign URL — slug "mst" unchanged', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/mst/234');
      return new Response(JSON.stringify(mstFixture), { status: 200 });
    });

    const doc = await getNftMetadata(MST_CONTRACT, '234');
    expect(doc.name).toBe('MST #234');
  });

  it('still resolves the candies sovereign URL — slug "candies" unchanged', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/candies/1');
      return new Response(JSON.stringify(candiesFixture), { status: 200 });
    });

    const doc = await getNftMetadata(CANDIES_CONTRACT, '1');
    expect(doc.name).toBe('Test Candy');
  });
});

describe('sovereign-metadata — fractures slug', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sovereignMetadataUrl("fractures", ...) is the governed fractures route', () => {
    expect(sovereignMetadataUrl('fractures', '1')).toBe(
      'https://metadata.0xhoneyjar.xyz/mibera/fractures/1'
    );
  });

  it('fetchSovereignMetadata("fractures", ...) hits the fractures route directly', async () => {
    let seenUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify(fracturesFixture), { status: 200 });
    });

    const doc = await fetchSovereignMetadata('fractures', FRACTURES_PARCELS, '7');
    expect(seenUrl).toBe('https://metadata.0xhoneyjar.xyz/mibera/fractures/7');
    expect(doc.name).toBe('Fracture #1');
  });
});
