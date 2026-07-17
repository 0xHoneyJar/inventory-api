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
  decodeDeploymentReference,
  mintRegistryRowIdentity,
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
  RegistryRowIdentity,
  // CR-001 wire types, re-exported from the vendored protocol package so
  // consumers of the hit shape never hand-mirror them.
  CollectionDeploymentInput,
  CollectionDeploymentRef,
  EquivalenceBasis,
  VersionedDigest,
} from './src/exact-enrichment.js';

// CR-108 — identity backfill / ledger / parity (planning + authority substrate)
export {
  IDENTITY_BACKFILL_CONTRACT_VERSION,
  OPERATOR_EQUIVALENCE_ASSERTION_DOMAIN,
  BACKFILL_DIGEST_DOMAINS,
  BACKFILL_ACTIONS,
  BACKFILL_REASON_CODES,
  decodeBackfillEvidence,
  mintOperatorAssertionDigest,
  decodeOperatorEquivalenceAssertion,
  planIdentityBackfill,
  mintPlanDigest,
  mintRecordDigest,
  stateDigestOf,
  registrySnapshotDigestOf,
  mintInventoryDigest,
} from './src/identity-backfill.js';
export type {
  BackfillEvidence,
  BackfillPlan,
  BackfillPlanItem,
  BackfillAction,
  BackfillReasonCode,
  BackfillIdentityRecord,
  BackfillRecordContent,
  OperatorEquivalenceAssertion,
  SonarObservation,
  ProxyImplementationEvidence,
  RecordedProxyImplementation,
} from './src/identity-backfill.js';
export {
  IDENTITY_SUPERSESSION_CONTRACT_VERSION,
  createBackfillLedger,
  replayBackfillLedger,
  serializeBackfillLedger,
  deserializeBackfillLedger,
  applyBackfillPlan,
  rollbackBackfill,
  enableAuthority,
  isProductionOrderingEnabled,
  applyOperatorRevision,
  revokeEquivalence,
  resolveBackfilledIdentity,
  mintSharedWorkKey,
  reconciliationReportOf,
  decodeQuarantineImpactSet,
  BackfillAuthorityError,
  BackfillStalePlanError,
  BackfillParityError,
  BackfillIntegrityError,
  BackfillRevocationError,
  BackfillCommandConflictError,
} from './src/identity-ledger.js';
export type {
  BackfillLedger,
  BackfillLedgerEvent,
  QuarantineImpactSet,
  AuthorityParityEvidence,
  EquivalenceRevocationRequest,
  BackfillReconciliationReport,
  SharedWorkKeyRequest,
  PostAuthorityMutationResult,
} from './src/identity-ledger.js';
export {
  READ_PARITY_CONTRACT_VERSION,
  PARITY_DIGEST_DOMAIN,
  PARITY_DIGEST_VERSION,
  LEGACY_PARITY_SOURCE,
  NEW_PARITY_SOURCE,
  proveReadParity,
  proveLegacyNewParity,
  verifyAuthorityParityReport,
  bindAuthorityParityEvidence,
} from './src/identity-parity.js';
export type {
  ReadParityReport,
  ReadParityMismatch,
  ReadParityInput,
  ReadParityEntry,
} from './src/identity-parity.js';

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
