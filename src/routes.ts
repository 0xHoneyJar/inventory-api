/**
 * Hyper route declarations for inventory-api.
 *
 * ONE declaration per endpoint → Hyper generates the runtime, the OpenAPI 3.1
 * document (via @hyper/openapi + @hyper/openapi-zod), the typed RPC client
 * (@hyper/client), and the MCP tool surface (@hyper/mcp) from this single
 * source. The route handlers are thin: they call the domain functions in
 * src/inventory.ts (which own the sonar ⨝ codex join + ACVP envelope). The
 * domain logic is the core; these routes are transport.
 *
 * Errors: the domain throws typed errors (src/errors.ts) with a `.code`.
 * `toHyperError` maps them to HTTP status so both the HTTP pipeline and the
 * MCP invoke() path project the right status (Hyper defaults unknown throws
 * to 500).
 */
import { Hyper, ok, createError, type HyperError } from "@hyper/core";
import { z } from "zod";
import {
  getHoldings,
  getNftsForOwner,
  getNftMetadata,
  getProfilePicture,
} from "./inventory.js";
import { listPublicCollections } from "./collection-registry.js";

const MIBERA_CONTRACT = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
const SAMPLE_HOLDER = "0x1111111111111111111111111111111111111111";

/**
 * Map a domain error (src/errors.ts) to a HyperError with the right status.
 *
 * SECURITY — the 500 body is GENERIC on purpose. Only the two intentional,
 * client-facing domain errors (ValidationError -> 400, NotFoundError -> 404,
 * each carrying a `.code`) may surface their `.message`; those messages contain
 * only caller-supplied input or a public tokenId/contract. EVERYTHING else — an
 * RPC failure, a fixture-load error, an unexpected throw — collapses to a bare
 * `500 { message: "internal error" }` with the real reason logged SERVER-SIDE
 * only. Passing a raw `.message` to an anonymous caller is how a provider URL
 * with an embedded API key leaks out of a 500 (the incident already in this
 * estate's memory); a coded allowlist closes that whole class, not just the one
 * message that happened to carry it.
 */
function toHyperError(e: unknown): HyperError {
  const code =
    e && typeof e === "object" && "code" in e
      ? String((e as { code: unknown }).code)
      : undefined;
  const status =
    code === "INVENTORY_INVALID_INPUT"
      ? 400
      : code === "INVENTORY_NOT_FOUND"
        ? 404
        : 500;

  if (status === 500) {
    // Never surface the raw message to the caller — log it server-side for
    // diagnosis instead. Covers un-coded throws AND coded-but-not-client-facing
    // ones (e.g. INVENTORY_FIXTURE_LOAD), whose messages can carry paths/URLs.
    console.error(
      "[inventory-api] unhandled error mapped to 500:",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    );
    return createError({ status: 500, message: "internal error" });
  }

  return createError({
    status,
    message: e instanceof Error ? e.message : "internal error",
    ...(code !== undefined && { code }),
    ...(status === 400 && {
      fix: "Provide a 0x-prefixed 40-char hex address / numeric tokenId.",
    }),
  });
}

/** Run a domain call, translating its typed errors to HyperError. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toHyperError(e);
  }
}

// Declared error shape (projected into OpenAPI 4xx responses). `code` is
// required, not optional: every declared 4xx body carries one. The domain path
// (toHyperError) sets a `.code` for both the 400 (INVENTORY_INVALID_INPUT) and
// 404 (INVENTORY_NOT_FOUND) cases, and Hyper's own input-validation 400 sets
// `code: "validation_failed"` (src/hyper/core/app.ts schemaToHyperError). There
// is no declared-4xx path that omits it, so marking it optional under-specified
// the contract for code-gen consumers.
const errorBody = z.object({
  error: z.object({
    status: z.number(),
    message: z.string(),
    code: z.string(),
  }),
});

/**
 * The inventory service routes. Exported as a Hyper instance so app.ts can
 * `.use()` it and the emit scripts can build the same graph headlessly.
 */
export const routes = new Hyper()
  .get(
    "/holdings/:address",
    {
      query: z.object({
        contracts: z
          .string()
          .optional()
          .describe("Comma-separated contract addresses to filter to."),
        chains: z
          .string()
          .optional()
          .describe("Comma-separated chain ids to filter to."),
      }),
      throws: { 400: errorBody },
      meta: {
        name: "getHoldings",
        tags: ["inventory"],
        mcp: {
          description:
            "Get a wallet's NFT holdings for registered collections (Mibera first), " +
            "with per-token tokenIds and a completeness envelope (as_of_block, " +
            "holder_count, source, complete) that proves the result is complete as of a block.",
        },
        examples: [
          {
            name: "holdings for a holder",
            input: { params: { address: SAMPLE_HOLDER } },
            output: {
              body: {
                holdings: [
                  {
                    contractAddress: MIBERA_CONTRACT,
                    chainId: 80094,
                    tokenCount: 12,
                    tokenIds: ["1", "2", "3"],
                  },
                ],
                completeness: {
                  as_of_block: 9123456,
                  holder_count: 5,
                  source: "sonar",
                  complete: true,
                },
              },
            },
          },
        ],
      },
    },
    ({ params, query }) => {
      const options: { contracts?: string[]; chains?: number[] } = {};
      if (query.contracts) {
        options.contracts = query.contracts.split(",").map((s) => s.trim());
      }
      if (query.chains) {
        options.chains = query.chains
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
      }
      return call(() => getHoldings(params.address, options)).then(ok);
    },
  )
  .get(
    "/nfts/:contract/owner/:address",
    {
      query: z.object({
        pageSize: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Page size (1-100, default 100)."),
        pageKey: z
          .string()
          .optional()
          .describe("Opaque pagination cursor from a prior response."),
      }),
      throws: { 400: errorBody },
      meta: {
        name: "getNftsForOwner",
        tags: ["inventory"],
        mcp: {
          description:
            "Get the paginated list of NFTs (with full metadata: name, image, attributes) " +
            "owned by a wallet for a given contract. Supports pageSize + pageKey cursoring.",
        },
        examples: [
          {
            name: "nfts for owner",
            input: { params: { contract: MIBERA_CONTRACT, address: SAMPLE_HOLDER } },
            output: {
              body: {
                contractAddress: MIBERA_CONTRACT,
                name: "Mibera",
                symbol: "MIBERA",
                totalSupply: 10000,
                nfts: [
                  {
                    tokenId: "1",
                    name: "Mibera #1",
                    description: "A Freetekno of Greek origin...",
                    imageUrl: "https://assets.0xhoneyjar.xyz/.../1.png",
                    contentType: "image/png",
                    attributes: [{ trait_type: "archetype", value: "Freetekno" }],
                  },
                ],
              },
            },
          },
        ],
      },
    },
    ({ params, query }) => {
      const options: { pageSize?: number; pageKey?: string } = {};
      if (query.pageSize !== undefined) options.pageSize = query.pageSize;
      if (query.pageKey) options.pageKey = query.pageKey;
      return call(() => getNftsForOwner(params.address, params.contract, options)).then(ok);
    },
  )
  .get(
    "/nfts/:contract/:tokenId",
    {
      throws: { 400: errorBody, 404: errorBody },
      meta: {
        name: "getNftMetadata",
        tags: ["inventory"],
        mcp: {
          description:
            "Get the metadata document (name, description, image, attributes) for a single " +
            "token id of a contract, sourced from the codex.",
        },
        examples: [
          {
            name: "single metadata",
            input: { params: { contract: MIBERA_CONTRACT, tokenId: "2769" } },
            output: {
              body: {
                name: "Air",
                description: "Cloud...",
                image: "https://assets.0xhoneyjar.xyz/Mibera/grails/air.webp",
                attributes: [{ trait_type: "Grail", value: "true" }],
              },
            },
          },
        ],
      },
    },
    ({ params }) =>
      call(() => getNftMetadata(params.contract, params.tokenId)).then(ok),
  )
  .get(
    "/profile/:address",
    {
      // Declare the path param schema (the other routes leave path params
      // implicit). This gives the route router-level shape validation for
      // `:address` AND lets the OpenAPI generator emit a `schema` for the path
      // parameter (OAS 3.1 §4.8.12 requires every parameter to carry one).
      params: z.object({
        address: z
          .string()
          .describe(
            "Wallet address — EVM 0x-prefixed hex for Mibera/purupuru; " +
              "SVM base58 (case-sensitive) for pythenians when ?contract=pythians."
          ),
      }),
      query: z.object({
        contract: z
          .string()
          .optional()
          .describe("Collection contract to resolve the pfp from (default: Mibera)."),
      }),
      throws: { 400: errorBody },
      meta: {
        name: "getProfilePicture",
        tags: ["inventory"],
        // Formal 200 response schema (OpenAPI 3.1). The example set alone can't
        // express imageUrl's nullability — buildResponseExamples emits only the
        // first matching example, dropping the null variant — so a code-gen
        // consumer would wrongly infer imageUrl: string. Declaring the schema
        // here binds imageUrl as string|null in the drift-CI anchor.
        responseSchema: {
          type: "object",
          properties: {
            address: { type: "string" },
            contract: { type: "string" },
            imageUrl: { type: ["string", "null"] },
          },
          required: ["address", "contract", "imageUrl"],
        },
        mcp: {
          description:
            "Get the best-available profile image URL for a wallet across registered " +
            "collections (Mibera first); returns imageUrl: null when the wallet holds " +
            "nothing renderable.",
        },
        examples: [
          {
            name: "pfp for a holder",
            input: { params: { address: SAMPLE_HOLDER } },
            output: {
              body: {
                address: SAMPLE_HOLDER,
                contract: MIBERA_CONTRACT,
                imageUrl: "https://assets.0xhoneyjar.xyz/.../1.png",
              },
            },
          },
          {
            name: "pfp for a wallet that holds nothing renderable",
            input: { params: { address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" } },
            output: {
              body: {
                address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                contract: MIBERA_CONTRACT,
                imageUrl: null,
              },
            },
          },
        ],
      },
    },
    ({ params, query }) => {
      // Single source of truth for the resolved contract. Falsy coalescing (||)
      // so an empty-string ?contract= falls through to the default — matching
      // what the domain fn actually resolves — instead of `?? `letting "" lie in
      // the envelope while the domain silently defaults to Mibera.
      const contract = query.contract || MIBERA_CONTRACT;
      return call(() => getProfilePicture(params.address, { contract })).then((imageUrl) =>
        ok({ address: params.address, contract, imageUrl }),
      );
    },
  )
  .get(
    "/collections",
    {
      meta: {
        name: "listCollections",
        tags: ["inventory"],
        mcp: {
          description:
            "List every enabled collection this service knows: its primary route key " +
            "(id — EVM contract or SVM mint), aliases, chain/chainId, name, symbol, " +
            "metadata strategy, and rehost policy. The discovery endpoint a client uses " +
            "to resolve a community's contract before calling /profile or /nfts.",
        },
        examples: [
          {
            name: "all enabled collections",
            input: {},
            output: {
              body: {
                collections: [
                  {
                    id: MIBERA_CONTRACT,
                    aliases: ["mibera"],
                    chain: "evm",
                    chainId: 80094,
                    name: "Mibera",
                    symbol: "MIBERA",
                    metadataStrategy: "sovereign-world",
                    rehost_policy: "mirror",
                  },
                ],
              },
            },
          },
        ],
      },
    },
    // Pure registry projection — no domain call, no input, cannot fail on user
    // input, so it needs neither `call()` (error translation) nor a `throws`
    // declaration. Wrapped as `{ collections: [...] }` to match this API's
    // house style (every endpoint returns an object; cf. `/holdings` ->
    // `{ holdings }`), so a consumer reads `.collections`.
    () => ok({ collections: listPublicCollections() }),
  );
