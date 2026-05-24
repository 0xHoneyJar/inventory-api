/**
 * Single source-of-truth route table for the inventory-api service transport.
 *
 * One declaration per route → runtime dispatch (server.ts) + OpenAPI 3.1
 * (openapi.ts) + MCP tool manifest (mcp.ts). This mirrors Hyper's
 * "one route declaration → runtime + OpenAPI + MCP" intent while staying a
 * thin, dependency-free wrapper over the existing library functions. The
 * library (index.ts / src/inventory.ts) remains the core; this is transport.
 *
 * See src/server/README.md for the Hyper-vs-minimal-server rationale.
 */
import { getHoldings, getNftsForOwner, getNftMetadata } from "../inventory.js";

/** OpenAPI parameter descriptor (path or query). */
export interface RouteParam {
  readonly name: string;
  readonly in: "path" | "query";
  readonly required: boolean;
  readonly description: string;
  readonly schema: Record<string, unknown>;
}

/**
 * A route definition. `handler` receives the resolved path params + parsed
 * query and returns a JSON-serializable value (or throws — server.ts maps
 * the library's typed errors to HTTP status codes).
 */
export interface RouteDef {
  readonly method: "GET";
  /** OpenAPI-style path with `{param}` placeholders. */
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  /** MCP tool description (richer, model-facing). */
  readonly mcpDescription: string;
  readonly tags: readonly string[];
  readonly params: readonly RouteParam[];
  /** OpenAPI schema name for the 200 response body (see openapi.ts components). */
  readonly responseSchema: string;
  readonly handler: (
    pathParams: Record<string, string>,
    query: URLSearchParams,
  ) => Promise<unknown>;
}

const ADDRESS_SCHEMA = {
  type: "string",
  pattern: "^0x[0-9a-fA-F]{40}$",
} as const;

/** The three transport routes, declared once. */
export const ROUTES: readonly RouteDef[] = [
  {
    method: "GET",
    path: "/holdings/{address}",
    operationId: "getHoldings",
    summary: "Resolve a wallet's holdings + ACVP completeness envelope",
    mcpDescription:
      "Get a wallet's NFT holdings for registered collections (Mibera first), " +
      "with per-token tokenIds and a completeness envelope (as_of_block, holder_count, " +
      "source, complete) that proves the result is complete as of a block.",
    tags: ["inventory"],
    params: [
      {
        name: "address",
        in: "path",
        required: true,
        description: "Holder wallet address (0x-prefixed, 40 hex chars).",
        schema: ADDRESS_SCHEMA,
      },
      {
        name: "contracts",
        in: "query",
        required: false,
        description: "Comma-separated contract addresses to filter to.",
        schema: { type: "string" },
      },
      {
        name: "chains",
        in: "query",
        required: false,
        description: "Comma-separated chain ids to filter to.",
        schema: { type: "string" },
      },
    ],
    responseSchema: "HoldingsResponse",
    handler: async (p, q) => {
      const contracts = q.get("contracts");
      const chains = q.get("chains");
      const options: { contracts?: string[]; chains?: number[] } = {};
      if (contracts) options.contracts = contracts.split(",").map((s) => s.trim());
      if (chains) {
        options.chains = chains
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
      }
      return getHoldings(p.address, options);
    },
  },
  {
    method: "GET",
    path: "/nfts/{contract}/owner/{address}",
    operationId: "getNftsForOwner",
    summary: "Paginated NFTs (sonar ⨝ codex) owned by a wallet",
    mcpDescription:
      "Get the paginated list of NFTs (with full metadata: name, image, attributes) " +
      "owned by a wallet for a given contract. Supports pageSize + pageKey cursoring.",
    tags: ["inventory"],
    params: [
      {
        name: "contract",
        in: "path",
        required: true,
        description: "Collection contract address (0x-prefixed, 40 hex chars).",
        schema: ADDRESS_SCHEMA,
      },
      {
        name: "address",
        in: "path",
        required: true,
        description: "Holder wallet address (0x-prefixed, 40 hex chars).",
        schema: ADDRESS_SCHEMA,
      },
      {
        name: "pageSize",
        in: "query",
        required: false,
        description: "Page size (1-100, default 100).",
        schema: { type: "integer", minimum: 1, maximum: 100 },
      },
      {
        name: "pageKey",
        in: "query",
        required: false,
        description: "Opaque pagination cursor from a prior response.",
        schema: { type: "string" },
      },
    ],
    responseSchema: "NFTCollection",
    handler: async (p, q) => {
      const options: { pageSize?: number; pageKey?: string } = {};
      const pageSize = q.get("pageSize");
      const pageKey = q.get("pageKey");
      if (pageSize) options.pageSize = Number(pageSize);
      if (pageKey) options.pageKey = pageKey;
      return getNftsForOwner(p.address, p.contract, options);
    },
  },
  {
    method: "GET",
    path: "/nfts/{contract}/{tokenId}",
    operationId: "getNftMetadata",
    summary: "Single NFT metadata document from the codex",
    mcpDescription:
      "Get the metadata document (name, description, image, attributes) for a single " +
      "token id of a contract, sourced from the codex.",
    tags: ["inventory"],
    params: [
      {
        name: "contract",
        in: "path",
        required: true,
        description: "Collection contract address (0x-prefixed, 40 hex chars).",
        schema: ADDRESS_SCHEMA,
      },
      {
        name: "tokenId",
        in: "path",
        required: true,
        description: "Numeric token id.",
        schema: { type: "string", pattern: "^\\d+$" },
      },
    ],
    responseSchema: "MetadataDocument",
    handler: async (p) => getNftMetadata(p.contract, p.tokenId),
  },
];
