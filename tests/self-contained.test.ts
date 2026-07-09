import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');

/**
 * Self-contained tests: verify fixture integrity and that the module
 * exposes the correct public API surface without importing the full module.
 * Fixtures are generated from the real Mibera codex; grails 2769 ("Air") and
 * 876 ("Black Hole") are the pinned grail token IDs.
 */
describe('fixture integrity', () => {
  const sonarFixture = JSON.parse(
    readFileSync(path.join(PKG_ROOT, 'fixtures/sonar-trackedholders.json'), 'utf-8')
  );
  const codexFixture = JSON.parse(
    readFileSync(path.join(PKG_ROOT, 'fixtures/codex-tokens.json'), 'utf-8')
  );

  it('sonar fixture has trackedHolders array', () => {
    expect(Array.isArray(sonarFixture.trackedHolders)).toBe(true);
  });

  it('sonar fixture has tokens array', () => {
    expect(Array.isArray(sonarFixture.tokens)).toBe(true);
  });

  it('sonar fixture has at least 5 distinct holder addresses', () => {
    const addresses = new Set(
      sonarFixture.trackedHolders.map((h: { address: string }) => h.address.toLowerCase())
    );
    expect(addresses.size).toBeGreaterThanOrEqual(5);
  });

  it('sonar fixture has at least 12 token rows for address 0x111...1', () => {
    const addr = '0x1111111111111111111111111111111111111111';
    const tokens = sonarFixture.tokens.filter(
      (t: { owner: string }) => t.owner.toLowerCase() === addr.toLowerCase()
    );
    expect(tokens.length).toBeGreaterThanOrEqual(12);
  });

  it('sonar fixture contains grail token ID 2769', () => {
    const has = sonarFixture.tokens.some((t: { tokenId: string }) => t.tokenId === '2769');
    expect(has).toBe(true);
  });

  it('sonar fixture contains grail token ID 876', () => {
    const has = sonarFixture.tokens.some((t: { tokenId: string }) => t.tokenId === '876');
    expect(has).toBe(true);
  });

  it('all sonar tokens have blockNumber', () => {
    for (const token of sonarFixture.tokens) {
      expect(typeof token.blockNumber).toBe('number');
    }
  });

  it('all sonar trackedHolders have blockNumber', () => {
    for (const holder of sonarFixture.trackedHolders) {
      expect(typeof holder.blockNumber).toBe('number');
    }
  });

  it('max blockNumber in sonar fixture is 9123456', () => {
    const allBlockNumbers = [
      ...sonarFixture.trackedHolders.map((h: { blockNumber: number }) => h.blockNumber),
      ...sonarFixture.tokens.map((t: { blockNumber: number }) => t.blockNumber),
    ];
    const max = Math.max(...allBlockNumbers);
    expect(max).toBe(9123456);
  });

  it('codex fixture has tokens array', () => {
    expect(Array.isArray(codexFixture.tokens)).toBe(true);
  });

  it('codex fixture has grails array', () => {
    expect(Array.isArray(codexFixture.grails)).toBe(true);
  });

  it('codex fixture has grail entry for token 2769', () => {
    const grail = codexFixture.grails.find((g: { id: number }) => g.id === 2769);
    expect(grail).toBeDefined();
    expect(grail.name).toBeDefined();
    expect(grail.description).toBeDefined();
  });

  it('codex fixture has grail entry for token 876', () => {
    const grail = codexFixture.grails.find((g: { id: number }) => g.id === 876);
    expect(grail).toBeDefined();
    expect(grail.name).toBeDefined();
  });

  it('codex fixture collection.totalSupply is 10000', () => {
    expect(codexFixture.collection.totalSupply).toBe(10000);
  });

  it('codex fixture collection.contractAddress is Mibera contract', () => {
    expect(codexFixture.collection.contractAddress).toBe(
      '0x6666397DFe9a8c469BF65dc744CB1C733416c420'
    );
  });

  it('codex fixture imageUrls cover every token in the codex fixture itself', () => {
    // Internal consistency of the codex sample. It deliberately no longer needs to
    // mirror the sonar fixture — see the orphan-token guard below.
    for (const token of codexFixture.tokens) {
      expect(codexFixture.imageUrls[String(token.id)]).toBeDefined();
    }
  });

  it('sonar fixture holds at least one token ABSENT from the codex fixture', () => {
    // Regression guard for bug 20260709-499c5a. These fixtures used to be mutually
    // consistent — every sonar token id had a codex record — which made the
    // codex-miss branch structurally unreachable and hid a defect that blanked the
    // owner-list for ~99.5% of production holders. At least one orphan must remain
    // so the sovereign metadata path is exercised hermetically.
    const codexTokenIds = new Set<string>([
      ...codexFixture.tokens.map((t: { id: number }) => String(t.id)),
      ...codexFixture.grails.map((g: { id: number }) => String(g.id)),
    ]);
    const orphans = sonarFixture.tokens
      .map((t: { tokenId: string }) => t.tokenId)
      .filter((id: string) => !codexTokenIds.has(id));

    expect(orphans).toContain('8485');
  });

  it('codex generative tokens have at least 10 non-null trait fields', () => {
    const TRAIT_FIELDS = [
      'archetype', 'ancestor', 'time_period', 'sun_sign', 'moon_sign',
      'ascending_sign', 'element', 'swag_rank', 'swag_score', 'background',
      'body', 'hair', 'eyes', 'eyebrows', 'mouth', 'shirt', 'hat', 'glasses',
      'mask', 'earrings', 'face_accessory', 'tattoo', 'item', 'drug',
    ];
    for (const token of codexFixture.tokens) {
      const nonNullCount = TRAIT_FIELDS.filter(
        (f) => token[f] !== null && token[f] !== undefined
      ).length;
      expect(nonNullCount).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('public API surface', () => {
  it('index.ts exports getHoldings', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.getHoldings).toBe('function');
  });

  it('index.ts exports getNftsForOwner', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.getNftsForOwner).toBe('function');
  });

  it('index.ts exports getNftMetadata', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.getNftMetadata).toBe('function');
  });

  it('index.ts exports FixtureLoadError', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.FixtureLoadError).toBe('function');
  });

  it('index.ts exports ValidationError', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.ValidationError).toBe('function');
  });

  it('index.ts exports NotFoundError', async () => {
    const mod = await import('../index.js');
    expect(typeof mod.NotFoundError).toBe('function');
  });
});
