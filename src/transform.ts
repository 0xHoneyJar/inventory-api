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

// NOTE: `codexToNFT` lived here. It was reachable only from getNftsForOwner's codex
// join — the defect in bug 20260709-499c5a — and became unreachable when owner-lists
// moved to the sovereign resolver. Removed rather than left as dead code.
// `codexToMetadataDocument` above is still live: getNftMetadata uses it for contracts
// that are not in the collection registry.

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** Served when the URL carries no extension we recognise, or when there is no image. */
export const DEFAULT_CONTENT_TYPE = "image/png";

/**
 * Derive `contentType` from an image URL's extension.
 *
 * The sovereign collections do not all serve PNG: grail art is `.webp`
 * (`…/Mibera/grails/air.webp`) and the GIF collection is `.gif`
 * (`…/Mibera/gif/1.gif`). A hardcoded "image/png" would ship a payload whose
 * contentType contradicts its own imageUrl. Unknown/extensionless URLs keep the
 * historical default rather than guessing.
 */
export function contentTypeForImageUrl(imageUrl: string): string {
  const path = imageUrl.split(/[?#]/)[0] ?? "";
  const lastDot = path.lastIndexOf(".");
  // No dot, or the dot belongs to a directory segment rather than a filename.
  if (lastDot <= path.lastIndexOf("/")) return DEFAULT_CONTENT_TYPE;
  return (
    CONTENT_TYPE_BY_EXTENSION[path.slice(lastDot + 1).toLowerCase()] ?? DEFAULT_CONTENT_TYPE
  );
}

/**
 * Map a plain MetadataDocument to the honeyroad NFT shape.
 *
 * `contentType` is always derived from the image URL. There is deliberately no
 * caller-pinned override: the only path that ever pinned one was `codexToNFT`,
 * removed with the codex owner-list join (bug 20260709-499c5a).
 */
export function metadataDocumentToNFT(tokenId: string, doc: MetadataDocument): NFT {
  return {
    tokenId,
    name: doc.name,
    description: doc.description,
    imageUrl: doc.image,
    contentType: contentTypeForImageUrl(doc.image),
    attributes: doc.attributes,
  };
}
