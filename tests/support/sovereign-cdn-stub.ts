import { vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MetadataDocument } from "../../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "../..");

/**
 * Real sovereign-storage documents for every Mibera token id the sonar fixture
 * owns, captured from `metadata.0xhoneyjar.xyz/mibera/{id}`. Mirrors the
 * `fixtures/pythenians-metadata.json` convention.
 *
 * Owner-list metadata is a network read (the codex fixture holds 55 of 10,000
 * tokens), so hermetic tests must stub `fetch` rather than hit the CDN.
 */
export const MIBERA_METADATA: Record<string, MetadataDocument> = JSON.parse(
  readFileSync(path.join(PKG_ROOT, "fixtures/sovereign-mibera-metadata.json"), "utf-8")
);

/** The Mibera-main namesake route: `/mibera/{tokenId}` — no collection slug. */
const NAMESAKE_ROUTE = /^https:\/\/metadata\.0xhoneyjar\.xyz\/mibera\/(\d+)$/;

/**
 * Answer a sovereign-metadata request from the committed fixture.
 * Returns `null` when the URL is not a Mibera namesake metadata URL, so callers
 * that also stub other origins (e.g. the belt-gateway GraphQL endpoint) can
 * delegate here first and fall through.
 */
export function sovereignCdnResponse(url: string): Response | null {
  const match = NAMESAKE_ROUTE.exec(url);
  if (!match) return null;

  const doc = MIBERA_METADATA[match[1]];
  // An unminted / absent token is a 404 upstream — the same signal the real
  // storage-api emits, which maps to NotFoundError.
  if (!doc) return new Response("", { status: 404 });

  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stub global fetch to serve Mibera metadata from the fixture. Any other outbound
 * request throws loudly — a hermetic test must never reach the network.
 */
export function stubSovereignCdn(): void {
  vi.stubGlobal("fetch", async (url: string) => {
    const res = sovereignCdnResponse(String(url));
    if (res) return res;
    throw new Error(`unexpected network fetch in hermetic test: ${String(url)}`);
  });
}
