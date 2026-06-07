import { describe, it, expect, vi, afterEach } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

// Mibera-main is now the sovereign NAMESAKE collection (storage-api `/mibera/{id}`).
// The codex path still resolves UNKNOWN (unregistered) contracts, so these codex
// unit tests run against a non-registered address — deterministic, fixture-backed,
// no network. (Pre-sovereign-world this file used the Mibera-main address.)
const CODEX_CONTRACT = '0x000000000000000000000000000000000000C0DE';
const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
const GRAIL_TOKEN_ID = '2769';
const GRAIL_TOKEN_ID_2 = '876';
const NON_GRAIL_TOKEN_ID = '1';

describe('getNftMetadata — codex path (unknown contract)', () => {
  it('returns MetadataDocument shape with required fields', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc).toHaveProperty('name');
    expect(doc).toHaveProperty('description');
    expect(doc).toHaveProperty('image');
    expect(doc).toHaveProperty('attributes');
    expect(Array.isArray(doc.attributes)).toBe(true);
  });

  it('name follows Mibera #N pattern for generative token', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.name).toBe(`Mibera #${NON_GRAIL_TOKEN_ID}`);
  });

  it('image field is a URL string', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.image).toMatch(/^https?:\/\//);
  });

  it('image URL ends in .png', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.image).toMatch(/\.png$/);
  });

  it('attributes include trait_type and value strings', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    for (const attr of doc.attributes) {
      expect(typeof attr.trait_type).toBe('string');
      expect(typeof attr.value).toBe('string');
    }
  });

  it('generative token has at least 10 non-null attributes', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.attributes.length).toBeGreaterThanOrEqual(10);
  });

  it('grail token name comes from grail record', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, GRAIL_TOKEN_ID);
    expect(doc.name).toBe('Air');
  });

  it('grail token description comes from grail record', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, GRAIL_TOKEN_ID);
    expect(doc.description).toContain('Cloud');
  });

  it('grail token has Grail attribute set to true', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, GRAIL_TOKEN_ID);
    const grailAttr = doc.attributes.find((a) => a.trait_type === 'Grail');
    expect(grailAttr).toBeDefined();
    expect(grailAttr!.value).toBe('true');
  });

  it('second grail token (876) uses grail name', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, GRAIL_TOKEN_ID_2);
    expect(doc.name).toBe('Black Hole');
  });

  it('second grail token (876) description mentions black hole', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, GRAIL_TOKEN_ID_2);
    expect(doc.description).toContain('black hole');
  });

  it('throws NotFoundError for unknown token ID', async () => {
    await expect(
      getNftMetadata(CODEX_CONTRACT, '99999')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NotFoundError has correct tokenId and contract', async () => {
    const err = await getNftMetadata(CODEX_CONTRACT, '99999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('99999');
    expect(err.contract).toBe(CODEX_CONTRACT);
  });

  it('throws ValidationError for non-numeric tokenId', async () => {
    await expect(
      getNftMetadata(CODEX_CONTRACT, 'abc')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid contract address', async () => {
    await expect(
      getNftMetadata('not-a-contract', NON_GRAIL_TOKEN_ID)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('description for non-grail is auto-generated from archetype/ancestor/element/sun_sign', async () => {
    const doc = await getNftMetadata(CODEX_CONTRACT, NON_GRAIL_TOKEN_ID);
    // real codex token 1: archetype=Freetekno, ancestor=Greek, element=Earth, sun_sign=Cancer
    expect(doc.description).toContain('Freetekno');
    expect(doc.description).toContain('Greek');
    expect(doc.description).toContain('Earth');
    expect(doc.description).toContain('Cancer');
  });
});

describe('getNftMetadata — Mibera-main namesake (sovereign-world)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves Mibera-main from the sovereign NAMESAKE route (/mibera/{id}, no slug)', async () => {
    let calledUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          name: 'Ethiopian',
          description: 'Harari outfit with khat and scroll art spirals',
          image: 'https://assets.0xhoneyjar.xyz/Mibera/grails/ethiopian.webp',
          attributes: [{ trait_type: 'Ancestor', value: 'Harari' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const doc = await getNftMetadata(MIBERA_CONTRACT, '7702');

    // Namesake shape: NO collection slug segment between `mibera/` and the id.
    expect(calledUrl).toBe('https://metadata.0xhoneyjar.xyz/mibera/7702');
    expect(doc.name).toBe('Ethiopian');
    expect(doc.image).toBe(
      'https://assets.0xhoneyjar.xyz/Mibera/grails/ethiopian.webp'
    );
  });

  it('maps a sovereign 404 to NotFoundError', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(getNftMetadata(MIBERA_CONTRACT, '7702')).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
