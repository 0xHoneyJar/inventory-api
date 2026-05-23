import { describe, it, expect } from 'vitest';
import { codexToMetadataDocument, codexToNFT } from '../src/transform.js';
import type { CodexRecord, GrailRecord } from '../src/types-internal.js';

// Real Mibera codex token #1 (mibera-codex/_codex/data/miberas.jsonl).
const baseRecord: CodexRecord = {
  id: 1,
  archetype: 'Freetekno',
  ancestor: 'Greek',
  time_period: 'Modern',
  birthday: '07/21/1352 Ce 19:47',
  birth_coordinates: '72.866033, -40.860343',
  sun_sign: 'Cancer',
  moon_sign: 'Leo',
  ascending_sign: 'Scorpio',
  element: 'Earth',
  swag_rank: 'B',
  swag_score: 41,
  background: 'Fyre Festival',
  body: 'Umber',
  hair: 'Afro',
  eyes: 'Normal Grey',
  eyebrows: 'Anxious Thick',
  mouth: 'Cig',
  shirt: 'Htrk Night Faces',
  hat: null,
  glasses: 'Red Sunglasses',
  mask: null,
  earrings: null,
  face_accessory: 'Fluoro Pink',
  tattoo: null,
  item: 'Beads',
  drug: "St. John's Wort",
};

const grailRecord: GrailRecord = {
  id: 42,
  name: 'The Radiant Seraph',
  description: 'A legendary celestial being.',
};

const imageUrl = 'https://assets.0xhoneyjar.xyz/reveal_phase8/images/abc.png';
const grailImageUrl = 'https://assets.0xhoneyjar.xyz/Mibera/grails/air.webp';

describe('codexToMetadataDocument', () => {
  it('produces non-grail name from token ID', () => {
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    expect(doc.name).toBe('Mibera #1');
  });

  it('produces grail name from grail record', () => {
    const doc = codexToMetadataDocument('42', baseRecord, grailImageUrl, true, grailRecord);
    expect(doc.name).toBe('The Radiant Seraph');
  });

  it('falls back to Mibera Grail #N when no grail record', () => {
    const doc = codexToMetadataDocument('42', baseRecord, grailImageUrl, true, null);
    expect(doc.name).toBe('Mibera Grail #42');
  });

  it('image field equals the provided imageUrl', () => {
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    expect(doc.image).toBe(imageUrl);
  });

  it('description uses grail record description for grail tokens', () => {
    const doc = codexToMetadataDocument('42', baseRecord, grailImageUrl, true, grailRecord);
    expect(doc.description).toBe('A legendary celestial being.');
  });

  it('description auto-generated for non-grail includes archetype and element', () => {
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    expect(doc.description).toContain('Freetekno');
    expect(doc.description).toContain('Earth');
  });

  it('null fields are excluded from attributes', () => {
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    const nullFields = doc.attributes.filter(
      (a) => a.trait_type === 'hat' || a.trait_type === 'mask'
    );
    expect(nullFields).toHaveLength(0);
  });

  it('non-null fields are included in attributes', () => {
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    const archetypeAttr = doc.attributes.find((a) => a.trait_type === 'archetype');
    expect(archetypeAttr).toBeDefined();
    expect(archetypeAttr!.value).toBe('Freetekno');
  });

  it('grail token has Grail attribute appended', () => {
    const doc = codexToMetadataDocument('42', baseRecord, grailImageUrl, true, grailRecord);
    const grailAttr = doc.attributes.find((a) => a.trait_type === 'Grail');
    expect(grailAttr).toBeDefined();
    expect(grailAttr!.value).toBe('true');
  });

  it('non-grail token does not have Grail attribute', () => {
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    const grailAttr = doc.attributes.find((a) => a.trait_type === 'Grail');
    expect(grailAttr).toBeUndefined();
  });
});

describe('codexToNFT', () => {
  it('maps image -> imageUrl correctly', () => {
    const nft = codexToNFT('1', baseRecord, imageUrl, false, null);
    expect(nft.imageUrl).toBe(imageUrl);
    expect(nft).not.toHaveProperty('image');
  });

  it('contentType is image/png', () => {
    const nft = codexToNFT('1', baseRecord, imageUrl, false, null);
    expect(nft.contentType).toBe('image/png');
  });

  it('tokenId is passed through', () => {
    const nft = codexToNFT('1', baseRecord, imageUrl, false, null);
    expect(nft.tokenId).toBe('1');
  });

  it('name comes from codexToMetadataDocument', () => {
    const nft = codexToNFT('1', baseRecord, imageUrl, false, null);
    expect(nft.name).toBe('Mibera #1');
  });

  it('attributes are same as metadata document', () => {
    const nft = codexToNFT('1', baseRecord, imageUrl, false, null);
    const doc = codexToMetadataDocument('1', baseRecord, imageUrl, false, null);
    expect(nft.attributes).toEqual(doc.attributes);
  });
});
