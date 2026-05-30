// Sovereign MST (Mibera Shadow) metadata resolver.
//
// Mirrors `@freeside-storage/client`'s
//   lookupSovereignManifest({ world: "mibera", collection: "mst", tokenId })
// i.e. the sovereign url-contract for Mibera Shadow tokens. That client package is
// private/workspace-only and pulls `effect`, so per the coordinator decision we
// mirror the governed route locally rather than vendor it (zero new runtime deps;
// global `fetch` only, the same primitive used in src/live-sonar.ts).
//
// The route is governed by the storage-api URL contract (shipped 2026-05-01,
// "mst-sovereign-cutover"; semver + 90d-deprecation). If the route ever moves,
// keep this module in sync with that contract.
//
// Scope: MST metadata source is this SOVEREIGN storage-api route ONLY — no chain
// RPC, no tokenURI, no sonar GraphQL, no honeyroad. The live JSON shape is already
// `{ name, description, image, attributes: [{ trait_type, value }] }` (verified live).

import { NotFoundError } from "./errors.js";
import type { Attribute, MetadataDocument } from "../types.js";

const METADATA_BASE = "https://metadata.0xhoneyjar.xyz";

/** Sovereign storage-api URL for an MST (Mibera Shadow) token's metadata. */
export function mstMetadataUrl(tokenId: string): string {
  return `${METADATA_BASE}/mibera/mst/${tokenId}`;
}

/** Defensive coercion of the sovereign JSON `attributes` array. */
function mapAttributes(raw: unknown): Attribute[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const a = (entry ?? {}) as { trait_type?: unknown; value?: unknown };
    return {
      trait_type: String(a.trait_type ?? ""),
      value: String(a.value ?? ""),
    };
  });
}

/**
 * Resolve MST (Mibera Shadow) metadata from the sovereign storage-api.
 *
 * - 4xx (e.g. 403/404 — unminted tokens return 403): throws NotFoundError, mirroring
 *   the existing not-found semantics so callers treat an unminted/absent MST token the
 *   same as a missing codex token.
 * - other non-ok / network failure: throws a clear error (NOT swallowed here — the
 *   downstream consumer try/catches and fail-softs to imageless).
 * - 200: parses JSON and maps to the plain MetadataDocument interface, defensively.
 */
export async function fetchMstMetadata(
  contract: string,
  tokenId: string
): Promise<MetadataDocument> {
  const url = mstMetadataUrl(tokenId);

  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    throw new Error(
      `MST metadata fetch failed for token ${tokenId} (${url}): ${String(cause)}`
    );
  }

  if (!res.ok) {
    // Unminted tokens return 403; absent return 404. Any 4xx => not-found semantics.
    if (res.status >= 400 && res.status < 500) {
      throw new NotFoundError(tokenId, contract);
    }
    throw new Error(
      `MST metadata fetch returned HTTP ${res.status} for token ${tokenId} (${url})`
    );
  }

  let json: {
    name?: unknown;
    description?: unknown;
    image?: unknown;
    attributes?: unknown;
  };
  try {
    json = (await res.json()) as typeof json;
  } catch (cause) {
    throw new Error(
      `MST metadata JSON parse failed for token ${tokenId} (${url}): ${String(cause)}`
    );
  }

  return {
    name: typeof json.name === "string" ? json.name : "",
    description: typeof json.description === "string" ? json.description : "",
    image: typeof json.image === "string" ? json.image : "",
    attributes: mapAttributes(json.attributes),
  };
}
