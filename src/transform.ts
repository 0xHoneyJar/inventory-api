import type { CodexRecord, GrailRecord } from "./types-internal.js";
import type { MetadataDocument, NFT, Attribute } from "../types.js";

// Real Mibera codex traits surfaced as marketplace attributes (birthday +
// birth_coordinates are bio, intentionally excluded from the attribute grid).
const CODEX_TRAIT_FIELDS: (keyof CodexRecord)[] = [
  "archetype",
  "ancestor",
  "time_period",
  "sun_sign",
  "moon_sign",
  "ascending_sign",
  "element",
  "swag_rank",
  "swag_score",
  "background",
  "body",
  "hair",
  "eyes",
  "eyebrows",
  "mouth",
  "shirt",
  "hat",
  "glasses",
  "mask",
  "earrings",
  "face_accessory",
  "tattoo",
  "item",
  "drug",
];

function buildAttributes(record: CodexRecord, isGrailToken: boolean): Attribute[] {
  const attrs: Attribute[] = [];
  for (const field of CODEX_TRAIT_FIELDS) {
    const val = record[field];
    if (val !== null && val !== undefined) {
      attrs.push({ trait_type: field, value: String(val) });
    }
  }
  if (isGrailToken) {
    attrs.push({ trait_type: "Grail", value: "true" });
  }
  return attrs;
}

export function codexToMetadataDocument(
  tokenId: string,
  record: CodexRecord,
  imageUrl: string,
  isGrailToken: boolean,
  grailRecord: GrailRecord | null
): MetadataDocument {
  const name = isGrailToken
    ? (grailRecord?.name ?? `Mibera Grail #${tokenId}`)
    : `Mibera #${tokenId}`;

  let description: string;
  if (isGrailToken && grailRecord?.description) {
    description = grailRecord.description;
  } else {
    // TODO: replace with lore-generated descriptions from codex miberas/*.md
    const archetype = record.archetype ?? "Unknown";
    const ancestor = record.ancestor ?? "Unknown";
    const element = record.element ?? "Unknown";
    const sun_sign = record.sun_sign ?? "Unknown";
    description = `A ${archetype} of ${ancestor} origin, attuned to ${element}, born under ${sun_sign}.`;
  }

  return {
    name,
    description,
    image: imageUrl,
    attributes: buildAttributes(record, isGrailToken),
  };
}

export function codexToNFT(
  tokenId: string,
  record: CodexRecord,
  imageUrl: string,
  isGrailToken: boolean,
  grailRecord: GrailRecord | null
): NFT {
  const doc = codexToMetadataDocument(tokenId, record, imageUrl, isGrailToken, grailRecord);
  return {
    tokenId,
    name: doc.name,
    description: doc.description,
    imageUrl: doc.image, // renames image -> imageUrl for honeyroad shape
    contentType: "image/png", // All Mibera main tokens are PNG
    attributes: doc.attributes,
  };
}
