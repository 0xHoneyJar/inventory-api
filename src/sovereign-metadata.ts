// Sovereign metadata resolver (collection-parameterized).
//
// Resolves a token's metadata from the sovereign storage-api URL contract:
//   https://metadata.0xhoneyjar.xyz/mibera/{collectionSlug}/{tokenId}
//
// This is the governed sovereign route (shipped 2026-05-01, "mst-sovereign-cutover";
// semver + 90d-deprecation). It mirrors `@freeside-storage/client`'s
//   lookupSovereignManifest({ world: "mibera", collection, tokenId })
// — that client package is private/workspace-only and pulls `effect`, so per the
// coordinator decision we mirror the governed route locally rather than vendor it
// (zero new runtime deps; global `fetch` only, the same primitive used in
// src/live-sonar.ts). If the route ever moves, keep this module in sync with the
// storage-api URL contract.
//
// Scope (amended, INV-A 2026-07-13): this module — the sovereign/mirror route,
// storage-api ONLY, no chain RPC, no tokenURI, no sonar GraphQL, no honeyroad —
// is scoped to collections we actually hold the rights to (Mibera-family,
// Purupuru). That used to be stated as an absolute rule ("the sovereign metadata
// source is THIS route ONLY") because every registered collection was ours. It
// no longer is: most third-party collections' LICENSES FORBID us from copying
// their art onto our CDN, so a collection we do not hold rights to must instead
// be POINTED AT (its own tokenURI + its own metadata host — see
// src/tokenuri-metadata.ts, `metadataStrategy: "tokenuri"`), never mirrored here.
// The rights gate is `rehost_policy` in src/collection-registry.ts
// (`assertRehostPolicyInvariant` enforces it at load time) — do NOT "fix" a
// collection back onto this sovereign path without an explicit human
// `rehost_policy: "mirror"` confirming we hold the rights; that is precisely
// the mistake this comment used to invite. The live JSON shape this route
// serves is `{ name, description, image, attributes: [{ trait_type, value }] }`
// (verified live).
//
// One slug per sovereign (mirror-hosted) collection (e.g. "mst", "candies",
// "fractures"). Adding one is a registry row in src/collection-registry.ts
// (slug + contract + explicit `rehost_policy: "mirror"`) — NOT a new function
// here. (Registry rows live in src/collection-registry.ts, not src/inventory.ts —
// this comment predated that extraction.) A collection may register MORE THAN
// ONE contract under one slug, e.g. "fractures" routes its ten contracts to a
// single slug.

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

// Owner-list resolution fans out one fetch per token, up to a 100-token page.
// Bound the in-flight count so a SINGLE inbound request cannot burst the origin.
//
// This is a PER-REQUEST cap, not a process-global semaphore: N concurrent inbound
// requests still open up to 8N sockets to the origin, and the service has no inbound
// rate limit or metadata cache. That gap is pre-existing (the external owner-list
// previously fanned out UNBOUNDED, up to 100 concurrent) and is tracked separately —
// do not read this constant as protecting the origin in aggregate.
//
// Unlike the timeout above this IS guarded: a NaN/zero limit would stall the
// worker pool rather than merely misconfigure a deadline.
export const METADATA_FETCH_CONCURRENCY = ((): number => {
  const raw = Number(process.env.METADATA_FETCH_CONCURRENCY ?? 8);
  return Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : 8;
})();

// Wall-clock budget for resolving ONE page of metadata, shared by every token in
// it. The per-fetch timeout above does not bound a page: a 100-token page at
// concurrency 8 is ceil(100/8) = 13 sequential waves, so a hung origin would cost
// 13 x 8s = 104s — far past the 30s service request timeout.
//
// The ceiling is NOT advisory. A budget at or above `DEFAULT_SECURITY.requestTimeoutMs`
// (30s, src/hyper/core/security.ts) lets a hung origin OUTLIVE the inbound request: the
// client gets a dropped request instead of a fail-soft page, while the detached handler
// keeps holding origin sockets to budget-end — precisely the hazard this budget exists
// to kill. So an over-large override is clamped rather than honored.
//
// The domain layer stays framework-free, so the budget < requestTimeoutMs relationship
// is pinned by a test (tests/metadata-page-budget.test.ts) rather than by importing
// hyper here. If either number moves, that test fails.
export const METADATA_PAGE_BUDGET_MAX_MS = 25_000;

export const METADATA_PAGE_BUDGET_MS = ((): number => {
  const raw = Number(process.env.METADATA_PAGE_BUDGET_MS ?? 15_000);
  const parsed = Number.isFinite(raw) && raw >= 1 ? Math.trunc(raw) : 15_000;
  return Math.min(parsed, METADATA_PAGE_BUDGET_MAX_MS);
})();

/** Outcome of resolving one page of sovereign metadata. */
export interface SovereignPageStats {
  /** Tokens whose fetch failed with a non-NotFound error. */
  failed: number;
  /** Tokens never attempted because the page budget was already spent. */
  skipped: number;
  total: number;
}

/**
 * A page of metadata came back degraded — 5xx, timeout, or network failure.
 *
 * This is NOT the same as a token having no metadata (403 unminted / 404 absent
 * → `NotFoundError`, which is expected and silent). Both fail-soft to imageless
 * NFTs so one bad token cannot fail a whole page, which makes this warning the
 * ONLY signal separating a degraded origin from legitimately absent tokens.
 * Without it, a CDN outage presents exactly like the fixture-miss defect this
 * path replaced: silent blank images and a null profile picture.
 *
 * Emitted once per page, not once per token — a 100-token page against a down
 * origin would otherwise flood the log with 100 identical lines.
 */
export function warnSovereignMetadataDegraded(
  label: string,
  stats: SovereignPageStats,
  err?: unknown
): void {
  const summary =
    `[inventory-api] sovereign metadata ${label} degraded; ` +
    `${stats.failed} failed, ${stats.skipped} skipped of ${stats.total} token(s); ` +
    `returning imageless NFTs`;

  // The page budget can expire while every ATTEMPTED fetch succeeded, leaving tokens
  // skipped but no error to report. Say so, rather than stringifying `undefined`.
  if (err === undefined) {
    console.warn(`${summary} \u2014 page budget exhausted`);
    return;
  }

  const detail = err instanceof Error ? err.message : String(err);
  console.warn(
    summary,
    // Upstream-derived text: collapse line breaks so a hostile origin cannot forge
    // or split log lines (CWE-117), and cap the length.
    detail.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, 300)
  );
}

// Sovereign collection slugs must be a stable, path-safe identifier (the slug is a
// URL path component). Constrain it so a malformed/hostile slug can't escape the
// route. Registered slugs today: "mst", "candies", "tarot", "gif", "fractures".
const SLUG_RE = /^[a-z0-9-]+$/;

function sovereignMetadataUrlImpl(
  world: string,
  collectionSlug: string | null,
  tokenId: string
): string {
  if (!SLUG_RE.test(world)) {
    throw new ValidationError("world", world, "lowercase slug [a-z0-9-]");
  }
  const encodedToken = encodeURIComponent(tokenId);
  if (collectionSlug === null) {
    return `${METADATA_BASE}/${encodeURIComponent(world)}/${encodedToken}`;
  }
  if (!SLUG_RE.test(collectionSlug)) {
    throw new ValidationError("collectionSlug", collectionSlug, "lowercase slug [a-z0-9-]");
  }
  return `${METADATA_BASE}/${encodeURIComponent(world)}/${encodeURIComponent(collectionSlug)}/${encodedToken}`;
}

/**
 * Sovereign storage-api URL for a token's metadata in a given world + collection.
 *
 * Mibera back-compat (2-arg): `sovereignMetadataUrl("candies", tokenId)` →
 *   `/mibera/candies/{tokenId}`
 *
 * General form (3-arg): `sovereignMetadataUrl(world, collectionSlug, tokenId)`
 *
 * `collectionSlug === null` with `world === "mibera"` resolves the WORLD'S NAMESAKE
 * collection (Mibera-main): `/{world}/{tokenId}` — NO collection path segment.
 */
export function sovereignMetadataUrl(collectionSlug: string, tokenId: string): string;
export function sovereignMetadataUrl(
  world: string,
  collectionSlug: string | null,
  tokenId: string
): string;
export function sovereignMetadataUrl(
  worldOrSlug: string,
  slugOrTokenId: string | null,
  tokenIdMaybe?: string
): string {
  if (tokenIdMaybe === undefined) {
    return sovereignMetadataUrlImpl("mibera", worldOrSlug, slugOrTokenId as string);
  }
  return sovereignMetadataUrlImpl(worldOrSlug, slugOrTokenId, tokenIdMaybe);
}

/** Back-compat: Mibera-world namesake route (`/mibera/{tokenId}`). */
export function miberaNamesakeMetadataUrl(tokenId: string): string {
  return sovereignMetadataUrlImpl("mibera", null, tokenId);
}

/**
 * Sovereign storage-api URL for an MST (Mibera Shadow) token's metadata.
 * Back-compat thin alias — MST is the sovereign slug "mst".
 */
export function mstMetadataUrl(tokenId: string): string {
  return sovereignMetadataUrlImpl("mibera", "mst", tokenId);
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
      // The sovereign contract permits string|number values; the public
      // MetadataDocument.Attribute.value is a string, so coerce (e.g. a numeric
      // candies "Price" trait becomes its string form). Same coercion MST used.
      value: String(a.value ?? ""),
    };
  });
}

async function fetchSovereignMetadataImpl(
  world: string,
  collectionSlug: string | null,
  contract: string,
  tokenId: string,
  options: { numericTokenId?: boolean; signal?: AbortSignal } = {}
): Promise<MetadataDocument> {
  const requireNumeric = options.numericTokenId ?? world === "mibera";
  if (requireNumeric && !/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }
  const label = collectionSlug ?? world;
  const url = sovereignMetadataUrlImpl(world, collectionSlug, tokenId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);
  // Abort on whichever fires first: this token's own timeout, or the caller's
  // page-wide budget (so a hung origin cannot cost timeout x number-of-waves).
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (cause) {
      // Network failure OR timeout-abort both land here (AbortError on timeout) —
      // surfaced as a clear throw; the downstream consumer fail-softs to imageless.
      throw new Error(
        `sovereign metadata fetch failed for ${label} token ${tokenId} (${url}): ${String(cause)}`
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
        `sovereign metadata fetch returned HTTP ${res.status} for ${label} token ${tokenId} (${url})`
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
        `sovereign metadata JSON parse failed for ${label} token ${tokenId} (${url}): ${String(cause)}`
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

/**
 * Resolve a token's metadata from the sovereign storage-api, by collection slug.
 *
 * Mibera back-compat (3-arg): `fetchSovereignMetadata("candies", contract, tokenId)`
 *
 * General form (4+ arg): `fetchSovereignMetadata(world, collectionSlug, contract, tokenId, options?)`
 *
 * - 403 (unminted) / 404 (absent): throws NotFoundError, mirroring the existing
 *   not-found semantics so callers treat an unminted/absent sovereign token the
 *   same as a missing codex token.
 * - other 4xx (401/429/…) / 5xx / network failure / timeout: throws a clear error
 *   (NOT swallowed here — the downstream consumer fail-softs to imageless). A
 *   throttle or auth blip is NOT collapsed into "token not found".
 * - 200: parses JSON and maps to the plain MetadataDocument interface, defensively.
 *
 * `contract` is carried through only to populate NotFoundError (caller-facing
 * identity); the route itself is keyed by `collectionSlug`.
 */
export async function fetchSovereignMetadata(
  collectionSlug: string,
  contract: string,
  tokenId: string
): Promise<MetadataDocument>;
export async function fetchSovereignMetadata(
  world: string,
  collectionSlug: string | null,
  contract: string,
  tokenId: string,
  options?: { numericTokenId?: boolean; signal?: AbortSignal }
): Promise<MetadataDocument>;
export async function fetchSovereignMetadata(
  worldOrSlug: string,
  slugOrContract: string | null,
  contractOrTokenId: string,
  tokenIdMaybe?: string,
  options: { numericTokenId?: boolean; signal?: AbortSignal } = {}
): Promise<MetadataDocument> {
  if (tokenIdMaybe === undefined) {
    return fetchSovereignMetadataImpl(
      "mibera",
      worldOrSlug,
      slugOrContract as string,
      contractOrTokenId
    );
  }
  return fetchSovereignMetadataImpl(
    worldOrSlug,
    slugOrContract,
    contractOrTokenId,
    tokenIdMaybe,
    options
  );
}

/**
 * Resolve MST (Mibera Shadow) metadata from the sovereign storage-api.
 * Back-compat thin alias — MST is the sovereign slug "mst". Behavior is identical
 * to the pre-generalization `fetchMstMetadata` (same timeout/abort/error-mapping/cap).
 */
export async function fetchMstMetadata(
  contract: string,
  tokenId: string
): Promise<MetadataDocument> {
  return fetchSovereignMetadata("mibera", "mst", contract, tokenId);
}
