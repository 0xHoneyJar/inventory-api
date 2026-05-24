/**
 * Internal domain barrel.
 *
 * inventory-api is consumed over HTTP + MCP (a Hyper/Bun service — see
 * src/app.ts), NOT as an npm package. This barrel is the internal import
 * surface for the route handlers (src/routes.ts) and the test suite — it
 * re-exports the domain functions + types + typed errors. Keeping it stable
 * means the routes and tests share one canonical import path.
 */
export { getHoldings, getNftsForOwner, getNftMetadata, getProfilePicture } from './src/inventory.js';
export type {
  HoldingsResponse,
  ContractHolding,
  CompletenessEnvelope,
  NFTCollection,
  NFT,
  MetadataDocument,
  Attribute,
  GetHoldingsOptions,
  GetNftsForOwnerOptions,
} from './types.js';
export { FixtureLoadError, ValidationError, NotFoundError } from './src/errors.js';
