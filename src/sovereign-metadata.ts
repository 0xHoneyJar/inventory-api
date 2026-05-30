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

import { NotFoundError, ValidationError } from "./errors.js";
import type { Attribute, MetadataDocument } from "../types.js";

const METADATA_BASE = "https://metadata.0xhoneyjar.xyz";

// Upstream (storage-api / CloudFront) is normally sub-second; bound it so a hung
// origin can't tie up an inventory-api request indefinitely. On timeout the
// AbortController fires → fetch rejects → mapped to the network-failure throw
// below (the consumer fail-softs to imageless). Overridable for tests/ops.
const METADATA_FETCH_TIMEOUT_MS = Number(
  process.env.METADATA_FETCH_TIMEOUT_MS ?? 8000
);

/** Sovereign storage-api URL for an MST (Mibera Shadow) token's metadata. */
export function mstMetadataUrl(tokenId: string): string {
  // Caller (getNftMetadata) already validates `^\d+$`, but encode defensively so
  // this helper is safe in isolation (no path-injection if reused elsewhere).
  return `${METADATA_BASE}/mibera/mst/${encodeURIComponent(tokenId)}`;
}

// Cap mapped attributes — a buggy/hostile upstream returning a giant array must
// not translate into unbounded work + payload here (real MST tokens carry ~19).
const MAX_ATTRIBUTES = 64;

/** Defensive coercion of the sovereign JSON `attributes` array (bounded). */
function mapAttributes(raw: unknown): Attribute[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ATTRIBUTES).map((entry) => {
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
 * - 403 (unminted) / 404 (absent): throws NotFoundError, mirroring the existing
 *   not-found semantics so callers treat an unminted/absent MST token the same as
 *   a missing codex token.
 * - other 4xx (401/429/…) / 5xx / network failure / timeout: throws a clear error
 *   (NOT swallowed here — the downstream consumer fail-softs to imageless). A
 *   throttle or auth blip is NOT collapsed into "token not found".
 * - 200: parses JSON and maps to the plain MetadataDocument interface, defensively.
 */
export async function fetchMstMetadata(
  contract: string,
  tokenId: string
): Promise<MetadataDocument> {
  // Enforce the numeric-token invariant at this exported boundary too (not only
  // in getNftMetadata) so direct/future callers can't build a malformed route.
  if (!/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }
  const url = mstMetadataUrl(tokenId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (cause) {
      // Network failure OR timeout-abort both land here (AbortError on timeout) —
      // surfaced as a clear throw; the downstream consumer fail-softs to imageless.
      throw new Error(
        `MST metadata fetch failed for token ${tokenId} (${url}): ${String(cause)}`
      );
    }

    if (!res.ok) {
      // 403 (unminted) / 404 (absent) => not-found. Other 4xx (401/429/…) are
      // transient/config errors, NOT "token absent": surface them as a thrown
      // error so a throttle or auth blip doesn't masquerade as a missing token.
      if (res.status === 403 || res.status === 404) {
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
  } finally {
    clearTimeout(timer);
  }
}
