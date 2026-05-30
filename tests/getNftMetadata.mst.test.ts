import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getNftMetadata } from '../src/inventory.js';
import { mstMetadataUrl } from '../src/sovereign-metadata.js';
import { NotFoundError } from '../src/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

// Mibera Shadow (MST) contract — chain 80094. Input as all-lowercase on purpose:
// the resolver MUST checksum it before the registry lookup (EIP-55-consistent),
// not raw-case string compare.
const MST_CONTRACT = '0x048327a187b944ddac61c6e202bfccd20d17c008';
const TOKEN_ID = '234';

const mstFixture = JSON.parse(
  readFileSync(path.join(PKG_ROOT, 'fixtures/mst-token-234.json'), 'utf-8')
);

/**
 * Hermetic: global fetch is mocked so the suite stays fully offline. The MST path
 * is the ONLY getNftMetadata branch that touches the network (sovereign storage-api);
 * Mibera-main stays fixture-backed and fetch-free.
 */
describe('getNftMetadata — Mibera Shadow (MST) sovereign path', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves sovereign image + non-empty attributes for a minted token', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      // Confirms the resolver hits the sovereign storage-api route, not chain/sonar.
      expect(url).toBe(mstMetadataUrl(TOKEN_ID));
      return new Response(JSON.stringify(mstFixture), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const doc = await getNftMetadata(MST_CONTRACT, TOKEN_ID);

    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/generated/234.webp'
    );
    expect(Array.isArray(doc.attributes)).toBe(true);
    expect(doc.attributes.length).toBeGreaterThan(0);
    // attributes coerced to {trait_type, value} string pairs
    for (const attr of doc.attributes) {
      expect(typeof attr.trait_type).toBe('string');
      expect(typeof attr.value).toBe('string');
    }
    const bg = doc.attributes.find((a) => a.trait_type === 'background');
    expect(bg?.value).toBe('no more walls');
    expect(doc.name).toBe('MST #234');
  });

  it('returns the plain MetadataDocument shape (no extra keys)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify(mstFixture), { status: 200 })
    );

    const doc = await getNftMetadata(MST_CONTRACT, TOKEN_ID);
    expect(Object.keys(doc).sort()).toEqual(
      ['attributes', 'description', 'image', 'name'].sort()
    );
  });

  it('throws NotFoundError on 403 (unminted token)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 403 }));

    await expect(
      getNftMetadata(MST_CONTRACT, '999999')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError on 404', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));

    const err = await getNftMetadata(MST_CONTRACT, '999999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('999999');
  });

  it('throws (does NOT swallow) on a 500 so the caller can fail-soft', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 500 }));

    const err = await getNftMetadata(MST_CONTRACT, TOKEN_ID).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NotFoundError);
  });
});
