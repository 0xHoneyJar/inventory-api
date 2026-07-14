// Third-party ("proxy") metadata resolver — INV-A.
//
// Points at a collection's OWN on-chain tokenURI + its own metadata host,
// rather than mirroring it into our storage-api CDN (src/sovereign-metadata.ts).
// This is the resolution mechanism for `rehost_policy: "proxy"` rows in
// src/collection-registry.ts — collections whose license forbids us from
// re-hosting their art (Azuki today; every future onboard by default).
//
// Design: resolve the collection's ERC-721 baseURI ONCE via a single
// `tokenURI(tokenId)` eth_call, then every subsequent tokenId for that
// contract is pure string concatenation — `${baseURI}${tokenId}`, zero RPC.
// This is the shape that keeps a roster fan-out (getProfilePicture is called
// per member; a single owner-list page can carry up to 100 tokens) from
// making one blockchain call per token, which would be catastrophic at
// collection scale (Azuki alone is 10,000 tokens / 4,406 tracked holders).
//
// loa:shortcut: assumes `tokenURI(id) === \`${baseURI}${id}\`` — Azuki's
// actual contract shape (plain concat, no suffix, no per-token override;
// verified live 2026-07-13 against tokenURI(4442) on mainnet). A collection
// whose baseURI changes on reveal, or that overrides individual tokenURIs,
// breaks this assumption — the endswith() guard below throws rather than
// silently deriving a wrong baseURI. Upgrade trigger: if a registered
// tokenuri collection reveals mid-flight (or a future collection needs
// per-token tokenURI calls), bust `baseUriCache` — today that means a
// process restart; add a TTL or an explicit invalidation hook if this
// becomes a recurring operational need.

import { NotFoundError, ValidationError } from "./errors.js";
import type { Attribute, MetadataDocument } from "../types.js";

// ── RPC endpoint config (per chain, env-overridable) ───────────────────────

// Free, load-bearing-verified public endpoints (operator note 2026-07-12:
// "Free RPCs that survive load" — publicnode has been the one that holds up
// under real traffic for Ethereum mainnet). Only chain 1 is needed today
// (Azuki is the registry's first chain-1 row); add more as tokenuri
// collections land on other chains.
const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://ethereum.publicnode.com",
};

/** RPC endpoint for a chain — `RPC_URL_<chainId>` env override, else the default. */
function rpcUrlForChain(chainId: number): string {
  const override = process.env[`RPC_URL_${chainId}`];
  if (override && override.length > 0) return override;
  const fallback = DEFAULT_RPC_URLS[chainId];
  if (!fallback) {
    throw new Error(
      `no RPC endpoint configured for chain ${chainId} (set RPC_URL_${chainId})`
    );
  }
  return fallback;
}

// ── IPFS gateway config (a config value, not a hardcoded string) ───────────

const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";

function ipfsGatewayBase(): string {
  const override = process.env.IPFS_GATEWAY_URL;
  const base = override && override.length > 0 ? override : DEFAULT_IPFS_GATEWAY;
  return base.endsWith("/") ? base : `${base}/`;
}

/** Rewrite an `ipfs://CID/path` URI through the configured gateway; pass through anything else. */
export function resolveIpfsUri(uri: string): string {
  if (!uri.startsWith("ipfs://")) return uri;
  return `${ipfsGatewayBase()}${uri.slice("ipfs://".length)}`;
}

// ── Minimal ABI encode/decode for `tokenURI(uint256) returns (string)` ─────
//
// ERC-721's tokenURI selector is fixed by the interface (keccak256("tokenURI(uint256)")
// first 4 bytes) — a well-known constant, not derived per call.
const TOKEN_URI_SELECTOR = "c87b56dd";

function encodeTokenUriCalldata(tokenId: string): string {
  const id = BigInt(tokenId);
  if (id < 0n) {
    throw new ValidationError("tokenId", tokenId, "non-negative integer");
  }
  return `0x${TOKEN_URI_SELECTOR}${id.toString(16).padStart(64, "0")}`;
}

/** Decode a single dynamic `string` ABI return value (standard head+length+data layout). */
function decodeAbiString(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length < 128) {
    throw new Error(`ABI string response too short to decode: 0x${clean}`);
  }
  const offsetWords = parseInt(clean.slice(0, 64), 16);
  const lengthStart = offsetWords * 2;
  const lengthHex = clean.slice(lengthStart, lengthStart + 64);
  if (lengthHex.length < 64) {
    throw new Error(`ABI string response truncated at length word: 0x${clean}`);
  }
  const length = parseInt(lengthHex, 16);
  const dataStart = lengthStart + 64;
  const dataHex = clean.slice(dataStart, dataStart + length * 2);
  if (dataHex.length < length * 2) {
    throw new Error(`ABI string response truncated at data: 0x${clean}`);
  }
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

interface JsonRpcResponse {
  result?: string;
  error?: { message?: string };
}

async function ethCallTokenUri(
  rpcUrl: string,
  contract: string,
  tokenId: string,
  signal: AbortSignal
): Promise<string> {
  const data = encodeTokenUriCalldata(tokenId);
  let res: Response;
  try {
    res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to: contract, data }, "latest"],
      }),
      signal,
    });
  } catch (cause) {
    throw new Error(
      `tokenURI RPC call failed for ${contract} token ${tokenId} (${rpcUrl}): ${String(cause)}`
    );
  }
  if (!res.ok) {
    throw new Error(`tokenURI RPC returned HTTP ${res.status} for ${contract} (${rpcUrl})`);
  }
  let body: JsonRpcResponse;
  try {
    body = (await res.json()) as JsonRpcResponse;
  } catch (cause) {
    throw new Error(`tokenURI RPC JSON parse failed for ${contract} (${rpcUrl}): ${String(cause)}`);
  }
  if (body.error) {
    throw new Error(
      `tokenURI RPC error for ${contract} token ${tokenId}: ${body.error.message ?? JSON.stringify(body.error)}`
    );
  }
  if (!body.result) {
    throw new Error(`tokenURI RPC returned no result for ${contract} token ${tokenId}`);
  }
  return decodeAbiString(body.result);
}

// ── baseURI cache — the "resolve once" contract ────────────────────────────
//
// Process-local, in-memory, no TTL. See the loa:shortcut note at the top of
// this file for the reveal/upgrade ceiling.
//
// Caches the PROMISE, not the resolved value — a page resolves its tokens
// with bounded CONCURRENCY (src/inventory.ts's resolveTokenUriPage), so a
// same-value cache checked-then-filled by concurrent callers is a race: N
// concurrent lookups for a not-yet-cached contract would all see a miss and
// each fire their own eth_call before any of them finishes writing the
// cache — exactly the "one RPC call per token" outcome this module exists
// to prevent (caught by a concurrent-page test, not by inspection). Caching
// the in-flight promise means every concurrent caller for the same
// (chainId, contract) awaits the SAME eth_call.
//
// loa:shortcut: a failed resolution's signal is shared by every caller
// piggybacking on it, so if the FIRST caller's page-budget aborts, everyone
// waiting on that promise aborts too — even a different concurrent request
// with budget left. Rare (only during a cold-start race across DIFFERENT
// inbound requests for the same contract; once resolved, the promise is
// resolved forever and every future call is instant) and accepted for now.
// Upgrade trigger: if this shows up in production as spurious page-budget
// exhaustion, give the underlying eth_call its OWN long-lived signal instead
// of the caller's page-budget signal.
const baseUriCache = new Map<string, Promise<string>>();

function cacheKey(chainId: number, contract: string): string {
  return `${chainId}:${contract.toLowerCase()}`;
}

/**
 * Resolve (or reuse the in-flight resolution of) a contract's baseURI.
 * On failure, evicts the cache entry so a later call can retry rather than
 * permanently poisoning the cache with a rejected promise.
 *
 * `rpcUrlForChain` is resolved LAZILY, inside the cache-miss branch — a
 * cache HIT must never require an RPC endpoint to even be configured.
 */
function resolveBaseUri(
  contract: string,
  chainId: number,
  tokenId: string,
  signal: AbortSignal
): Promise<string> {
  const key = cacheKey(chainId, contract);
  const cached = baseUriCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const rpcUrl = rpcUrlForChain(chainId);
    const raw = await ethCallTokenUri(rpcUrl, contract, tokenId, signal);
    if (!raw.endsWith(tokenId)) {
      throw new Error(
        `tokenURI shape assumption violated for ${contract}: expected it to end with ` +
          `tokenId "${tokenId}", got "${raw}"`
      );
    }
    return raw.slice(0, raw.length - tokenId.length);
  })();

  baseUriCache.set(key, promise);
  promise.catch(() => {
    baseUriCache.delete(key);
  });
  return promise;
}

/** Test-only: clear the baseURI cache so tests don't leak state across cases. */
export function __clearTokenUriCacheForTests(): void {
  baseUriCache.clear();
}

/** Outcome of resolving one page of tokenuri metadata (mirrors SovereignPageStats). */
export interface TokenUriPageStats {
  /** Tokens whose fetch failed with a non-NotFound error. */
  failed: number;
  /** Tokens never attempted because the page budget was already spent. */
  skipped: number;
  total: number;
}

/**
 * A page of tokenuri metadata came back degraded — see
 * src/sovereign-metadata.ts's `warnSovereignMetadataDegraded` for the full
 * rationale (NotFoundError vs. degraded-origin, one line per page not per
 * token). Kept as a separate function (rather than reusing the sovereign
 * one) so the log line says "tokenuri", not "sovereign" — this path never
 * touches our CDN.
 */
export function warnTokenUriMetadataDegraded(
  label: string,
  stats: TokenUriPageStats,
  err?: unknown
): void {
  const summary =
    `[inventory-api] tokenuri metadata ${label} degraded; ` +
    `${stats.failed} failed, ${stats.skipped} skipped of ${stats.total} token(s); ` +
    `returning imageless NFTs`;

  if (err === undefined) {
    console.warn(`${summary} — page budget exhausted`);
    return;
  }

  const detail = err instanceof Error ? err.message : String(err);
  console.warn(
    summary,
    // Upstream-derived text: collapse line breaks (CWE-117) and cap length.
    detail.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, 300)
  );
}

// Bound both the RPC call and the metadata-JSON fetch — mirrors
// src/sovereign-metadata.ts's per-fetch timeout idiom (plain fetch, no new deps).
const TOKENURI_FETCH_TIMEOUT_MS = Number(process.env.TOKENURI_FETCH_TIMEOUT_MS ?? 8000);

// Cap mapped attributes for the same reason src/sovereign-metadata.ts does: a
// hostile/buggy upstream must not turn into unbounded work here.
const MAX_ATTRIBUTES = 64;

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
 * Resolve a token's metadata by pointing at the collection's OWN tokenURI +
 * metadata host (never our CDN — see the doctrine note in
 * src/sovereign-metadata.ts for why third-party art can't be mirrored).
 *
 * First call for a given (chainId, contract): one `eth_call` to derive and
 * cache the baseURI, then one metadata-JSON fetch. Every subsequent call for
 * the SAME contract: zero RPC, one metadata-JSON fetch (pure string concat
 * for the URL).
 *
 * - 404 from the metadata host: throws `NotFoundError`, mirroring
 *   sovereign-metadata's not-found semantics.
 * - RPC failure / other HTTP failure / timeout / network / JSON parse
 *   failure / a tokenURI response that violates the `${baseURI}${tokenId}`
 *   shape assumption: throws a clear Error (NOT swallowed — the caller
 *   fail-softs to an imageless NFT, same contract as resolveSovereignPage).
 */
export async function fetchTokenUriMetadata(
  contract: string,
  chainId: number,
  tokenId: string,
  options: { signal?: AbortSignal } = {}
): Promise<MetadataDocument> {
  if (!/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKENURI_FETCH_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;

  try {
    const baseUri = await resolveBaseUri(contract, chainId, tokenId, signal);
    const tokenUri = resolveIpfsUri(`${baseUri}${tokenId}`);

    let res: Response;
    try {
      res = await fetch(tokenUri, { signal });
    } catch (cause) {
      throw new Error(
        `tokenURI metadata fetch failed for ${contract} token ${tokenId} (${tokenUri}): ${String(cause)}`
      );
    }

    if (!res.ok) {
      if (res.status === 404) {
        throw new NotFoundError(tokenId, contract);
      }
      throw new Error(
        `tokenURI metadata fetch returned HTTP ${res.status} for ${contract} token ${tokenId} (${tokenUri})`
      );
    }

    let json: { name?: unknown; description?: unknown; image?: unknown; attributes?: unknown };
    try {
      json = (await res.json()) as typeof json;
    } catch (cause) {
      throw new Error(
        `tokenURI metadata JSON parse failed for ${contract} token ${tokenId} (${tokenUri}): ${String(cause)}`
      );
    }

    const image = typeof json.image === "string" ? resolveIpfsUri(json.image) : "";
    return {
      name: typeof json.name === "string" ? json.name : "",
      description: typeof json.description === "string" ? json.description : "",
      image,
      attributes: mapAttributes(json.attributes),
    };
  } finally {
    clearTimeout(timer);
  }
}
