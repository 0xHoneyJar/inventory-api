/**
 * OpenAPI 3.1 document generator — derived from the single ROUTES table.
 *
 * Emits a spec the consumer (Next.js frontend) can drift-CI against. The
 * shape follows Hyper's `OpenAPIManifest` conventions (openapi: "3.1.0",
 * info, paths) so a future swap to full Hyper is low-friction, but adds real
 * component schemas + typed responses (Hyper's built-in projection currently
 * emits `{ description: "success" }` placeholders).
 *
 * Component schemas are hand-authored to MATCH `types.ts` exactly — keep them
 * in sync when the library response shapes change.
 */
import { ROUTES } from "./routes.js";

/** Reusable component schemas mirroring `types.ts`. */
const COMPONENT_SCHEMAS: Record<string, unknown> = {
  Attribute: {
    type: "object",
    required: ["trait_type", "value"],
    properties: {
      trait_type: { type: "string" },
      value: { type: "string" },
    },
  },
  CompletenessEnvelope: {
    type: "object",
    required: ["as_of_block", "holder_count", "source", "complete"],
    properties: {
      as_of_block: { type: "integer" },
      holder_count: { type: "integer" },
      source: { type: "string", enum: ["sonar"] },
      complete: {
        description: "true when the answer is provably complete; 'degraded' when upstream was unreachable.",
        oneOf: [{ type: "boolean", enum: [true] }, { type: "string", enum: ["degraded"] }],
      },
    },
  },
  ContractHolding: {
    type: "object",
    required: ["contractAddress", "chainId", "tokenCount", "tokenIds"],
    properties: {
      contractAddress: { type: "string" },
      chainId: { type: "integer" },
      tokenCount: { type: "integer" },
      tokenIds: { type: "array", items: { type: "string" } },
    },
  },
  HoldingsResponse: {
    type: "object",
    required: ["holdings", "completeness"],
    properties: {
      holdings: { type: "array", items: { $ref: "#/components/schemas/ContractHolding" } },
      completeness: { $ref: "#/components/schemas/CompletenessEnvelope" },
    },
  },
  NFT: {
    type: "object",
    required: ["tokenId", "name", "description", "imageUrl", "contentType", "attributes"],
    properties: {
      tokenId: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      imageUrl: { type: "string" },
      contentType: { type: "string" },
      attributes: { type: "array", items: { $ref: "#/components/schemas/Attribute" } },
    },
  },
  NFTCollection: {
    type: "object",
    required: ["contractAddress", "name", "symbol", "totalSupply", "nfts"],
    properties: {
      contractAddress: { type: "string" },
      name: { type: "string" },
      symbol: { type: "string" },
      totalSupply: { type: "integer" },
      nfts: { type: "array", items: { $ref: "#/components/schemas/NFT" } },
      pageKey: { type: "string" },
    },
  },
  MetadataDocument: {
    type: "object",
    required: ["name", "description", "image", "attributes"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      image: { type: "string" },
      attributes: { type: "array", items: { $ref: "#/components/schemas/Attribute" } },
    },
  },
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string" },
      code: { type: "string" },
    },
  },
};

export interface OpenAPIDocConfig {
  readonly title?: string;
  readonly version?: string;
  readonly description?: string;
}

/** Build the OpenAPI 3.1 document from the ROUTES table. */
export function buildOpenAPIDocument(cfg: OpenAPIDocConfig = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const r of ROUTES) {
    const parameters = r.params.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description,
      schema: p.schema,
    }));

    const operation = {
      operationId: r.operationId,
      summary: r.summary,
      tags: r.tags,
      parameters,
      responses: {
        "200": {
          description: "success",
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${r.responseSchema}` },
            },
          },
        },
        "400": {
          description: "validation error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        "404": {
          description: "not found",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    };

    if (!paths[r.path]) paths[r.path] = {};
    paths[r.path][r.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: cfg.title ?? "inventory-api",
      version: cfg.version ?? "0.1.0",
      description:
        cfg.description ??
        "Sovereign read-side inventory aggregator — joins sonar holdings with owned codex metadata + a completeness envelope.",
    },
    paths,
    components: { schemas: COMPONENT_SCHEMAS },
  };
}
