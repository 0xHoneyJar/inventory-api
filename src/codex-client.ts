import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toChecksumAddress } from "./address.js";
import { FixtureLoadError, ValidationError } from "./errors.js";
import type { CodexRecord, GrailRecord, CollectionMeta } from "./types-internal.js";

interface CodexFixture {
  tokens: CodexRecord[];
  grails: GrailRecord[];
  imageUrls: Record<string, string>;
  collection: CollectionMeta;
}

function loadAndValidateFixture(filePath: string): CodexFixture {
  let raw: unknown;
  try {
    const content = readFileSync(filePath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new FixtureLoadError(filePath, err);
  }
  const r = raw as Record<string, unknown>;
  if (
    !Array.isArray(r.tokens) ||
    !Array.isArray(r.grails) ||
    typeof r.imageUrls !== "object" ||
    r.imageUrls === null ||
    typeof r.collection !== "object" ||
    r.collection === null
  ) {
    throw new FixtureLoadError(
      filePath,
      new Error("Missing required keys: tokens, grails, imageUrls, collection")
    );
  }
  const col = r.collection as Record<string, unknown>;
  if (col.totalSupply !== 10000) {
    throw new FixtureLoadError(
      filePath,
      new Error(`collection.totalSupply must be 10000, got ${col.totalSupply}`)
    );
  }
  return raw as CodexFixture;
}

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/codex-tokens.json", import.meta.url)
);
const _fixture = loadAndValidateFixture(FIXTURE_PATH);

const tokensById = new Map<string, CodexRecord>();
const grailsById = new Map<string, GrailRecord>();
const imageUrlsById = new Map<string, string>();
const collectionMetaByAddr = new Map<string, CollectionMeta>();

for (const token of _fixture.tokens) {
  tokensById.set(String(token.id), token);
}
for (const grail of _fixture.grails) {
  grailsById.set(String(grail.id), grail);
}
for (const [id, url] of Object.entries(_fixture.imageUrls)) {
  imageUrlsById.set(id, url as string);
}
const _col = _fixture.collection;
collectionMetaByAddr.set(toChecksumAddress(_col.contractAddress), _col);

export function getToken(tokenId: string): CodexRecord | null {
  return tokensById.get(tokenId) ?? null;
}

export function isGrail(tokenId: string): boolean {
  return grailsById.has(tokenId);
}

export function getGrailRecord(tokenId: string): GrailRecord | null {
  return grailsById.get(tokenId) ?? null;
}

export function getImageUrl(tokenId: string): string | null {
  return imageUrlsById.get(tokenId) ?? null;
}

export function getCollectionMeta(contractAddress: string): CollectionMeta {
  const meta = collectionMetaByAddr.get(toChecksumAddress(contractAddress));
  // A caller-supplied contract that isn't a registered collection is a client
  // input error (400), not an internal fault (500). Throw a typed ValidationError
  // (code INVENTORY_INVALID_INPUT) so toHyperError maps it to 400 with a safe
  // message and no internal-state leakage.
  if (!meta) {
    throw new ValidationError("contract", contractAddress, "registered collection address");
  }
  return meta;
}
