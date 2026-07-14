import { vi } from "vitest";
import { AZUKI_CONTRACT } from "../../src/collection-registry.js";

/**
 * Real Azuki (0xED5AF388653567Af2F388E6224dC7C4b3241C544, Ethereum mainnet)
 * fixtures — the RPC `tokenURI` ABI response, the IPFS-gateway metadata JSON,
 * and the real holder — all captured LIVE 2026-07-13 (see the INV-A ground
 * probe: `eth_call tokenURI(4442)` on ethereum.publicnode.com decodes to
 * `ipfs://QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4/4442`, which
 * resolves via ipfs.io to the JSON below). Mirrors the
 * `sovereign-cdn-stub.ts` convention: real captured data, not invented shapes.
 */

export { AZUKI_CONTRACT };
export const AZUKI_CHAIN_ID = 1;

/** Owns exactly one Azuki (tokenId 4442) on mainnet — verified live against sonar. */
export const AZUKI_HOLDER = "0x3418fedc175eb74445e6eb0ade1435fd96bfca2a";

// Test-scoped RPC/gateway values (set via env, NEVER the src defaults) — this
// is what proves both are genuinely config values, not hardcoded strings.
export const AZUKI_TEST_RPC_URL = "https://rpc.test/eth-mainnet";
export const AZUKI_TEST_IPFS_GATEWAY = "https://ipfs.test/ipfs/";
export const AZUKI_TEST_SONAR_ENDPOINT = "https://belt-gateway.test/v1/graphql";

const BASE_URI_CID = "QmZcH4YvBVVRJtdn4RdbaqgspFU8gH6P9vomDpBVpAL3u4";
const IMAGE_DIR_CID = "QmYDvPAXtiJg7s8JdRBSLWdgSphQdac8j1YuQNNxcGE1hg";

/** Real Azuki #4442 metadata (ipfs.io gateway, captured live). No "description" field. */
export const AZUKI_4442_METADATA = {
  name: "Azuki #4442",
  image: `ipfs://${IMAGE_DIR_CID}/4442.png`,
  attributes: [
    { trait_type: "Type", value: "Human" },
    { trait_type: "Hair", value: "Indigo Ponytail" },
    { trait_type: "Ear", value: "Sakura" },
    { trait_type: "Clothing", value: "Sloth Kimono" },
    { trait_type: "Eyes", value: "Red" },
    { trait_type: "Mouth", value: "420" },
    { trait_type: "Background", value: "Off White C" },
  ],
};

/** Set the env overrides the tokenuri resolver reads (RPC endpoint + IPFS gateway). */
export function installAzukiEnv(): void {
  process.env.RPC_URL_1 = AZUKI_TEST_RPC_URL;
  process.env.IPFS_GATEWAY_URL = AZUKI_TEST_IPFS_GATEWAY;
}

export function uninstallAzukiEnv(): void {
  delete process.env.RPC_URL_1;
  delete process.env.IPFS_GATEWAY_URL;
}

// ── Minimal ABI encode/decode — the INVERSE of src/tokenuri-metadata.ts's
// (which encodes calldata FROM a tokenId and decodes a STRING reply). This is
// deliberately a separate, self-contained test double: decode the calldata
// TO a tokenId, and encode a STRING reply — so the stub can answer for
// whichever tokenId the code under test actually requests, not just one
// hardcoded case. ─────────────────────────────────────────────────────────

function decodeTokenIdFromCalldata(data: string): string {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  const wordHex = hex.slice(8); // strip the 4-byte (8 hex char) selector
  return BigInt(`0x${wordHex}`).toString();
}

function encodeAbiString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const lengthHex = bytes.length.toString(16).padStart(64, "0");
  let dataHex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const pad = (64 - (dataHex.length % 64)) % 64;
  dataHex += "0".repeat(pad);
  const offsetHex = (32).toString(16).padStart(64, "0");
  return `0x${offsetHex}${lengthHex}${dataHex}`;
}

/** Answer an `eth_call tokenURI(tokenId)` JSON-RPC POST against the Azuki contract, for ANY tokenId. */
export function azukiRpcResponse(url: string, init?: { body?: string }): Response | null {
  if (url !== AZUKI_TEST_RPC_URL) return null;
  let body: { method?: string; params?: [{ to?: string; data?: string }, string] };
  try {
    body = JSON.parse(init?.body ?? "{}");
  } catch {
    return null;
  }
  if (body.method !== "eth_call") return null;
  const call = body.params?.[0];
  if (!call?.to || call.to.toLowerCase() !== AZUKI_CONTRACT.toLowerCase()) return null;
  const tokenId = decodeTokenIdFromCalldata(call.data ?? "0x");
  const uri = `ipfs://${BASE_URI_CID}/${tokenId}`;
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encodeAbiString(uri) }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Answer an IPFS-gateway metadata GET for a given Azuki tokenId (real fixture for 4442, synthetic otherwise). */
export function azukiGatewayResponse(url: string): Response | null {
  const prefix = `${AZUKI_TEST_IPFS_GATEWAY}${BASE_URI_CID}/`;
  if (!url.startsWith(prefix)) return null;
  const tokenId = url.slice(prefix.length);
  if (tokenId === "4442") {
    return new Response(JSON.stringify(AZUKI_4442_METADATA), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  // Deterministic synthetic metadata for any other tokenId — same image
  // directory CID, per-token filename, consistent with Azuki's real shape.
  return new Response(
    JSON.stringify({
      name: `Azuki #${tokenId}`,
      image: `ipfs://${IMAGE_DIR_CID}/${tokenId}.png`,
      attributes: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

/** Answer the sonar belt-gateway `Token(...)` ownership GraphQL query for Azuki. */
function azukiSonarTokenResponse(
  url: string,
  init: { body?: string } | undefined,
  tokenIds: string[]
): Response | null {
  if (url !== AZUKI_TEST_SONAR_ENDPOINT) return null;
  const { query: gql } = JSON.parse(init?.body ?? "{}") as { query?: string };
  if (!gql) return null;
  const data: Record<string, unknown> = {};
  if (gql.includes("chain_metadata")) {
    data.chain_metadata = [{ latest_processed_block: 25_528_341 }];
  }
  if (gql.includes("TrackedHolder_aggregate")) {
    data.TrackedHolder_aggregate = { aggregate: { count: 4407 } };
  }
  if (gql.includes("Token(")) {
    data.Token = tokenIds.map((tokenId) => ({ tokenId }));
  }
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stub global fetch to serve the FULL Azuki resolution chain hermetically:
 * sonar ownership (Token GraphQL, live mode) + the tokenURI RPC + the IPFS
 * metadata gateway. Anything else throws loudly — no real network access.
 */
export function stubAzukiFetch(opts: { tokenIds?: string[] } = {}): void {
  const { tokenIds = ["4442"] } = opts;
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const sonar = azukiSonarTokenResponse(String(url), init, tokenIds);
    if (sonar) return sonar;
    const rpc = azukiRpcResponse(String(url), init);
    if (rpc) return rpc;
    const gw = azukiGatewayResponse(String(url));
    if (gw) return gw;
    throw new Error(`unexpected network fetch in hermetic Azuki test: ${String(url)}`);
  });
}
