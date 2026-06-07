import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import {
  sovereignMetadataUrl,
  fetchSovereignMetadata,
} from '../src/sovereign-metadata.js';
import { NotFoundError } from '../src/errors.js';

// Mibera Reveal GIF — chain 80094. Input lowercase on purpose: the resolver MUST
// checksum it before the registry lookup (EIP-55-consistent), not raw-case compare.
const GIF_CONTRACT = '0x230945e0ed56ef4de871a6c0695de265de23d8d8';
const TOKEN_ID = '100';

// Shaped like the live sovereign JSON for a GIF token (per the seam contract:
// name + description FROM the gif_metadata JSONB; image NORMALIZED to the sovereign
// host; NO attributes — the GIF has none, so the wire JSON has no `attributes` key
// and the resolver's mapAttributes yields []).
const gifFixture = {
  name: 'Mibera Reveal GIF #100',
  description: 'A hermetic Mibera reveal GIF.',
  image: 'https://assets.0xhoneyjar.xyz/Mibera/gif/100.gif',
};

/**
 * Hermetic: global fetch is mocked so the suite stays fully offline. The sovereign
 * path is the ONLY getNftMetadata branch that touches the network. GIF is the new
 * sovereign collection (slug "gif"); it reuses the merged generic resolver — no
 * resolver changes, just a registry row.
 */
describe('getNftMetadata — GIF sovereign path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the GIF sovereign URL and returns the decoded MetadataDocument', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // Confirms the resolver hits the GIF sovereign storage-api route,
      // not the MST/candies slug, not chain/sonar/codex.
      expect(url).toBe(sovereignMetadataUrl('gif', TOKEN_ID));
      expect(url).toBe('https://metadata.0xhoneyjar.xyz/mibera/gif/100');
      return new Response(JSON.stringify(gifFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const doc = await getNftMetadata(GIF_CONTRACT, TOKEN_ID);

    expect(doc.name).toBe('Mibera Reveal GIF #100');
    expect(doc.description).toBe('A hermetic Mibera reveal GIF.');
    expect(doc.image).toBe('https://assets.0xhoneyjar.xyz/Mibera/gif/100.gif');
    // GIF carries no attributes — the resolver yields an empty array.
    expect(doc.attributes).toEqual([]);
  });

  it('returns the plain MetadataDocument shape (no extra keys)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(gifFixture), { status: 200 })
    );

    const doc = await getNftMetadata(GIF_CONTRACT, TOKEN_ID);
    expect(Object.keys(doc).sort()).toEqual(
      ['attributes', 'description', 'image', 'name'].sort()
    );
  });

  it('throws NotFoundError on 403 (unminted) / 404 (absent)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const err = await getNftMetadata(GIF_CONTRACT, '999999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('999999');
  });

  it('does NOT collapse a 429 (throttle) into NotFound', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));

    const err = await getNftMetadata(GIF_CONTRACT, TOKEN_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotFoundError);
  });
});

describe('sovereign-metadata — GIF slug', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sovereignMetadataUrl("gif", ...) is the governed GIF route', () => {
    expect(sovereignMetadataUrl('gif', '100')).toBe(
      'https://metadata.0xhoneyjar.xyz/mibera/gif/100'
    );
  });

  it('fetchSovereignMetadata("gif", ...) hits the GIF route directly', async () => {
    let seenUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify(gifFixture), { status: 200 });
    });

    const doc = await fetchSovereignMetadata('gif', GIF_CONTRACT, '7');
    expect(seenUrl).toBe('https://metadata.0xhoneyjar.xyz/mibera/gif/7');
    expect(doc.name).toBe('Mibera Reveal GIF #100');
    expect(doc.attributes).toEqual([]);
  });
});
