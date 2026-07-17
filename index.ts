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
export {
  lookupExactDeployment,
  EXACT_ENRICHMENT_CONTRACT_VERSION,
  SOLANA_MAINNET_NETWORK_REFERENCE,
  // Published so any consumer can recompute and verify a registry
  // equivalence assertion_digest instead of trusting the stored value.
  REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN,
  REGISTRY_EQUIVALENCE_ASSERTION_VERSION,
} from './src/exact-enrichment.js';
export type {
  ExactDeploymentQuery,
  ExactEnrichmentResult,
  ExactEnrichmentHit,
  ExactEnrichmentMiss,
  EquivalenceEvidence,
  // CR-001 wire types, re-exported from the vendored protocol package so
  // consumers of the hit shape never hand-mirror them.
  CollectionDeploymentInput,
  CollectionDeploymentRef,
  EquivalenceBasis,
  VersionedDigest,
} from './src/exact-enrichment.js';
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
