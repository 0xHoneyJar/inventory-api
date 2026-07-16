/**
 * CR-108 — Existing collection identity and equivalence backfill:
 * evidence contracts, source precedence, and the pure dry-run planner
 * (`inventory.identity-backfill.v1`).
 *
 * This module migrates the EXISTING curated collection records into the
 * CR-001 cross-VM deployment/equivalence model — before production
 * shared-work keys are allowed to trust it. It is the read/planning half of
 * the substrate; the append-only ledger, authority state machine, and
 * CR-012A-compatible supersession events live in `identity-ledger.ts`, and
 * the old/new read-parity proof in `identity-parity.ts`.
 *
 * Boundary doctrine is CR-105's, unchanged: every deployment reference
 * decodes through the vendored CR-001 package (`@freeside/collection-protocol`,
 * checksum-pinned — see `vendor/collection-protocol/PROVENANCE.md`) via
 * `decodeDeploymentReference`; every proposed identity is assembled by the
 * package's own `makeCollectionIdentity`; every digest is minted by the
 * package's canonical (RFC 8785) encoder. Nothing here hand-mirrors canonical
 * encoding or digest semantics. Effect is an implementation detail of the
 * protocol package and never escapes this module — boundary errors are this
 * repo's typed errors.
 *
 * ## Source precedence (deterministic, no guessing)
 *
 * Four sources feed the backfill, in this authority order:
 *
 * 1. **Operator-approved equivalence** (`operator_ratified`) — the ONLY
 *    source that may assert logical equivalence beyond what one curated row
 *    already asserts. Pre-authority it may RATIFY a curated row exactly as
 *    curated (resolving observed-identity or proxy-change conflicts for that
 *    row); a grouping that DIFFERS from curation never silently rewrites
 *    anything — a whole-row merge is `blocked` until post-authority revision
 *    (parity would otherwise be broken by construction), and a partial-row
 *    split quarantines the affected rows as ambiguous grouping.
 * 2. **Curated Inventory** (`inventory_registry`) — the collection registry.
 *    Sole source of collection metadata and of the pre-authority grouping.
 *    Pre-authority proposed identities are EXACTLY
 *    `mintRegistryRowIdentity(row)` — the same derivation the CR-105 lookup
 *    serves — so old/new read parity holds by construction.
 * 3. **Observed Sonar identity** (`sonar_probe`) — confirms a curated
 *    deployment↔collection_key binding (recorded as provenance). A
 *    disagreement with curation is a CONFLICT: the row quarantines instead of
 *    either source winning. An observed deployment no curated row asserts
 *    quarantines as uncurated — the planner never invents a collection.
 * 4. **Proxy implementation evidence** (`onchain`) — may identify
 *    implementation relationships (proxy → implementation) and is recorded as
 *    provenance, but NEVER creates collection equivalence: two collections
 *    sharing implementation code stay two collections. Evidence that a
 *    proxy's implementation CHANGED quarantines the affected row
 *    (code/proxy change requires re-verification, not a guess).
 *
 * Similarity does not exist in this contract: there is no evidence type for
 * metadata/name/image similarity, so similarity CANNOT group deployments —
 * unrepresentable, not merely discouraged.
 *
 * ## The planner is pure and deterministic
 *
 * `planIdentityBackfill` reads a registry snapshot, the currently
 * materialized records, and one explicit evidence batch; it performs no I/O
 * and never reads a clock (every timestamp is caller-supplied input). Same
 * inputs ⇒ byte-identical plan (stable item ordering, canonical digests).
 * Each item classifies as create / noop / update / quarantine / blocked with
 * a closed reason-code vocabulary, the exact evidence references that led to
 * it, before/after record digests, and the affected deployment_ids.
 */
import { Effect, Either, Schema } from "effect";
import {
  COLLECTION_PROTOCOL_SCHEMA_VERSION,
  DIGEST_DOMAINS,
  Provenance,
  digestVersioned,
  type CollectionDeploymentRef,
  type CollectionIdentity,
  type VersionedDigest,
} from "@freeside/collection-protocol";
import {
  decodeDeploymentReference,
  mintRegistryRowIdentity,
  registryDeploymentRefsOf,
} from "./exact-enrichment.js";
import {
  effectiveRehostPolicy,
  type CollectionRegistryEntry,
} from "./collection-registry.js";
import { ValidationError } from "./errors.js";

export const IDENTITY_BACKFILL_CONTRACT_VERSION = "inventory.identity-backfill.v1";

/**
 * Versioned digest domain for operator equivalence assertions. The material
 * binds `{ source: "operator_ratified", authority_ref,
 * canonical_collection_key, deployment_ids (sorted) }` — so the SAME approved
 * edge always mints the SAME digest, which is what makes post-revocation
 * reuse of an invalidated edge mechanically detectable. A re-approval after
 * revocation therefore requires a fresh `authority_ref` (the operator
 * authority registry's uniqueness contract), which mints a new digest and a
 * new immutable identity version.
 */
export const OPERATOR_EQUIVALENCE_ASSERTION_DOMAIN = "inventory.operator-equivalence";
export const OPERATOR_EQUIVALENCE_ASSERTION_VERSION = 1;

/** Digest domains owned by this contract (all minted via the CR-001 encoder). */
export const BACKFILL_DIGEST_DOMAINS = {
  evidence: "inventory.backfill-evidence",
  registry_snapshot: "inventory.backfill-registry",
  record: "inventory.backfill-record",
  plan: "inventory.backfill-plan",
  state: "inventory.backfill-state",
} as const;
const BACKFILL_DIGEST_VERSION = 1;

// ── Boundary plumbing ────────────────────────────────────────────────────────

const STRICT_DECODE_OPTIONS = {
  errors: "all",
  onExcessProperty: "error",
} as const;

/**
 * Timestamps are UTC `Z`-suffixed ISO-8601 — the shape the CR-001 Provenance
 * schema accepts (probed against the vendored package: offsets and date-only
 * forms are rejected there). Callers supply every timestamp; this module
 * never reads a clock.
 */
const IsoUtcTimestamp = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/, {
    identifier: "IsoUtcTimestamp",
    description: "UTC ISO-8601 timestamp with Z suffix",
  })
);

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

function runProtocol<A, E>(effect: Effect.Effect<A, E>): Either.Either<A, E> {
  return Effect.runSync(Effect.either(effect));
}

/**
 * Mint a versioned digest through the package encoder; failures are caller
 * bugs (unencodable material), surfaced as this repo's typed error. Shared by
 * the ledger module — every digest in the substrate goes through here.
 */
export function mintInventoryDigest(
  domain: string,
  version: number,
  material: unknown
): VersionedDigest {
  const digest = runProtocol(digestVersioned(domain, version, material));
  if (Either.isLeft(digest)) {
    throw new ValidationError(
      "digest_material",
      material,
      `canonically encodable material for ${domain} v${version} — ${String(digest.left)}`
    );
  }
  return digest.right;
}

const mintDigest = mintInventoryDigest;

/** CR-001's canonical sort key for a versioned digest (same rule CR-105 uses). */
export function versionedDigestKeyOf(digest: VersionedDigest): string {
  return `${digest.domain}:${digest.major_version}:${digest.digest}`;
}

const digestKeyOf = versionedDigestKeyOf;

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Sort versioned digests by their canonical key (CR-001 sorted-set rule). */
export function sortVersionedDigests(
  digests: readonly VersionedDigest[]
): readonly VersionedDigest[] {
  return [...digests].sort((l, r) => compareStrings(digestKeyOf(l), digestKeyOf(r)));
}

const sortDigests = sortVersionedDigests;

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Validate a caller-supplied UTC Z-suffixed ISO-8601 timestamp. */
export function assertIsoUtcTimestamp(value: string, field: string): string {
  const decoded = Schema.decodeUnknownEither(IsoUtcTimestamp)(value);
  if (Either.isLeft(decoded)) {
    throw new ValidationError(field, value, "a UTC ISO-8601 timestamp with Z suffix");
  }
  return decoded.right;
}

// ── Evidence input contracts (strict Effect Schema envelopes) ────────────────
//
// The envelope shape is strict-decoded here; every EMBEDDED deployment
// reference then decodes through the CR-001 package via
// `decodeDeploymentReference` (input form minted, full-ref form
// digest-recomputed and verified). A forged deployment_id, hybrid/partial
// reference, address-only or numeric-chain-only form is rejected at this
// boundary — it can never reach the planner.

const SonarDeploymentObservationSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  kind: Schema.Literal("deployment"),
  /** CR-001 deployment reference — decoded through the protocol package. */
  deployment: Schema.Unknown,
  /** The collection_key sonar indexes this deployment under. */
  collection_key: NonEmptyString,
  observed_at: IsoUtcTimestamp,
  source_reference: NonEmptyString,
});

/**
 * A legacy observed record whose network identity is MISSING or cannot be
 * expressed as a CR-001 deployment reference. Representable on purpose: the
 * backfill must route these to quarantine with an auditable reason instead of
 * crashing at decode or silently dropping them.
 */
const SonarUnidentifiedObservationSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  kind: Schema.Literal("unidentified"),
  /** Whatever identifier the legacy record carries (opaque, never parsed). */
  raw_reference: NonEmptyString,
  /** Why network identity is missing — human-auditable, required. */
  reason: NonEmptyString,
  observed_at: IsoUtcTimestamp,
  source_reference: NonEmptyString,
});

const ProxyImplementationEvidenceSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  /** The proxy deployment (CR-001 reference, protocol-decoded). */
  proxy: Schema.Unknown,
  /** The implementation it delegates to (CR-001 reference, protocol-decoded). */
  implementation: Schema.Unknown,
  /** Evidence vocabulary (e.g. "eip1967"), free-form — evidence, not policy. */
  proxy_standard: NonEmptyString,
  observed_at: IsoUtcTimestamp,
  source_reference: NonEmptyString,
});

const OperatorEquivalenceAssertionSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  /**
   * Operator authority record reference (CR-001 `operator_ratified` bases
   * require it). MUST be unique per approval act — the assertion digest binds
   * it, and revocation-reuse refusal keys on that digest.
   */
  authority_ref: NonEmptyString,
  /** The surviving collection_key — must name one of the member rows' keys. */
  canonical_collection_key: NonEmptyString,
  /** CR-001 deployment references (protocol-decoded), ≥ 1. */
  deployments: Schema.Array(Schema.Unknown).pipe(Schema.minItems(1)),
  approved_at: IsoUtcTimestamp,
  source_reference: NonEmptyString,
});

const BackfillEvidenceSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  observations: Schema.Array(
    Schema.Union(SonarDeploymentObservationSchema, SonarUnidentifiedObservationSchema)
  ),
  proxy_implementations: Schema.Array(ProxyImplementationEvidenceSchema),
  operator_assertions: Schema.Array(OperatorEquivalenceAssertionSchema),
});

const decodeEvidenceEnvelope = Schema.decodeUnknownEither(
  BackfillEvidenceSchema,
  STRICT_DECODE_OPTIONS
);

export interface SonarDeploymentObservation {
  readonly kind: "deployment";
  readonly deployment: CollectionDeploymentRef;
  readonly collection_key: string;
  readonly observed_at: string;
  readonly source_reference: string;
}

export interface SonarUnidentifiedObservation {
  readonly kind: "unidentified";
  readonly raw_reference: string;
  readonly reason: string;
  readonly observed_at: string;
  readonly source_reference: string;
}

export type SonarObservation = SonarDeploymentObservation | SonarUnidentifiedObservation;

export interface ProxyImplementationEvidence {
  readonly proxy: CollectionDeploymentRef;
  readonly implementation: CollectionDeploymentRef;
  readonly proxy_standard: string;
  readonly observed_at: string;
  readonly source_reference: string;
}

export interface OperatorEquivalenceAssertion {
  readonly authority_ref: string;
  readonly canonical_collection_key: string;
  /** Verified refs, sorted by deployment_id per CR-001's canonical set rule. */
  readonly deployments: readonly CollectionDeploymentRef[];
  readonly approved_at: string;
  readonly source_reference: string;
  /**
   * Deterministic digest of the approved edge (domain
   * `inventory.operator-equivalence` v1) — the value CR-001
   * `operator_ratified` bases carry as `assertion_digest`, and the key the
   * ledger's revocation-reuse refusal checks.
   */
  readonly assertion_digest: VersionedDigest;
}

export interface BackfillEvidence {
  readonly observations: readonly SonarObservation[];
  readonly proxy_implementations: readonly ProxyImplementationEvidence[];
  readonly operator_assertions: readonly OperatorEquivalenceAssertion[];
  /** Deterministic digest of the whole decoded batch — plans bind to it. */
  readonly evidence_digest: VersionedDigest;
}

/** Mint the deterministic digest of one operator-approved equivalence edge. */
export function mintOperatorAssertionDigest(assertion: {
  readonly authority_ref: string;
  readonly canonical_collection_key: string;
  readonly deployments: readonly CollectionDeploymentRef[];
}): VersionedDigest {
  return mintDigest(
    OPERATOR_EQUIVALENCE_ASSERTION_DOMAIN,
    OPERATOR_EQUIVALENCE_ASSERTION_VERSION,
    {
      source: "operator_ratified",
      authority_ref: assertion.authority_ref,
      canonical_collection_key: assertion.canonical_collection_key,
      deployment_ids: sortDigests(
        assertion.deployments.map((deployment) => deployment.deployment_id)
      ),
    }
  );
}

const OperatorAssertionWireSchema = Schema.Struct({
  schema_version: Schema.optionalWith(Schema.Literal(1), { exact: true }),
  authority_ref: NonEmptyString,
  canonical_collection_key: NonEmptyString,
  deployments: Schema.Array(Schema.Unknown).pipe(Schema.minItems(1)),
  approved_at: IsoUtcTimestamp,
  source_reference: NonEmptyString,
  assertion_digest: Schema.optionalWith(Schema.Unknown, { exact: true }),
});

const decodeOperatorAssertionWire = Schema.decodeUnknownEither(
  OperatorAssertionWireSchema,
  STRICT_DECODE_OPTIONS
);

/**
 * Strict-decode an operator equivalence assertion at every public
 * post-authority mutation boundary. Recomputes `mintOperatorAssertionDigest`
 * from authority_ref + canonical key + exact sorted deployment set and
 * refuses zeroed/grafted/mismatched digests, unknown majors, excess fields,
 * and noncanonical duplicate set forms.
 */
export function decodeOperatorEquivalenceAssertion(
  input: unknown
): OperatorEquivalenceAssertion {
  const envelope = decodeOperatorAssertionWire(input);
  if (Either.isLeft(envelope)) {
    throw new ValidationError(
      "operator_assertion",
      input,
      "a strict operator equivalence assertion { authority_ref, " +
        "canonical_collection_key, deployments (≥1), approved_at, source_reference " +
        "[, assertion_digest] } — " +
        String(envelope.left)
    );
  }
  const wire = envelope.right;
  const deployments = wire.deployments.map((deployment, index) =>
    decodeEmbeddedDeployment(`operator_assertion.deployments[${index}]`, deployment)
  );
  const byDigest = new Map(
    deployments.map((deployment) => [deployment.deployment_id.digest, deployment])
  );
  if (byDigest.size !== deployments.length) {
    throw new ValidationError(
      "operator_assertion.deployments",
      wire.deployments,
      "a duplicate-free deployment set (canonical set rule)"
    );
  }
  const sorted = [...deployments].sort((l, r) =>
    compareStrings(digestKeyOf(l.deployment_id), digestKeyOf(r.deployment_id))
  );
  const assertion_digest = mintOperatorAssertionDigest({
    authority_ref: wire.authority_ref,
    canonical_collection_key: wire.canonical_collection_key,
    deployments: sorted,
  });
  if (wire.assertion_digest !== undefined) {
    const supplied = wire.assertion_digest as {
      domain?: unknown;
      major_version?: unknown;
      digest?: unknown;
    };
    if (
      typeof supplied !== "object" ||
      supplied === null ||
      supplied.domain !== assertion_digest.domain ||
      supplied.major_version !== assertion_digest.major_version ||
      supplied.digest !== assertion_digest.digest
    ) {
      throw new ValidationError(
        "operator_assertion.assertion_digest",
        wire.assertion_digest,
        `digest recomputed from authority_ref + canonical_collection_key + sorted ` +
          `deployment set (${assertion_digest.digest})`
      );
    }
  }
  return {
    authority_ref: wire.authority_ref,
    canonical_collection_key: wire.canonical_collection_key,
    deployments: sorted,
    approved_at: wire.approved_at,
    source_reference: wire.source_reference,
    assertion_digest,
  };
}

function decodeEmbeddedDeployment(
  field: string,
  value: unknown
): CollectionDeploymentRef {
  try {
    return decodeDeploymentReference(value);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError(field, value, error.expected);
    }
    throw error;
  }
}

/**
 * Decode one explicit evidence batch. The envelope is strict-decoded (excess
 * properties rejected); embedded deployment references decode through the
 * CR-001 package. Returns evidence whose deployment refs are all
 * protocol-verified and whose batch digest is deterministically minted.
 */
export function decodeBackfillEvidence(input: unknown): BackfillEvidence {
  const envelope = decodeEvidenceEnvelope(input);
  if (Either.isLeft(envelope)) {
    throw new ValidationError(
      "backfill_evidence",
      input,
      `a schema_version 1 evidence batch { observations, proxy_implementations, ` +
        `operator_assertions } with strict fields — ${String(envelope.left)}`
    );
  }

  const observations: SonarObservation[] = envelope.right.observations.map(
    (observation, index) =>
      observation.kind === "deployment"
        ? {
            kind: "deployment",
            deployment: decodeEmbeddedDeployment(
              `observations[${index}].deployment`,
              observation.deployment
            ),
            collection_key: observation.collection_key,
            observed_at: observation.observed_at,
            source_reference: observation.source_reference,
          }
        : {
            kind: "unidentified",
            raw_reference: observation.raw_reference,
            reason: observation.reason,
            observed_at: observation.observed_at,
            source_reference: observation.source_reference,
          }
  );

  const proxies: ProxyImplementationEvidence[] =
    envelope.right.proxy_implementations.map((evidence, index) => {
      const proxy = decodeEmbeddedDeployment(
        `proxy_implementations[${index}].proxy`,
        evidence.proxy
      );
      const implementation = decodeEmbeddedDeployment(
        `proxy_implementations[${index}].implementation`,
        evidence.implementation
      );
      if (proxy.deployment_id.digest === implementation.deployment_id.digest) {
        throw new ValidationError(
          `proxy_implementations[${index}]`,
          evidence,
          "a proxy and implementation with DISTINCT deployment identity — a deployment cannot be its own implementation evidence"
        );
      }
      return {
        proxy,
        implementation,
        proxy_standard: evidence.proxy_standard,
        observed_at: evidence.observed_at,
        source_reference: evidence.source_reference,
      };
    });

  const assertions: OperatorEquivalenceAssertion[] =
    envelope.right.operator_assertions.map((assertion) =>
      decodeOperatorEquivalenceAssertion(assertion)
    );

  const evidence_digest = mintDigest(
    BACKFILL_DIGEST_DOMAINS.evidence,
    BACKFILL_DIGEST_VERSION,
    {
      observations: observations.map((observation) =>
        observation.kind === "deployment"
          ? {
              kind: observation.kind,
              deployment_id: observation.deployment.deployment_id,
              collection_key: observation.collection_key,
              observed_at: observation.observed_at,
              source_reference: observation.source_reference,
            }
          : observation
      ),
      proxy_implementations: proxies.map((evidence) => ({
        proxy_id: evidence.proxy.deployment_id,
        implementation_id: evidence.implementation.deployment_id,
        proxy_standard: evidence.proxy_standard,
        observed_at: evidence.observed_at,
        source_reference: evidence.source_reference,
      })),
      operator_assertions: assertions.map((assertion) => assertion.assertion_digest),
    }
  );

  return {
    observations,
    proxy_implementations: proxies,
    operator_assertions: assertions,
    evidence_digest,
  };
}

// ── Identity records (the immutable unit the ledger stores) ─────────────────

export type BackfillRecordStatus = "active" | "superseded" | "revoked";

/**
 * The immutable creation content of one identity version. `record_digest`
 * covers exactly these fields; lifecycle status is ledger view-state derived
 * from events (records themselves never mutate — supersession and revocation
 * are new events, never edits).
 */
/**
 * Recoverable proxy→implementation binding persisted on each identity
 * version. CR-001 `Provenance` only stores an evidence digest, so this
 * parallel list is what later plans compare against when new proxy evidence
 * arrives for the same deployment across batches.
 */
export interface RecordedProxyImplementation {
  readonly proxy_id: VersionedDigest;
  readonly implementation_id: VersionedDigest;
  readonly proxy_standard: string;
  readonly source_reference: string;
  readonly observed_at: string;
}

export interface BackfillRecordContent {
  readonly schema_version: 1;
  /** Logical collection key this identity version serves (registry join key). */
  readonly collection_key: string;
  /** 1-based, monotonic per collection_key across ALL statuses. */
  readonly identity_version: number;
  /** Full CR-001 identity — package-assembled, collection_id minted. */
  readonly identity: CollectionIdentity;
  /** CR-001 provenance entries in source-precedence order (operator → curated → observed → onchain). */
  readonly provenance: readonly Provenance[];
  /**
   * On-chain proxy implementation bindings recorded into this version.
   * Empty when no proxy evidence has been observed; never inferred as
   * "unchanged" from absence of a later batch's evidence.
   */
  readonly proxy_implementations: readonly RecordedProxyImplementation[];
  readonly record_digest: VersionedDigest;
}

/** A record as materialized by the ledger: immutable content + view status. */
export interface BackfillIdentityRecord extends BackfillRecordContent {
  readonly status: BackfillRecordStatus;
}

function recordDigestMaterial(
  content: Omit<BackfillRecordContent, "record_digest">
): unknown {
  return {
    schema_version: content.schema_version,
    collection_key: content.collection_key,
    ...(content.identity.collection_key !== undefined
      ? { identity_collection_key: content.identity.collection_key }
      : {}),
    identity_version: content.identity_version,
    collection_id: content.identity.collection_id,
    deployment_ids: content.identity.deployments.map(
      (deployment) => deployment.deployment_id
    ),
    equivalence_basis: content.identity.equivalence_basis,
    provenance: content.provenance,
    proxy_implementations: content.proxy_implementations.map((binding) => ({
      proxy_id: binding.proxy_id,
      implementation_id: binding.implementation_id,
      proxy_standard: binding.proxy_standard,
      source_reference: binding.source_reference,
      observed_at: binding.observed_at,
    })),
  };
}

/** Mint the immutable digest of one record's creation content. */
export function mintRecordDigest(
  content: Omit<BackfillRecordContent, "record_digest">
): VersionedDigest {
  return mintDigest(
    BACKFILL_DIGEST_DOMAINS.record,
    BACKFILL_DIGEST_VERSION,
    recordDigestMaterial(content)
  );
}

/**
 * Deterministic digest of a materialized record set — the ledger's
 * `state_digest`, and the value plans bind to as `base_state_digest`. Covers
 * every record (any status) so a supersession or revocation moves the state
 * digest even though record contents are immutable.
 */
export function stateDigestOf(
  records: readonly BackfillIdentityRecord[]
): VersionedDigest {
  const material = [...records]
    .sort(
      (l, r) =>
        compareStrings(l.collection_key, r.collection_key) ||
        l.identity_version - r.identity_version
    )
    .map((record) => ({
      collection_key: record.collection_key,
      identity_version: record.identity_version,
      record_digest: record.record_digest,
      status: record.status,
    }));
  return mintDigest(BACKFILL_DIGEST_DOMAINS.state, BACKFILL_DIGEST_VERSION, material);
}

/**
 * Deterministic digest of the registry snapshot's identity-relevant material.
 * Binds plans and parity proofs to the exact curated content they were
 * computed against — including the exact-hit metadata surface, so a metadata
 * edit invalidates a stale plan instead of being silently carried.
 */
export function registrySnapshotDigestOf(
  registry: readonly CollectionRegistryEntry[]
): VersionedDigest {
  const material = [...registry]
    .map((entry) => {
      const refs = registryDeploymentRefsOf(entry);
      return {
        collection_key: entry.collectionKey,
        deployment_ids: sortDigests(refs.map((ref) => ref.deployment_id)),
        name: entry.name,
        symbol: entry.symbol,
        aliases: [...entry.aliases],
        total_supply: entry.totalSupply,
        enabled: entry.enabled,
        metadata_strategy: entry.metadataStrategy,
        rehost_policy: effectiveRehostPolicy(entry),
        ...(entry.imageHost && entry.imageHost.length > 0
          ? { image_host: [...entry.imageHost] }
          : {}),
      };
    })
    .sort((l, r) => compareStrings(l.collection_key, r.collection_key));
  return mintDigest(
    BACKFILL_DIGEST_DOMAINS.registry_snapshot,
    BACKFILL_DIGEST_VERSION,
    material
  );
}

// ── Plan contract ────────────────────────────────────────────────────────────

export const BACKFILL_ACTIONS = [
  "create",
  "noop",
  "update",
  "quarantine",
  "blocked",
] as const;
export type BackfillAction = (typeof BACKFILL_ACTIONS)[number];

export const BACKFILL_REASON_CODES = [
  // create / noop / update
  "new_identity",
  "identity_unchanged",
  "identity_material_changed",
  "provenance_extended",
  // quarantine — row-scoped (the curated row is withheld from this wave)
  "observed_collection_key_conflict",
  "proxy_implementation_changed",
  "assertion_splits_curated_row",
  "conflicting_operator_assertions",
  // quarantine — evidence-scoped (no curated row to withhold)
  "observed_deployment_uncurated",
  "proxy_evidence_uncurated",
  "missing_network_identity",
  "assertion_canonical_key_not_member",
  // blocked — valid input that this phase must not apply
  "merge_requires_post_authority_revision",
  "assertion_references_uncurated_deployment",
] as const;
export type BackfillReasonCode = (typeof BACKFILL_REASON_CODES)[number];

export interface BackfillPlanItem {
  readonly action: BackfillAction;
  readonly reason_code: BackfillReasonCode;
  /** Human-auditable specifics (row keys, conflicting values, raw refs). */
  readonly detail: string;
  /** Present for row-scoped items; absent for evidence-scoped items. */
  readonly collection_key?: string;
  /** Sorted deployment_id digests this item concerns (may be empty ONLY for missing-identity items). */
  readonly affected_deployment_ids: readonly VersionedDigest[];
  /** Sorted unique source references of every evidence row that led here. */
  readonly evidence_refs: readonly string[];
  /** Active record digest before this wave (absent when none exists). */
  readonly before_record_digest?: VersionedDigest;
  /** Record digest after this wave (absent for quarantine/blocked). */
  readonly after_record_digest?: VersionedDigest;
  /** Full immutable content apply will write — create/update only. */
  readonly proposed?: BackfillRecordContent;
}

export interface BackfillPlan {
  readonly schema_version: 1;
  readonly contract_version: typeof IDENTITY_BACKFILL_CONTRACT_VERSION;
  /** State digest of the materialized records the plan was computed against. */
  readonly base_state_digest: VersionedDigest;
  readonly registry_digest: VersionedDigest;
  readonly evidence_digest: VersionedDigest;
  /** When the registry snapshot was taken (caller-supplied, UTC Z). */
  readonly registry_observed_at: string;
  readonly items: readonly BackfillPlanItem[];
  readonly counts: Readonly<Record<BackfillAction, number>>;
  /** Deterministic digest over everything above — apply re-mints and verifies. */
  readonly plan_digest: VersionedDigest;
}

/** Material the plan digest binds (everything except the digest itself). */
export function mintPlanDigest(plan: Omit<BackfillPlan, "plan_digest">): VersionedDigest {
  return mintDigest(BACKFILL_DIGEST_DOMAINS.plan, BACKFILL_DIGEST_VERSION, {
    schema_version: plan.schema_version,
    contract_version: plan.contract_version,
    base_state_digest: plan.base_state_digest,
    registry_digest: plan.registry_digest,
    evidence_digest: plan.evidence_digest,
    registry_observed_at: plan.registry_observed_at,
    counts: plan.counts,
    items: plan.items.map((item) => ({
      action: item.action,
      reason_code: item.reason_code,
      detail: item.detail,
      ...(item.collection_key !== undefined
        ? { collection_key: item.collection_key }
        : {}),
      affected_deployment_ids: item.affected_deployment_ids,
      evidence_refs: item.evidence_refs,
      ...(item.before_record_digest !== undefined
        ? { before_record_digest: item.before_record_digest }
        : {}),
      ...(item.after_record_digest !== undefined
        ? { after_record_digest: item.after_record_digest }
        : {}),
      ...(item.proposed !== undefined
        ? { proposed_record_digest: item.proposed.record_digest }
        : {}),
    })),
  });
}

// ── Provenance assembly (CR-001 Provenance, protocol-validated) ─────────────

const decodeProvenanceStrict = Schema.decodeUnknownEither(
  Provenance,
  STRICT_DECODE_OPTIONS
);

/**
 * Assemble one CR-001 Provenance entry. `evidence_digest` MUST use the
 * package's `collection.provenance` domain (schema-enforced there), so the
 * evidence material is digested under that domain here. The assembled entry
 * is strict-decoded through the package schema — a malformed entry is a bug,
 * not data.
 */
function mintProvenance(
  source: "operator_ratified" | "inventory_registry" | "sonar_probe" | "onchain",
  sourceReference: string,
  observedAt: string,
  evidenceMaterial: unknown
): Provenance {
  const candidate = {
    schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
    source,
    source_reference: sourceReference,
    observed_at: observedAt,
    evidence_digest: mintDigest(DIGEST_DOMAINS.provenance, 1, {
      source,
      material: evidenceMaterial,
    }),
  };
  const decoded = decodeProvenanceStrict(candidate);
  if (Either.isLeft(decoded)) {
    throw new ValidationError(
      "provenance",
      candidate,
      `a CR-001 Provenance entry — ${String(decoded.left)}`
    );
  }
  return decoded.right;
}

// ── Planner ──────────────────────────────────────────────────────────────────

export interface BackfillPlanInput {
  /** The curated registry snapshot (normally `listCollectionRegistry()`). */
  readonly registry: readonly CollectionRegistryEntry[];
  /** Currently materialized records (all statuses) — `ledger.records`. */
  readonly current_records: readonly BackfillIdentityRecord[];
  /** One explicit, already-decoded evidence batch. */
  readonly evidence: BackfillEvidence;
  /** When the registry snapshot was taken (UTC Z) — provenance `observed_at`. */
  readonly registry_observed_at: string;
}

interface RowState {
  readonly entry: CollectionRegistryEntry;
  readonly refs: readonly CollectionDeploymentRef[];
  readonly digestSet: ReadonlySet<string>;
  readonly confirmations: SonarDeploymentObservation[];
  readonly conflicts: SonarDeploymentObservation[];
  readonly proxyEvidence: ProxyImplementationEvidence[];
  readonly proxyChanged: ProxyImplementationEvidence[][];
  ratifiedBy: OperatorEquivalenceAssertion | undefined;
  readonly quarantines: {
    reason: BackfillReasonCode;
    detail: string;
    refs: readonly string[];
  }[];
}

/**
 * The pure dry-run planner. Deterministic: no I/O, no clock, stable ordering;
 * same inputs mint the same `plan_digest`. Registry rows that cannot produce
 * verified CR-001 identity THROW (fail-closed, same doctrine as the CR-105
 * index build — a broken curated row is a configuration defect, not a
 * migration state). Evidence-shaped problems never throw: they classify into
 * quarantine/blocked items with reason codes.
 */
export function planIdentityBackfill(input: BackfillPlanInput): BackfillPlan {
  const registryObservedAt = assertIsoUtcTimestamp(
    input.registry_observed_at,
    "registry_observed_at"
  );

  // Registry index (fail-closed on rows; refuses cross-row duplicates).
  const rows = new Map<string, RowState>();
  const rowByDeploymentDigest = new Map<string, RowState>();
  for (const entry of input.registry) {
    if (rows.has(entry.collectionKey)) {
      throw new ValidationError(
        "registry",
        entry.collectionKey,
        "unique collection_key per registry row — duplicate keys make the backfill join ambiguous"
      );
    }
    const refs = registryDeploymentRefsOf(entry);
    const state: RowState = {
      entry,
      refs,
      digestSet: new Set(refs.map((ref) => ref.deployment_id.digest)),
      confirmations: [],
      conflicts: [],
      proxyEvidence: [],
      proxyChanged: [],
      ratifiedBy: undefined,
      quarantines: [],
    };
    for (const ref of refs) {
      const existing = rowByDeploymentDigest.get(ref.deployment_id.digest);
      if (existing) {
        throw new ValidationError(
          "registry",
          ref.normalized_address,
          `a deployment asserted by exactly one row — ` +
            `"${existing.entry.collectionKey}" and "${entry.collectionKey}" both assert it`
        );
      }
      rowByDeploymentDigest.set(ref.deployment_id.digest, state);
    }
    rows.set(entry.collectionKey, state);
  }

  // Current-record index (active only participates in diffing).
  const activeByKey = new Map<string, BackfillIdentityRecord>();
  const versionCeiling = new Map<string, number>();
  for (const record of input.current_records) {
    versionCeiling.set(
      record.collection_key,
      Math.max(versionCeiling.get(record.collection_key) ?? 0, record.identity_version)
    );
    if (record.status !== "active") continue;
    if (activeByKey.has(record.collection_key)) {
      throw new ValidationError(
        "current_records",
        record.collection_key,
        "at most one ACTIVE record per collection_key"
      );
    }
    activeByKey.set(record.collection_key, record);
  }

  const evidenceItems: BackfillPlanItem[] = [];

  // ── Observed Sonar identity: confirm, conflict, uncurated, unidentified ──
  const uncuratedObservations = new Map<string, SonarDeploymentObservation[]>();
  for (const observation of input.evidence.observations) {
    if (observation.kind === "unidentified") {
      evidenceItems.push({
        action: "quarantine",
        reason_code: "missing_network_identity",
        detail:
          `observed record "${observation.raw_reference}" carries no CR-001 network ` +
          `identity (${observation.reason}); refusing to guess a deployment reference`,
        affected_deployment_ids: [],
        evidence_refs: [observation.source_reference],
      });
      continue;
    }
    const row = rowByDeploymentDigest.get(observation.deployment.deployment_id.digest);
    if (!row) {
      const key = observation.deployment.deployment_id.digest;
      const bucket = uncuratedObservations.get(key) ?? [];
      bucket.push(observation);
      uncuratedObservations.set(key, bucket);
      continue;
    }
    if (observation.collection_key === row.entry.collectionKey) {
      row.confirmations.push(observation);
    } else {
      row.conflicts.push(observation);
    }
  }
  for (const bucket of uncuratedObservations.values()) {
    const first = bucket[0]!;
    evidenceItems.push({
      action: "quarantine",
      reason_code: "observed_deployment_uncurated",
      detail:
        `sonar observes ${first.deployment.network.network_namespace}:` +
        `${first.deployment.network.network_reference}:${first.deployment.normalized_address} ` +
        `under collection_key ${uniqueSorted(bucket.map((o) => o.collection_key)).join(", ")} ` +
        `but no curated row asserts it; the backfill never invents a collection`,
      affected_deployment_ids: [first.deployment.deployment_id],
      evidence_refs: uniqueSorted(bucket.map((o) => o.source_reference)),
    });
  }

  // ── Proxy implementation evidence: provenance or code/proxy-change ──────
  // Compare the current batch against prior bindings persisted on active
  // records. Absence of new evidence never means "unchanged"; only an
  // explicit later binding that disagrees with a prior one quarantines.
  const proxyByDigest = new Map<string, ProxyImplementationEvidence[]>();
  for (const evidence of input.evidence.proxy_implementations) {
    const key = evidence.proxy.deployment_id.digest;
    const bucket = proxyByDigest.get(key) ?? [];
    bucket.push(evidence);
    proxyByDigest.set(key, bucket);
  }
  for (const bucket of proxyByDigest.values()) {
    const first = bucket[0]!;
    const row = rowByDeploymentDigest.get(first.proxy.deployment_id.digest);
    const batchImplementations = uniqueSorted(
      bucket.map((evidence) => evidence.implementation.deployment_id.digest)
    );
    if (!row) {
      evidenceItems.push({
        action: "quarantine",
        reason_code: "proxy_evidence_uncurated",
        detail:
          `proxy implementation evidence names uncurated proxy ` +
          `${first.proxy.network.network_namespace}:${first.proxy.network.network_reference}:` +
          `${first.proxy.normalized_address}; no curated row to attach it to`,
        affected_deployment_ids: [first.proxy.deployment_id],
        evidence_refs: uniqueSorted(bucket.map((evidence) => evidence.source_reference)),
      });
      continue;
    }
    const active = activeByKey.get(row.entry.collectionKey);
    const priorImplDigests = uniqueSorted(
      (active?.proxy_implementations ?? [])
        .filter((binding) => binding.proxy_id.digest === first.proxy.deployment_id.digest)
        .map((binding) => binding.implementation_id.digest)
    );
    const combined = uniqueSorted([...batchImplementations, ...priorImplDigests]);
    if (combined.length > 1) {
      row.proxyChanged.push(bucket);
    } else {
      row.proxyEvidence.push(...bucket);
    }
  }

  // ── Operator-approved equivalence ────────────────────────────────────────
  // Dedupe identical edges (same assertion digest = same approval act).
  const assertionsByDigest = new Map<string, OperatorEquivalenceAssertion>();
  for (const assertion of input.evidence.operator_assertions) {
    assertionsByDigest.set(assertion.assertion_digest.digest, assertion);
  }
  const assertions = [...assertionsByDigest.values()].sort((l, r) =>
    compareStrings(l.authority_ref, r.authority_ref)
  );

  // Deployment → claiming assertions (differing edges on one deployment conflict).
  const claims = new Map<string, OperatorEquivalenceAssertion[]>();
  for (const assertion of assertions) {
    for (const deployment of assertion.deployments) {
      const key = deployment.deployment_id.digest;
      const bucket = claims.get(key) ?? [];
      bucket.push(assertion);
      claims.set(key, bucket);
    }
  }
  const conflictingAssertionDigests = new Set<string>();
  for (const bucket of claims.values()) {
    if (bucket.length > 1) {
      for (const assertion of bucket) {
        conflictingAssertionDigests.add(assertion.assertion_digest.digest);
      }
    }
  }

  for (const assertion of assertions) {
    const assertionRefs = uniqueSorted([assertion.source_reference, assertion.authority_ref]);
    const assertionIds = assertion.deployments.map(
      (deployment) => deployment.deployment_id
    );

    if (conflictingAssertionDigests.has(assertion.assertion_digest.digest)) {
      // Quarantine every curated row the conflicting edges touch, once below;
      // the assertion itself is also surfaced as an evidence-scoped item so
      // the report names the ambiguous grouping explicitly.
      for (const deployment of assertion.deployments) {
        const row = rowByDeploymentDigest.get(deployment.deployment_id.digest);
        if (row && !row.quarantines.some((q) => q.reason === "conflicting_operator_assertions")) {
          row.quarantines.push({
            reason: "conflicting_operator_assertions",
            detail:
              `deployment ${deployment.normalized_address} is claimed by more than one ` +
              `operator equivalence assertion with differing groupings; ambiguous grouping ` +
              `never auto-resolves`,
            refs: assertionRefs,
          });
        }
      }
      evidenceItems.push({
        action: "quarantine",
        reason_code: "conflicting_operator_assertions",
        detail:
          `operator assertion ${assertion.authority_ref} overlaps another assertion on at ` +
          `least one deployment; conflicting operator edges quarantine instead of ranking`,
        affected_deployment_ids: sortDigests(assertionIds),
        evidence_refs: assertionRefs,
      });
      continue;
    }

    const memberRows = new Set<RowState>();
    const uncurated: CollectionDeploymentRef[] = [];
    for (const deployment of assertion.deployments) {
      const row = rowByDeploymentDigest.get(deployment.deployment_id.digest);
      if (row) {
        memberRows.add(row);
      } else {
        uncurated.push(deployment);
      }
    }

    if (uncurated.length > 0) {
      evidenceItems.push({
        action: "blocked",
        reason_code: "assertion_references_uncurated_deployment",
        detail:
          `operator assertion ${assertion.authority_ref} references ` +
          `${uncurated.length} deployment(s) no curated row asserts ` +
          `(first: ${uncurated[0]!.normalized_address}); curate them before the edge can apply`,
        affected_deployment_ids: sortDigests(assertionIds),
        evidence_refs: assertionRefs,
      });
      continue;
    }

    const rowsCoveredWholly = [...memberRows].every((row) =>
      row.refs.every((ref) => assertion.deployments.some(
        (deployment) => deployment.deployment_id.digest === ref.deployment_id.digest
      ))
    );
    if (!rowsCoveredWholly) {
      for (const row of memberRows) {
        row.quarantines.push({
          reason: "assertion_splits_curated_row",
          detail:
            `operator assertion ${assertion.authority_ref} covers only part of curated row ` +
            `"${row.entry.collectionKey}" — a partial-row grouping is ambiguous; ` +
            `correct the registry row or the assertion`,
          refs: assertionRefs,
        });
      }
      continue;
    }

    const memberKeys = [...memberRows]
      .map((row) => row.entry.collectionKey)
      .sort(compareStrings);
    if (!memberKeys.includes(assertion.canonical_collection_key)) {
      evidenceItems.push({
        action: "quarantine",
        reason_code: "assertion_canonical_key_not_member",
        detail:
          `operator assertion ${assertion.authority_ref} names canonical_collection_key ` +
          `"${assertion.canonical_collection_key}" which is not among its member rows ` +
          `(${memberKeys.join(", ")}); refusing to serve metadata for an unknown key`,
        affected_deployment_ids: sortDigests(assertionIds),
        evidence_refs: assertionRefs,
      });
      continue;
    }

    if (memberRows.size === 1) {
      // Exact whole-row ratification: operator authority CONFIRMS curation —
      // recorded as provenance; resolves that row's observed/proxy conflicts.
      const [row] = memberRows;
      row!.ratifiedBy = assertion;
      continue;
    }

    // Whole-row merge: legitimate operator equivalence, but applying it
    // pre-authority would change the served equivalence away from the legacy
    // read and break the parity gate by construction. It waits for the
    // post-authority revision path (identity-ledger.applyOperatorRevision).
    evidenceItems.push({
      action: "blocked",
      reason_code: "merge_requires_post_authority_revision",
      detail:
        `operator assertion ${assertion.authority_ref} merges curated rows ` +
        `[${memberKeys.join(", ")}] into "${assertion.canonical_collection_key}"; ` +
        `whole-row merges apply as post-authority append-only revisions so the ` +
        `pre-cutover old/new read parity proof stays intact`,
      affected_deployment_ids: sortDigests(assertionIds),
      evidence_refs: assertionRefs,
    });
  }

  // ── Row classification ──────────────────────────────────────────────────
  const rowItems: BackfillPlanItem[] = [];
  for (const row of rows.values()) {
    const entry = row.entry;
    const active = activeByKey.get(entry.collectionKey);
    const rowIds = sortDigests(row.refs.map((ref) => ref.deployment_id));

    const quarantines = [...row.quarantines];
    if (row.conflicts.length > 0 && row.ratifiedBy === undefined) {
      const observedKeys = uniqueSorted(row.conflicts.map((o) => o.collection_key));
      quarantines.push({
        reason: "observed_collection_key_conflict",
        detail:
          `sonar observes collection_key "${observedKeys.join('", "')}" for a deployment ` +
          `curated under "${entry.collectionKey}"; observed and curated identity conflict — ` +
          `neither wins without an operator ratification`,
        refs: uniqueSorted(row.conflicts.map((o) => o.source_reference)),
      });
    }
    if (row.proxyChanged.length > 0 && row.ratifiedBy === undefined) {
      const refs = uniqueSorted(
        row.proxyChanged.flat().map((evidence) => evidence.source_reference)
      );
      quarantines.push({
        reason: "proxy_implementation_changed",
        detail:
          `proxy implementation evidence for row "${entry.collectionKey}" names more than ` +
          `one implementation over time (code/proxy change); identity assumptions must be ` +
          `re-verified or operator-ratified before this row migrates`,
        refs,
      });
    }

    if (quarantines.length > 0) {
      for (const quarantine of quarantines) {
        rowItems.push({
          action: "quarantine",
          reason_code: quarantine.reason,
          detail: quarantine.detail,
          collection_key: entry.collectionKey,
          affected_deployment_ids: rowIds,
          evidence_refs: quarantine.refs,
          ...(active !== undefined
            ? { before_record_digest: active.record_digest }
            : {}),
        });
      }
      continue;
    }

    // Provenance in source-precedence order: operator → curated → observed → onchain.
    const provenance: Provenance[] = [];
    if (row.ratifiedBy !== undefined) {
      provenance.push(
        mintProvenance(
          "operator_ratified",
          row.ratifiedBy.authority_ref,
          row.ratifiedBy.approved_at,
          { assertion_digest: row.ratifiedBy.assertion_digest }
        )
      );
    }
    const rowIdentity = mintRegistryRowIdentity(entry);
    provenance.push(
      mintProvenance(
        "inventory_registry",
        `inventory-registry:${entry.collectionKey}`,
        registryObservedAt,
        {
          collection_key: entry.collectionKey,
          deployment_ids: rowIds,
        }
      )
    );
    const confirmations = [...row.confirmations].sort(
      (l, r) =>
        compareStrings(l.observed_at, r.observed_at) ||
        compareStrings(l.source_reference, r.source_reference) ||
        compareStrings(l.deployment.deployment_id.digest, r.deployment.deployment_id.digest)
    );
    for (const observation of confirmations) {
      provenance.push(
        mintProvenance("sonar_probe", observation.source_reference, observation.observed_at, {
          deployment_id: observation.deployment.deployment_id,
          collection_key: observation.collection_key,
        })
      );
    }
    const proxyEvidence = [...row.proxyEvidence].sort(
      (l, r) =>
        compareStrings(l.observed_at, r.observed_at) ||
        compareStrings(l.source_reference, r.source_reference)
    );
    // Persist recoverable proxy bindings: carry prior bindings forward and
    // merge any new batch evidence. Absence of new evidence does not drop
    // prior bindings and does not claim "unchanged" — it simply retains what
    // was already proven. Re-emit onchain provenance for carried bindings so
    // a later empty batch does not silently erase prior onchain material.
    const priorBindings = active?.proxy_implementations ?? [];
    const bindingByKey = new Map<string, RecordedProxyImplementation>();
    for (const binding of priorBindings) {
      const key = `${binding.proxy_id.digest}:${binding.implementation_id.digest}:${binding.source_reference}`;
      bindingByKey.set(key, binding);
    }
    for (const evidence of proxyEvidence) {
      const recorded: RecordedProxyImplementation = {
        proxy_id: evidence.proxy.deployment_id,
        implementation_id: evidence.implementation.deployment_id,
        proxy_standard: evidence.proxy_standard,
        source_reference: evidence.source_reference,
        observed_at: evidence.observed_at,
      };
      const key = `${recorded.proxy_id.digest}:${recorded.implementation_id.digest}:${recorded.source_reference}`;
      bindingByKey.set(key, recorded);
    }
    const proxy_implementations = [...bindingByKey.values()].sort(
      (l, r) =>
        compareStrings(digestKeyOf(l.proxy_id), digestKeyOf(r.proxy_id)) ||
        compareStrings(digestKeyOf(l.implementation_id), digestKeyOf(r.implementation_id)) ||
        compareStrings(l.source_reference, r.source_reference)
    );
    for (const binding of proxy_implementations) {
      provenance.push(
        mintProvenance("onchain", binding.source_reference, binding.observed_at, {
          proxy_id: binding.proxy_id,
          implementation_id: binding.implementation_id,
          proxy_standard: binding.proxy_standard,
        })
      );
    }

    const evidenceRefs = uniqueSorted([
      `inventory-registry:${entry.collectionKey}`,
      ...(row.ratifiedBy !== undefined
        ? [row.ratifiedBy.authority_ref, row.ratifiedBy.source_reference]
        : []),
      ...confirmations.map((o) => o.source_reference),
      ...proxy_implementations.map((e) => e.source_reference),
    ]);

    if (active === undefined) {
      const content: Omit<BackfillRecordContent, "record_digest"> = {
        schema_version: 1,
        collection_key: entry.collectionKey,
        identity_version: (versionCeiling.get(entry.collectionKey) ?? 0) + 1,
        identity: rowIdentity.identity,
        provenance,
        proxy_implementations,
      };
      const proposed: BackfillRecordContent = {
        ...content,
        record_digest: mintRecordDigest(content),
      };
      rowItems.push({
        action: "create",
        reason_code: "new_identity",
        detail: `curated row "${entry.collectionKey}" enters the cross-VM identity model`,
        collection_key: entry.collectionKey,
        affected_deployment_ids: rowIds,
        evidence_refs: evidenceRefs,
        after_record_digest: proposed.record_digest,
        proposed,
      });
      continue;
    }

    const identityChanged =
      active.identity.collection_id.digest !== rowIdentity.identity.collection_id.digest ||
      active.collection_key !== entry.collectionKey;
    const provenanceChanged =
      JSON.stringify(active.provenance) !== JSON.stringify(provenance) ||
      JSON.stringify(active.proxy_implementations) !== JSON.stringify(proxy_implementations);

    if (!identityChanged && !provenanceChanged) {
      rowItems.push({
        action: "noop",
        reason_code: "identity_unchanged",
        detail: `curated row "${entry.collectionKey}" already holds this exact identity and provenance`,
        collection_key: entry.collectionKey,
        affected_deployment_ids: rowIds,
        evidence_refs: evidenceRefs,
        before_record_digest: active.record_digest,
        after_record_digest: active.record_digest,
      });
      continue;
    }

    const content: Omit<BackfillRecordContent, "record_digest"> = {
      schema_version: 1,
      collection_key: entry.collectionKey,
      identity_version: (versionCeiling.get(entry.collectionKey) ?? 0) + 1,
      identity: rowIdentity.identity,
      provenance,
      proxy_implementations,
    };
    const proposed: BackfillRecordContent = {
      ...content,
      record_digest: mintRecordDigest(content),
    };
    rowItems.push({
      action: "update",
      reason_code: identityChanged ? "identity_material_changed" : "provenance_extended",
      detail: identityChanged
        ? `curated row "${entry.collectionKey}" changed identity material (deployment set, ` +
          `equivalence basis, or collection_key); a new immutable version supersedes ` +
          `v${active.identity_version}`
        : `curated row "${entry.collectionKey}" gained evidence; a new immutable version ` +
          `extends provenance over v${active.identity_version}`,
      collection_key: entry.collectionKey,
      affected_deployment_ids: rowIds,
      evidence_refs: evidenceRefs,
      before_record_digest: active.record_digest,
      after_record_digest: proposed.record_digest,
      proposed,
    });
  }

  // ── Deterministic assembly ──────────────────────────────────────────────
  const items = [...rowItems, ...evidenceItems].sort((l, r) =>
    compareStrings(planItemSortKey(l), planItemSortKey(r))
  );
  const counts: Record<BackfillAction, number> = {
    create: 0,
    noop: 0,
    update: 0,
    quarantine: 0,
    blocked: 0,
  };
  for (const item of items) {
    counts[item.action] += 1;
  }

  const header: Omit<BackfillPlan, "plan_digest"> = {
    schema_version: 1,
    contract_version: IDENTITY_BACKFILL_CONTRACT_VERSION,
    base_state_digest: stateDigestOf(input.current_records),
    registry_digest: registrySnapshotDigestOf(input.registry),
    evidence_digest: input.evidence.evidence_digest,
    registry_observed_at: registryObservedAt,
    items,
    counts,
  };
  return { ...header, plan_digest: mintPlanDigest(header) };
}

function planItemSortKey(item: BackfillPlanItem): string {
  // Unit separator — never appears in keys/reason codes; keeps the source
  // file UTF-8 text (a literal NUL byte makes tooling treat the module as binary).
  const sep = "\u001f";
  return [
    item.collection_key ?? "~",
    item.action,
    item.reason_code,
    item.evidence_refs.join(","),
    item.affected_deployment_ids.map(digestKeyOf).join(","),
  ].join(sep);
}
