import { describe, it, expect } from 'vitest';
import {
  codexToMetadataDocument,
  metadataDocumentToNFT,
  contentTypeForImageUrl,
} from '../src/transform.js';
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

// `codexToNFT` was removed with getNftsForOwner's codex join (bug 20260709-499c5a).
// Its coverage is replaced by direct tests of the two functions that now carry the
// mapping: metadataDocumentToNFT, and the contentType derivation it depends on.
describe('metadataDocumentToNFT', () => {
  const doc = {
    name: 'Mibera #1',
    description: 'a description',
    image: imageUrl,
    attributes: [{ trait_type: 'archetype', value: 'Freetekno' }],
  };

  it('maps image -> imageUrl and drops the image key', () => {
    const nft = metadataDocumentToNFT('1', doc);
    expect(nft.imageUrl).toBe(imageUrl);
    expect(nft).not.toHaveProperty('image');
  });

  it('passes tokenId, name, description and attributes through', () => {
    const nft = metadataDocumentToNFT('1', doc);
    expect(nft.tokenId).toBe('1');
    expect(nft.name).toBe('Mibera #1');
    expect(nft.description).toBe('a description');
    expect(nft.attributes).toEqual(doc.attributes);
  });

  it('always derives contentType from the image URL', () => {
    expect(metadataDocumentToNFT('1', doc).contentType).toBe('image/png');
    expect(metadataDocumentToNFT('1', { ...doc, image: 'https://x/a.webp' }).contentType).toBe(
      'image/webp'
    );
    expect(metadataDocumentToNFT('1', { ...doc, image: 'https://x/a.gif' }).contentType).toBe(
      'image/gif'
    );
  });
});

describe('contentTypeForImageUrl', () => {
  it.each([
    ['https://assets.0xhoneyjar.xyz/reveal_phase8/images/abc.png', 'image/png'],
    ['https://assets.0xhoneyjar.xyz/reveal_phase8/images/air.PNG', 'image/png'],
    ['https://assets.0xhoneyjar.xyz/Mibera/grails/air.webp', 'image/webp'],
    ['https://assets.0xhoneyjar.xyz/Mibera/gif/1.gif', 'image/gif'],
    ['https://x/a.jpg', 'image/jpeg'],
    ['https://x/a.jpeg', 'image/jpeg'],
    ['https://x/a.avif', 'image/avif'],
    ['https://x/a.svg', 'image/svg+xml'],
  ])('maps %s -> %s', (url, expected) => {
    expect(contentTypeForImageUrl(url)).toBe(expected);
  });

  // The real codex serves `air.PNG`, but an uppercase *png* cannot prove the
  // case-folding works: without `.toLowerCase()` it falls back to image/png, which
  // is the expected value anyway. Only an uppercase NON-png extension discriminates.
  it.each([
    ['https://x/a.WEBP', 'image/webp'],
    ['https://x/a.GIF', 'image/gif'],
    ['https://x/a.JpEg', 'image/jpeg'],
  ])('folds extension case: %s -> %s', (url, expected) => {
    expect(contentTypeForImageUrl(url)).toBe(expected);
  });

  it('ignores query strings and fragments', () => {
    expect(contentTypeForImageUrl('https://x/a.webp?v=2')).toBe('image/webp');
    expect(contentTypeForImageUrl('https://x/a.gif#frag')).toBe('image/gif');
  });

  it('falls back for an unknown extension, no extension, or empty url', () => {
    expect(contentTypeForImageUrl('https://x/a.tiff')).toBe('image/png');
    expect(contentTypeForImageUrl('https://x/noextension')).toBe('image/png');
    expect(contentTypeForImageUrl('')).toBe('image/png');
  });

  it('does not mistake a dot in a directory segment for an extension', () => {
    expect(contentTypeForImageUrl('https://x/v1.2/image')).toBe('image/png');
  });
});
