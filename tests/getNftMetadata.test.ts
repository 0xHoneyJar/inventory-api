import { describe, it, expect } from 'vitest';
import { getNftMetadata } from '../src/inventory.js';
import { NotFoundError, ValidationError } from '../src/errors.js';

const MIBERA_CONTRACT = '0x6666397DFe9a8c469BF65dc744CB1C733416c420';
const GRAIL_TOKEN_ID = '2769';
const GRAIL_TOKEN_ID_2 = '876';
const NON_GRAIL_TOKEN_ID = '1';

describe('getNftMetadata', () => {
  it('returns MetadataDocument shape with required fields', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc).toHaveProperty('name');
    expect(doc).toHaveProperty('description');
    expect(doc).toHaveProperty('image');
    expect(doc).toHaveProperty('attributes');
    expect(Array.isArray(doc.attributes)).toBe(true);
  });

  it('name follows Mibera #N pattern for generative token', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.name).toBe(`Mibera #${NON_GRAIL_TOKEN_ID}`);
  });

  it('image field is a URL string', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.image).toMatch(/^https?:\/\//);
  });

  it('image URL ends in .png', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.image).toMatch(/\.png$/);
  });

  it('attributes include trait_type and value strings', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    for (const attr of doc.attributes) {
      expect(typeof attr.trait_type).toBe('string');
      expect(typeof attr.value).toBe('string');
    }
  });

  it('generative token has at least 10 non-null attributes', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    expect(doc.attributes.length).toBeGreaterThanOrEqual(10);
  });

  it('grail token name comes from grail record', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, GRAIL_TOKEN_ID);
    expect(doc.name).toBe('Air');
  });

  it('grail token description comes from grail record', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, GRAIL_TOKEN_ID);
    expect(doc.description).toContain('Cloud');
  });

  it('grail token has Grail attribute set to true', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, GRAIL_TOKEN_ID);
    const grailAttr = doc.attributes.find((a) => a.trait_type === 'Grail');
    expect(grailAttr).toBeDefined();
    expect(grailAttr!.value).toBe('true');
  });

  it('second grail token (876) uses grail name', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, GRAIL_TOKEN_ID_2);
    expect(doc.name).toBe('Black Hole');
  });

  it('second grail token (876) description mentions black hole', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, GRAIL_TOKEN_ID_2);
    expect(doc.description).toContain('black hole');
  });

  it('throws NotFoundError for unknown token ID', async () => {
    await expect(
      getNftMetadata(MIBERA_CONTRACT, '99999')
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('NotFoundError has correct tokenId and contract', async () => {
    const err = await getNftMetadata(MIBERA_CONTRACT, '99999').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.tokenId).toBe('99999');
    expect(err.contract).toBe(MIBERA_CONTRACT);
  });

  it('throws ValidationError for non-numeric tokenId', async () => {
    await expect(
      getNftMetadata(MIBERA_CONTRACT, 'abc')
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws ValidationError for invalid contract address', async () => {
    await expect(
      getNftMetadata('not-a-contract', NON_GRAIL_TOKEN_ID)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('description for non-grail is auto-generated from archetype/ancestor/element/sun_sign', async () => {
    const doc = await getNftMetadata(MIBERA_CONTRACT, NON_GRAIL_TOKEN_ID);
    // real codex token 1: archetype=Freetekno, ancestor=Greek, element=Earth, sun_sign=Cancer
    expect(doc.description).toContain('Freetekno');
    expect(doc.description).toContain('Greek');
    expect(doc.description).toContain('Earth');
    expect(doc.description).toContain('Cancer');
  });
});
