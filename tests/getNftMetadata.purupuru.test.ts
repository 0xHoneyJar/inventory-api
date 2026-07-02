import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import { sovereignMetadataUrl } from '../src/sovereign-metadata.js';
import { PURUPURU_CONTRACT } from '../src/collection-registry.js';

const TOKEN_ID = '1';

describe('getNftMetadata — Purupuru external EVM sovereign path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves metadata against purupuru world, not mibera', async () => {
    const fixture = {
      name: 'Purupuru #1',
      description: 'test',
      image: 'https://assets.0xhoneyjar.xyz/purupuru/1.webp',
      attributes: [],
    };

    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toBe(sovereignMetadataUrl('purupuru', 'genesis', TOKEN_ID));
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const doc = await getNftMetadata(PURUPURU_CONTRACT, TOKEN_ID);

    expect(doc.name).toBe('Purupuru #1');
    expect(doc.image).toBe(fixture.image);
  });
});
