/**
 * CR-108 — The identity-backfill ledger: an append-only, hash-chained event
 * log with an explicit authority state machine.
 *
 * The ledger is the write half of the backfill substrate
 * (`identity-backfill.ts` is the read/planning half). Its rules are the CR-108
 * acceptance criteria, made mechanical:
 *
 * - **Append-only, immutable.** Every event and every materialized record is
 *   deep-frozen; events are hash-chained (each event's digest covers its
 *   content, and each event binds its predecessor's digest). There is no
 *   update-in-place API, no delete API, and replay re-verifies the chain, the
 *   package-minted `collection_id` of every stored identity, and every record
 *   digest — ad-hoc live-key surgery is not merely forbidden, it is
 *   tamper-evident.
 * - **Authority state machine.** `pre_authority`: plan → apply → rollback are
 *   legal; the served identity view is rehearsal only. Authority enablement
 *   requires (a) a passing old/new read-parity proof *recomputed* over the
 *   live ledger + registry snapshot for a genuinely new enablement command
 *   (optional caller-supplied expected report is audit-only and must equal
 *   that recomputed proof; identical accepted-command retries short-circuit
 *   before the recompute) and (b) a clean plan (zero quarantine) bound to the
 *   same state — conflicts keep production Ordering disabled.
 *   `authority_enabled`: apply and rollback are refused forever; the ONLY
 *   legal writes are append-only identity revisions (operator merges) and
 *   equivalence revocations, both of which supersede via NEW immutable
 *   identity versions.
 * - **CR-012A-compatible supersession trigger.** Every post-authority event
 *   enumerates the affected deployments and carries a quarantine/supersession
 *   impact set whose work rows and issued artifacts are EXPLICIT references
 *   supplied by the caller (Ordering's dependency ledger is the reachability
 *   authority per CR-012A). The impact set's `coverage:
 *   "explicit_references_only"` marker plus its mandatory `enumeration_ref`
 *   make the semantics unforgeable: an empty set means "this enumeration
 *   returned none", never "none exist". This module never invents reachable
 *   work rows or artifacts.
 * - **Revoked edges never come back.** A revocation records the invalidated
 *   equivalence assertion digest; any later identity whose basis carries that
 *   digest is refused at fold time. Re-approving the same grouping requires a
 *   fresh operator authority record, which mints a different assertion digest
 *   and therefore a different, new immutable identity version.
 *
 * Everything is deterministic: no I/O, no clock (timestamps are
 * caller-supplied inputs), canonical digests via the CR-001 package only, and
 * `serializeBackfillLedger` emits the package's canonical (RFC 8785) JSON so
 * the persisted artifact is byte-stable. `replayBackfillLedger` rebuilds the
 * materialized state through the exact fold the mutators use — one
 * implementation, so replay drift is unrepresentable.
 */
import { Effect, Either, Schema } from "effect";
import {
  COLLECTION_PROTOCOL_SCHEMA_VERSION,
  Provenance,
  VersionedDigest,
  canonicalize,
  decodeCollectionIdentity,
  decodeCollectionWorkKeyMaterial,
  digestCollectionWorkKey,
  makeCollectionIdentity,
  CollectionIdentity,
} from "@freeside/collection-protocol";
import {
  IDENTITY_BACKFILL_CONTRACT_VERSION,
  assertIsoUtcTimestamp,
  decodeOperatorEquivalenceAssertion,
  mintInventoryDigest,
  mintRecordDigest,
  registrySnapshotDigestOf,
  sortVersionedDigests,
  stateDigestOf,
  versionedDigestKeyOf,
  type BackfillAction,
  type BackfillIdentityRecord,
  type BackfillPlan,
  type BackfillPlanItem,
  type BackfillRecordContent,
  type BackfillRecordStatus,
  type OperatorEquivalenceAssertion,
  type RecordedProxyImplementation,
  BACKFILL_ACTIONS,
  BACKFILL_REASON_CODES,
  mintPlanDigest,
} from "./identity-backfill.js";
import {
  decodeDeploymentReference,
  mintRegistryRowIdentity,
} from "./exact-enrichment.js";
import type { CollectionRegistryEntry } from "./collection-registry.js";
import {
  proveLegacyNewParity,
  verifyAuthorityParityReport,
  type ReadParityReport,
} from "./identity-parity.js";
import { ValidationError } from "./errors.js";

export const IDENTITY_SUPERSESSION_CONTRACT_VERSION =
  "inventory.identity-supersession.v1";

const EVENT_DIGEST_DOMAIN = "inventory.backfill-event";
const REPORT_DIGEST_DOMAIN = "inventory.backfill-report";
const LEDGER_DIGEST_VERSION = 1;

// ── Typed errors (repo convention: Error subclasses with a const code) ──────

/** A verb was used in the wrong authority state (e.g. apply after cutover). */
export class BackfillAuthorityError extends Error {
  readonly code = "INVENTORY_BACKFILL_AUTHORITY" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackfillAuthorityError";
  }
}

/** The plan was computed against a state the ledger no longer holds. */
export class BackfillStalePlanError extends Error {
  readonly code = "INVENTORY_BACKFILL_STALE_PLAN" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackfillStalePlanError";
  }
}

/** Authority enablement was refused (parity/cleanliness requirements unmet). */
export class BackfillParityError extends Error {
  readonly code = "INVENTORY_BACKFILL_PARITY" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackfillParityError";
  }
}

/** The ledger's chain, digests, or structural invariants do not hold. */
export class BackfillIntegrityError extends Error {
  readonly code = "INVENTORY_BACKFILL_INTEGRITY" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackfillIntegrityError";
  }
}

/** A revision/revocation request is invalid (coverage, reuse, target state). */
export class BackfillRevocationError extends Error {
  readonly code = "INVENTORY_BACKFILL_REVOCATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackfillRevocationError";
  }
}

/**
 * Exact-command idempotency conflict: the same `command_id` was already
 * accepted with a DIFFERENT payload digest. Same id + same digest is a
 * no-op (idempotent replay); different payload is refused.
 */
export class BackfillCommandConflictError extends Error {
  readonly code = "INVENTORY_BACKFILL_COMMAND_CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackfillCommandConflictError";
  }
}

/**
 * Post-authority mutation outcome. Incomplete impact discovery never mutates
 * authoritative identity — callers receive a typed blocked result with the
 * ledger unchanged.
 */
export type PostAuthorityMutationResult =
  | { readonly status: "accepted"; readonly ledger: BackfillLedger }
  | {
      readonly status: "blocked";
      readonly reason_code: "discovery_incomplete";
      readonly ledger: BackfillLedger;
      readonly impact: QuarantineImpactSet;
      readonly detail: string;
    };

// ── Event contracts ──────────────────────────────────────────────────────────

/** Immutable pointer to one identity version. */
export interface RecordPointer {
  readonly collection_key: string;
  readonly identity_version: number;
  readonly record_digest: VersionedDigest;
}

/** One shared-work row reachable from a superseded identity (explicit ref). */
export interface WorkRowReference {
  /** The CR-001 shared work key (`collection.work-key` digest) of the row. */
  readonly work_key: VersionedDigest;
  /** Where the row lives (Ordering ledger row reference). */
  readonly reference: string;
}

/** One issued artifact reachable from a superseded identity (explicit ref). */
export interface IssuedArtifactReference {
  readonly reference: string;
  readonly artifact_digest?: VersionedDigest;
}

/**
 * CR-012A-compatible quarantine/supersession impact set. The rows and
 * artifacts are EXPLICIT references supplied by the caller from an actual
 * enumeration (Ordering's dependency ledger walk — `enumeration_ref` names
 * it, and is REQUIRED even when both sets are empty). `coverage` is a literal
 * so the semantics travel with the event: this event quarantines exactly the
 * listed references; it is NEVER a proof that no other reachable work exists.
 *
 * `discovery_complete` encodes whether THAT named enumeration finished:
 * - `false` + empty lists ⇒ incomplete walk; absence is unproven.
 * - `true` + empty lists ⇒ the named walk returned none; still not a proof
 *   that no other reachable work exists outside that enumeration.
 * Empty lists must never be read as "proven none" in either case.
 */
export interface QuarantineImpactSet {
  readonly schema_version: 1;
  readonly coverage: "explicit_references_only";
  readonly enumeration_ref: string;
  /** Whether the named enumeration completed. Empty lists never prove global absence. */
  readonly discovery_complete: boolean;
  readonly work_rows: readonly WorkRowReference[];
  readonly issued_artifacts: readonly IssuedArtifactReference[];
}

/** Plan item as recorded in the applied event (proposal stripped to digests). */
export interface AppliedPlanItemSummary {
  readonly action: BackfillAction;
  readonly reason_code: BackfillPlanItem["reason_code"];
  readonly detail: string;
  readonly collection_key?: string;
  readonly affected_deployment_ids: readonly VersionedDigest[];
  readonly evidence_refs: readonly string[];
  readonly before_record_digest?: VersionedDigest;
  readonly after_record_digest?: VersionedDigest;
}

interface EventBase {
  readonly schema_version: 1;
  /** 1-based, contiguous. */
  readonly sequence: number;
  /** Caller-supplied UTC Z timestamp — the ledger never reads a clock. */
  readonly occurred_at: string;
  /**
   * Exact-command idempotency key. Replaying the same id with the same
   * `command_digest` is a no-op; a different digest is a conflict.
   */
  readonly command_id: string;
  /**
   * Digest of the stable request payload (excludes sequence / prev / event
   * digest / derived created-record bodies that are fold outputs).
   */
  readonly command_digest: VersionedDigest;
  /** Chain link: the previous event's digest. Omitted on the first event. */
  readonly prev_event_digest?: VersionedDigest;
  /** Digest over this event's content (everything except this field). */
  readonly event_digest: VersionedDigest;
}

export interface BackfillAppliedEvent extends EventBase {
  readonly kind: "backfill_applied";
  readonly plan_digest: VersionedDigest;
  readonly base_state_digest: VersionedDigest;
  readonly registry_digest: VersionedDigest;
  readonly evidence_digest: VersionedDigest;
  readonly counts: Readonly<Record<BackfillAction, number>>;
  /** Full immutable contents of every record this apply created. */
  readonly created: readonly BackfillRecordContent[];
  /** Prior versions superseded by same-key created records (updates). */
  readonly superseded: readonly RecordPointer[];
  /** The complete plan item trail (auditable reconciliation lines). */
  readonly items: readonly AppliedPlanItemSummary[];
}

export interface BackfillRolledBackEvent extends EventBase {
  readonly kind: "backfill_rolled_back";
  /** Rewind point: materialized state returns to just after this sequence (0 = empty). */
  readonly through_sequence: number;
  readonly reason: string;
}

export interface AuthorityEnabledEvent extends EventBase {
  readonly kind: "authority_enabled";
  /** Digest of the passing read-parity report this enablement is bound to. */
  readonly parity_report_digest: VersionedDigest;
  /** Digest of the clean (zero-quarantine) plan bound to the same state. */
  readonly plan_digest: VersionedDigest;
  readonly state_digest: VersionedDigest;
  readonly registry_digest: VersionedDigest;
}

export type SupersessionCause = "operator_revision" | "equivalence_revocation";

export interface IdentitySupersededEvent extends EventBase {
  readonly kind: "identity_superseded";
  readonly contract_version: typeof IDENTITY_SUPERSESSION_CONTRACT_VERSION;
  readonly cause: SupersessionCause;
  /** Operator authority record authorizing this supersession. */
  readonly authority_ref: string;
  readonly reason: string;
  /** Every deployment whose logical identity changed — sorted, complete. */
  readonly affected_deployment_ids: readonly VersionedDigest[];
  /** Identity versions this event retires. */
  readonly superseded: readonly RecordPointer[];
  /** New immutable identity versions (full contents). */
  readonly successors: readonly BackfillRecordContent[];
  /** Equivalence assertion digests invalidated by this event (revocations). */
  readonly revoked_equivalence_digests: readonly VersionedDigest[];
  /** CR-012A quarantine/supersession trigger — explicit references only. */
  readonly impact: QuarantineImpactSet;
}

export type BackfillLedgerEvent =
  | BackfillAppliedEvent
  | BackfillRolledBackEvent
  | AuthorityEnabledEvent
  | IdentitySupersededEvent;

export type AuthorityState = "pre_authority" | "authority_enabled";

export interface BackfillLedger {
  readonly schema_version: 1;
  readonly contract_version: typeof IDENTITY_BACKFILL_CONTRACT_VERSION;
  readonly events: readonly BackfillLedgerEvent[];
  // Materialized view (derived from events by the fold, verified on replay):
  readonly authority: AuthorityState;
  readonly records: readonly BackfillIdentityRecord[];
  readonly state_digest: VersionedDigest;
  /** Canonical digest keys of every revoked equivalence assertion digest. */
  readonly revoked_equivalence: readonly string[];
  /**
   * Accepted exact-command ids → payload digests. Used for idempotent replay
   * and conflict detection; rebuilt from events on every materialize.
   */
  readonly accepted_commands: readonly {
    readonly command_id: string;
    readonly command_digest: VersionedDigest;
    readonly sequence: number;
  }[];
}

// ── Small utilities ──────────────────────────────────────────────────────────

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as unknown as Record<string, unknown>)[key]);
  }
  return value;
}

function runProtocol<A, E>(effect: Effect.Effect<A, E>): Either.Either<A, E> {
  return Effect.runSync(Effect.either(effect));
}

function recordKeyOf(pointer: { collection_key: string; identity_version: number }): string {
  return `${pointer.collection_key}#${pointer.identity_version}`;
}

function sameVersionedDigest(left: VersionedDigest, right: VersionedDigest): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.domain === right.domain &&
    left.major_version === right.major_version &&
    left.digest === right.digest
  );
}

// ── Structural event validation (strict envelopes + protocol re-verification) ─

const STRICT = { errors: "all", onExcessProperty: "error" } as const;
const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const PositiveInt = Schema.Number.pipe(Schema.int(), Schema.positive());
const Integer = Schema.Number.pipe(Schema.int());
const NonNegativeInt = Integer.pipe(Schema.nonNegative());

const WorkRowReferenceSchema = Schema.Struct({
  work_key: VersionedDigest,
  reference: NonEmptyString,
});

const IssuedArtifactReferenceSchema = Schema.Struct({
  reference: NonEmptyString,
  artifact_digest: Schema.optionalWith(VersionedDigest, { exact: true }),
});

const QuarantineImpactSetSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  coverage: Schema.Literal("explicit_references_only"),
  enumeration_ref: NonEmptyString,
  discovery_complete: Schema.Boolean,
  work_rows: Schema.Array(WorkRowReferenceSchema),
  issued_artifacts: Schema.Array(IssuedArtifactReferenceSchema),
});

const decodeImpactSet = Schema.decodeUnknownEither(QuarantineImpactSetSchema, STRICT);

/**
 * Decode a caller-supplied CR-012A impact set. Refuses a missing/empty
 * `enumeration_ref` — an impact set must always name the enumeration that
 * produced it, precisely so an empty set reads as "that walk returned none
 * or did not finish" (see `discovery_complete`) and can never masquerade as
 * proof of global absence.
 */
export function decodeQuarantineImpactSet(input: unknown): QuarantineImpactSet {
  const decoded = decodeImpactSet(input);
  if (Either.isLeft(decoded)) {
    throw new ValidationError(
      "impact",
      input,
      "a CR-012A impact set { schema_version: 1, coverage: \"explicit_references_only\", " +
        "enumeration_ref (non-empty), discovery_complete, work_rows, issued_artifacts } " +
        "with explicit references only — " +
        String(decoded.left)
    );
  }
  return decoded.right;
}

const RecordedProxyImplementationSchema = Schema.Struct({
  proxy_id: VersionedDigest,
  implementation_id: VersionedDigest,
  proxy_standard: NonEmptyString,
  source_reference: NonEmptyString,
  observed_at: NonEmptyString,
});

const RecordContentEnvelope = Schema.Struct({
  schema_version: Schema.Literal(1),
  collection_key: NonEmptyString,
  identity_version: PositiveInt,
  identity: CollectionIdentity,
  provenance: Schema.Array(Provenance).pipe(Schema.minItems(1)),
  proxy_implementations: Schema.Array(RecordedProxyImplementationSchema),
  record_digest: VersionedDigest,
});
const decodeRecordEnvelope = Schema.decodeUnknownEither(RecordContentEnvelope, STRICT);
const decodeProvenanceStrict = Schema.decodeUnknownEither(Provenance, STRICT);

const RecordPointerSchema = Schema.Struct({
  collection_key: NonEmptyString,
  identity_version: PositiveInt,
  record_digest: VersionedDigest,
});

const AppliedPlanItemSummarySchema = Schema.Struct({
  action: Schema.Literal(...BACKFILL_ACTIONS),
  reason_code: Schema.Literal(...BACKFILL_REASON_CODES),
  detail: Schema.String,
  collection_key: Schema.optionalWith(NonEmptyString, { exact: true }),
  affected_deployment_ids: Schema.Array(VersionedDigest),
  evidence_refs: Schema.Array(Schema.String),
  before_record_digest: Schema.optionalWith(VersionedDigest, { exact: true }),
  after_record_digest: Schema.optionalWith(VersionedDigest, { exact: true }),
});

const EventBaseFields = {
  schema_version: Schema.Literal(1),
  sequence: PositiveInt,
  occurred_at: NonEmptyString,
  command_id: NonEmptyString,
  command_digest: VersionedDigest,
  prev_event_digest: Schema.optionalWith(VersionedDigest, { exact: true }),
  event_digest: VersionedDigest,
};

const BackfillAppliedEventSchema = Schema.Struct({
  ...EventBaseFields,
  kind: Schema.Literal("backfill_applied"),
  plan_digest: VersionedDigest,
  base_state_digest: VersionedDigest,
  registry_digest: VersionedDigest,
  evidence_digest: VersionedDigest,
  counts: Schema.Struct({
    create: NonNegativeInt,
    noop: NonNegativeInt,
    update: NonNegativeInt,
    quarantine: NonNegativeInt,
    blocked: NonNegativeInt,
  }),
  created: Schema.Array(RecordContentEnvelope),
  superseded: Schema.Array(RecordPointerSchema),
  items: Schema.Array(AppliedPlanItemSummarySchema),
});

const BackfillRolledBackEventSchema = Schema.Struct({
  ...EventBaseFields,
  kind: Schema.Literal("backfill_rolled_back"),
  through_sequence: NonNegativeInt,
  reason: NonEmptyString,
});

const AuthorityEnabledEventSchema = Schema.Struct({
  ...EventBaseFields,
  kind: Schema.Literal("authority_enabled"),
  parity_report_digest: VersionedDigest,
  plan_digest: VersionedDigest,
  state_digest: VersionedDigest,
  registry_digest: VersionedDigest,
});

const IdentitySupersededEventSchema = Schema.Struct({
  ...EventBaseFields,
  kind: Schema.Literal("identity_superseded"),
  contract_version: Schema.Literal(IDENTITY_SUPERSESSION_CONTRACT_VERSION),
  cause: Schema.Literal("operator_revision", "equivalence_revocation"),
  authority_ref: NonEmptyString,
  reason: NonEmptyString,
  affected_deployment_ids: Schema.Array(VersionedDigest),
  superseded: Schema.Array(RecordPointerSchema),
  successors: Schema.Array(RecordContentEnvelope),
  revoked_equivalence_digests: Schema.Array(VersionedDigest),
  impact: QuarantineImpactSetSchema,
});

const BackfillLedgerEventSchema = Schema.Union(
  BackfillAppliedEventSchema,
  BackfillRolledBackEventSchema,
  AuthorityEnabledEventSchema,
  IdentitySupersededEventSchema
);
const decodeBackfillLedgerEvent = Schema.decodeUnknownEither(
  BackfillLedgerEventSchema,
  STRICT
);

function decodeStoredEvent(input: unknown, where: string): BackfillLedgerEvent {
  const decoded = decodeBackfillLedgerEvent(input);
  if (Either.isLeft(decoded)) {
    throw new BackfillIntegrityError(
      `${where}: event envelope does not strict-decode — ${String(decoded.left)}`
    );
  }
  return decoded.right;
}

/**
 * Re-verify one stored record content from untrusted bytes: strict envelope,
 * package-verified identity (collection_id and every deployment_id are
 * RECOMPUTED by `decodeCollectionIdentity`, not trusted), strict CR-001
 * provenance entries, and a recomputed record digest. Tampering with any of
 * it is detected here.
 */
function verifyRecordContent(input: unknown, where: string): BackfillRecordContent {
  const envelope = decodeRecordEnvelope(input);
  if (Either.isLeft(envelope)) {
    throw new BackfillIntegrityError(
      `${where}: record content envelope does not strict-decode — ${String(envelope.left)}`
    );
  }
  const identity = runProtocol(decodeCollectionIdentity(envelope.right.identity));
  if (Either.isLeft(identity)) {
    throw new BackfillIntegrityError(
      `${where}: stored identity fails CR-001 re-verification — ${String(identity.left)}`
    );
  }
  if (identity.right.collection_key !== envelope.right.collection_key) {
    throw new BackfillIntegrityError(
      `${where}: embedded identity collection_key ${JSON.stringify(identity.right.collection_key)} ` +
        `does not match record collection_key ${JSON.stringify(envelope.right.collection_key)}`
    );
  }
  const provenance = envelope.right.provenance.map((entry, index) => {
    const decoded = decodeProvenanceStrict(entry);
    if (Either.isLeft(decoded)) {
      throw new BackfillIntegrityError(
        `${where}: provenance[${index}] fails CR-001 re-verification — ${String(decoded.left)}`
      );
    }
    return decoded.right;
  });
  const proxy_implementations: readonly RecordedProxyImplementation[] =
    envelope.right.proxy_implementations;
  const content: Omit<BackfillRecordContent, "record_digest"> = {
    schema_version: 1,
    collection_key: envelope.right.collection_key,
    identity_version: envelope.right.identity_version,
    identity: identity.right,
    provenance,
    proxy_implementations,
  };
  const recomputed = mintRecordDigest(content);
  if (!sameVersionedDigest(recomputed, envelope.right.record_digest)) {
    throw new BackfillIntegrityError(
      `${where}: record digest mismatch — stored ${envelope.right.record_digest.digest}, ` +
        `recomputed ${recomputed.digest}; refusing tampered record content`
    );
  }
  return { ...content, record_digest: recomputed };
}

// ── The fold (single implementation for live mutation AND replay) ───────────

interface MaterializedState {
  readonly authority: AuthorityState;
  /** recordKey → record (immutable content + current status). */
  readonly records: ReadonlyMap<string, BackfillIdentityRecord>;
  /** ACTIVE record key per deployment digest. */
  readonly activeByDeployment: ReadonlyMap<string, string>;
  /** ACTIVE record key per collection_key. */
  readonly activeByKey: ReadonlyMap<string, string>;
  /** Highest identity_version ever assigned per collection_key. */
  readonly versionCeiling: ReadonlyMap<string, number>;
  /** Canonical digest keys of revoked equivalence assertion digests. */
  readonly revokedEquivalence: ReadonlySet<string>;
}

const EMPTY_STATE: MaterializedState = {
  authority: "pre_authority",
  records: new Map(),
  activeByDeployment: new Map(),
  activeByKey: new Map(),
  versionCeiling: new Map(),
  revokedEquivalence: new Set(),
};

function recordsOf(state: MaterializedState): readonly BackfillIdentityRecord[] {
  return [...state.records.values()].sort(
    (l, r) =>
      compareStrings(l.collection_key, r.collection_key) ||
      l.identity_version - r.identity_version
  );
}

function eventDigestMaterial(event: unknown): unknown {
  // The event content IS the material; canonical encoding handles ordering.
  return event;
}

function mintEventDigest(event: unknown): VersionedDigest {
  return mintInventoryDigest(
    EVENT_DIGEST_DOMAIN,
    LEDGER_DIGEST_VERSION,
    eventDigestMaterial(event)
  );
}

/**
 * Insert created/successor records into state, enforcing version monotonicity
 * and the single-active-identity-per-deployment invariant.
 */
function insertRecords(
  state: MaterializedState,
  contents: readonly BackfillRecordContent[],
  supersededKeys: ReadonlySet<string>,
  supersededStatus: BackfillRecordStatus,
  where: string
): MaterializedState {
  const records = new Map(state.records);
  const activeByDeployment = new Map(state.activeByDeployment);
  const activeByKey = new Map(state.activeByKey);
  const versionCeiling = new Map(state.versionCeiling);

  // Retire superseded records first (their deployments free up).
  for (const key of supersededKeys) {
    const existing = records.get(key);
    if (!existing) {
      throw new BackfillIntegrityError(`${where}: superseded record ${key} does not exist`);
    }
    if (existing.status !== "active") {
      throw new BackfillIntegrityError(
        `${where}: superseded record ${key} is ${existing.status}, not active`
      );
    }
    records.set(key, deepFreeze({ ...existing, status: supersededStatus }));
    activeByKey.delete(existing.collection_key);
    for (const deployment of existing.identity.deployments) {
      activeByDeployment.delete(deployment.deployment_id.digest);
    }
  }

  const seenKeys = new Set<string>();
  for (const content of contents) {
    if (seenKeys.has(content.collection_key)) {
      throw new BackfillIntegrityError(
        `${where}: two new records share collection_key "${content.collection_key}" in one event`
      );
    }
    seenKeys.add(content.collection_key);

    const expectedVersion = (versionCeiling.get(content.collection_key) ?? 0) + 1;
    if (content.identity_version !== expectedVersion) {
      throw new BackfillIntegrityError(
        `${where}: record ${content.collection_key} v${content.identity_version} breaks ` +
          `version monotonicity (expected v${expectedVersion})`
      );
    }
    if (activeByKey.has(content.collection_key)) {
      throw new BackfillIntegrityError(
        `${where}: collection_key "${content.collection_key}" already has an active record ` +
          `that this event does not supersede`
      );
    }
    for (const deployment of content.identity.deployments) {
      const holder = activeByDeployment.get(deployment.deployment_id.digest);
      if (holder !== undefined) {
        throw new BackfillIntegrityError(
          `${where}: deployment ${deployment.normalized_address} would be claimed by two ` +
            `active identities ("${holder}" and "${recordKeyOf(content)}"); a deployment ` +
            `resolves to exactly one active identity`
        );
      }
    }

    const key = recordKeyOf(content);
    records.set(key, deepFreeze({ ...content, status: "active" as const }));
    activeByKey.set(content.collection_key, key);
    versionCeiling.set(content.collection_key, content.identity_version);
    for (const deployment of content.identity.deployments) {
      activeByDeployment.set(deployment.deployment_id.digest, key);
    }
  }

  return {
    ...state,
    records,
    activeByDeployment,
    activeByKey,
    versionCeiling,
  };
}

/**
 * Apply one event to a materialized state. This IS the validator: live
 * mutators construct an event and step it; replay steps every stored event.
 * Any violation throws `BackfillIntegrityError` (structural) or
 * `BackfillAuthorityError` (state machine).
 */
function stepState(
  state: MaterializedState,
  event: BackfillLedgerEvent,
  snapshots: readonly MaterializedState[],
  where: string
): MaterializedState {
  switch (event.kind) {
    case "backfill_applied": {
      if (state.authority !== "pre_authority") {
        throw new BackfillAuthorityError(
          `${where}: backfill_applied after authority enablement — post-authority writes are ` +
            `append-only revisions and revocations only`
        );
      }
      const currentState = stateDigestOf(recordsOf(state));
      if (!sameVersionedDigest(currentState, event.base_state_digest)) {
        throw new BackfillIntegrityError(
          `${where}: applied event binds base state ${event.base_state_digest.digest} but the ` +
            `materialized state is ${currentState.digest}`
        );
      }
      const created = event.created.map((content, index) =>
        verifyRecordContent(content, `${where}: created[${index}]`)
      );
      const supersededKeys = new Set<string>();
      for (const pointer of event.superseded) {
        const key = recordKeyOf(pointer);
        const existing = state.records.get(key);
        if (!existing || !sameVersionedDigest(existing.record_digest, pointer.record_digest)) {
          throw new BackfillIntegrityError(
            `${where}: superseded pointer ${key} does not match a stored record`
          );
        }
        if (!created.some((content) => content.collection_key === pointer.collection_key)) {
          throw new BackfillIntegrityError(
            `${where}: superseded ${key} has no same-key created successor (an apply may ` +
              `supersede only by writing a new version of the same collection_key)`
          );
        }
        supersededKeys.add(key);
      }
      return insertRecords(state, created, supersededKeys, "superseded", where);
    }

    case "backfill_rolled_back": {
      if (state.authority !== "pre_authority") {
        throw new BackfillAuthorityError(
          `${where}: rollback after authority enablement is forbidden — correct forward with ` +
            `revisions/revocations instead`
        );
      }
      if (
        !Number.isInteger(event.through_sequence) ||
        event.through_sequence < 0 ||
        event.through_sequence >= event.sequence
      ) {
        throw new BackfillIntegrityError(
          `${where}: rollback through_sequence ${event.through_sequence} is not a prior sequence`
        );
      }
      const snapshot = snapshots[event.through_sequence];
      if (!snapshot) {
        throw new BackfillIntegrityError(
          `${where}: no state snapshot at sequence ${event.through_sequence}`
        );
      }
      return snapshot;
    }

    case "authority_enabled": {
      if (state.authority !== "pre_authority") {
        throw new BackfillAuthorityError(`${where}: authority is already enabled`);
      }
      const currentState = stateDigestOf(recordsOf(state));
      if (!sameVersionedDigest(currentState, event.state_digest)) {
        throw new BackfillIntegrityError(
          `${where}: authority_enabled binds state ${event.state_digest.digest} but the ` +
            `materialized state is ${currentState.digest}`
        );
      }
      return { ...state, authority: "authority_enabled" };
    }

    case "identity_superseded": {
      if (state.authority !== "authority_enabled") {
        throw new BackfillAuthorityError(
          `${where}: identity_superseded before authority enablement — pre-authority correction ` +
            `is plan/apply/rollback`
        );
      }
      decodeQuarantineImpactSet(event.impact);
      if (event.superseded.length === 0 || event.successors.length === 0) {
        throw new BackfillIntegrityError(
          `${where}: a supersession must retire at least one record and mint at least one successor`
        );
      }

      const supersededKeys = new Set<string>();
      const affected = new Map<string, VersionedDigest>();
      for (const pointer of event.superseded) {
        const key = recordKeyOf(pointer);
        const existing = state.records.get(key);
        if (!existing || !sameVersionedDigest(existing.record_digest, pointer.record_digest)) {
          throw new BackfillIntegrityError(
            `${where}: superseded pointer ${key} does not match a stored record`
          );
        }
        supersededKeys.add(key);
        for (const deployment of existing.identity.deployments) {
          affected.set(deployment.deployment_id.digest, deployment.deployment_id);
        }
      }

      const successors = event.successors.map((content, index) =>
        verifyRecordContent(content, `${where}: successors[${index}]`)
      );

      // Coverage: successors partition exactly the affected deployment set.
      const successorClaims = new Map<string, string>();
      for (const successor of successors) {
        for (const deployment of successor.identity.deployments) {
          const digest = deployment.deployment_id.digest;
          if (!affected.has(digest)) {
            throw new BackfillRevocationError(
              `${where}: successor "${successor.collection_key}" claims deployment ` +
                `${deployment.normalized_address} which no superseded identity held`
            );
          }
          const prior = successorClaims.get(digest);
          if (prior !== undefined) {
            throw new BackfillRevocationError(
              `${where}: successors "${prior}" and "${successor.collection_key}" both claim ` +
                `deployment ${deployment.normalized_address}`
            );
          }
          successorClaims.set(digest, successor.collection_key);
        }
      }
      if (successorClaims.size !== affected.size) {
        throw new BackfillRevocationError(
          `${where}: successors cover ${successorClaims.size} of ${affected.size} affected ` +
            `deployments — every affected deployment must land in exactly one successor`
        );
      }

      // The event must enumerate the affected set exactly (sorted).
      const enumerated = event.affected_deployment_ids.map(versionedDigestKeyOf).join(",");
      const expected = sortVersionedDigests([...affected.values()])
        .map(versionedDigestKeyOf)
        .join(",");
      if (enumerated !== expected) {
        throw new BackfillIntegrityError(
          `${where}: affected_deployment_ids does not enumerate the union of superseded ` +
            `identities' deployments (sorted)`
        );
      }

      // Revocation bookkeeping + reuse refusal.
      const revoked = new Set(state.revokedEquivalence);
      if (event.cause === "equivalence_revocation") {
        if (event.revoked_equivalence_digests.length === 0) {
          throw new BackfillRevocationError(
            `${where}: an equivalence revocation must name the invalidated assertion digest(s)`
          );
        }
        for (const digest of event.revoked_equivalence_digests) {
          revoked.add(versionedDigestKeyOf(digest));
        }
      } else if (event.revoked_equivalence_digests.length !== 0) {
        throw new BackfillIntegrityError(
          `${where}: an operator revision must not carry revoked equivalence digests`
        );
      }
      for (const successor of successors) {
        const basis = successor.identity.equivalence_basis;
        if (basis.kind !== "single_deployment") {
          const key = versionedDigestKeyOf(basis.assertion_digest);
          if (revoked.has(key)) {
            throw new BackfillRevocationError(
              `${where}: successor "${successor.collection_key}" reuses revoked equivalence ` +
                `assertion digest ${basis.assertion_digest.digest}; a corrected grouping needs a ` +
                `fresh authority record (new assertion digest, new identity version)`
            );
          }
        }
      }

      const next = insertRecords(
        state,
        successors,
        supersededKeys,
        event.cause === "equivalence_revocation" ? "revoked" : "superseded",
        where
      );
      return { ...next, revokedEquivalence: revoked };
    }
  }
}

function materialize(events: readonly BackfillLedgerEvent[]): BackfillLedger {
  let state = EMPTY_STATE;
  const snapshots: MaterializedState[] = [EMPTY_STATE];
  let previousDigest: VersionedDigest | undefined;
  const acceptedCommands = new Map<
    string,
    { readonly command_digest: VersionedDigest; readonly sequence: number }
  >();

  events.forEach((event, index) => {
    const where = `event ${index + 1} (${event.kind})`;
    if (event.schema_version !== 1) {
      throw new BackfillIntegrityError(`${where}: unknown schema_version`);
    }
    if (event.sequence !== index + 1) {
      throw new BackfillIntegrityError(
        `${where}: sequence ${event.sequence} breaks contiguity (expected ${index + 1})`
      );
    }
    if (typeof event.command_id !== "string" || event.command_id.length === 0) {
      throw new BackfillIntegrityError(`${where}: command_id must be a non-empty string`);
    }
    assertIsoUtcTimestamp(event.occurred_at, `${where}.occurred_at`);
    if (index === 0) {
      if (event.prev_event_digest !== undefined) {
        throw new BackfillIntegrityError(`${where}: first event must not carry prev_event_digest`);
      }
    } else {
      if (
        event.prev_event_digest === undefined ||
        !sameVersionedDigest(event.prev_event_digest, previousDigest!)
      ) {
        throw new BackfillIntegrityError(
          `${where}: prev_event_digest does not chain to event ${index}`
        );
      }
    }
    const { event_digest, ...content } = event;
    const recomputed = mintEventDigest(content);
    if (!sameVersionedDigest(recomputed, event_digest)) {
      throw new BackfillIntegrityError(
        `${where}: event digest mismatch — stored ${event_digest.digest}, recomputed ` +
          `${recomputed.digest}; refusing tampered event`
      );
    }

    // Exact-command uniqueness on the chain: a command_id may appear once.
    // (Idempotent live retries never append a second event — they short-circuit
    // before appendEvent. A stored history with duplicates is tampering.)
    const prior = acceptedCommands.get(event.command_id);
    if (prior !== undefined) {
      throw new BackfillCommandConflictError(
        `${where}: command_id "${event.command_id}" already accepted at sequence ` +
          `${prior.sequence} — duplicate command_id on the chain is refused`
      );
    }
    acceptedCommands.set(event.command_id, {
      command_digest: event.command_digest,
      sequence: event.sequence,
    });

    state = stepState(state, event, snapshots, where);
    snapshots.push(state);
    previousDigest = event_digest;
  });

  const records = recordsOf(state);
  return deepFreeze({
    schema_version: 1 as const,
    contract_version: IDENTITY_BACKFILL_CONTRACT_VERSION,
    events,
    authority: state.authority,
    records,
    state_digest: stateDigestOf(records),
    revoked_equivalence: [...state.revokedEquivalence].sort(compareStrings),
    accepted_commands: [...acceptedCommands.entries()]
      .sort(([l], [r]) => compareStrings(l, r))
      .map(([command_id, entry]) => ({
        command_id,
        command_digest: entry.command_digest,
        sequence: entry.sequence,
      })),
  });
}

/**
 * Resolve exact-command idempotency first, then CAS on expected_state_digest.
 * `command_digest` is the caller's stable request digest (not the full event).
 */
function beginMutation(
  ledger: BackfillLedger,
  options: {
    readonly command_id: string;
    readonly command_digest: VersionedDigest;
    readonly expected_state_digest: VersionedDigest;
    readonly buildContent: () => Omit<BackfillLedgerEvent, "event_digest">;
  }
):
  | { readonly kind: "idempotent"; readonly ledger: BackfillLedger }
  | { readonly kind: "append"; readonly content: Omit<BackfillLedgerEvent, "event_digest"> } {
  if (options.command_id.length === 0) {
    throw new ValidationError("command_id", options.command_id, "a non-empty exact-command id");
  }
  if (resolveAcceptedCommand(ledger, options.command_id, options.command_digest)) {
    return { kind: "idempotent", ledger };
  }
  if (!sameVersionedDigest(options.expected_state_digest, ledger.state_digest)) {
    throw new BackfillStalePlanError(
      `CAS refused: expected state ${options.expected_state_digest.digest} but ledger is at ` +
        `${ledger.state_digest.digest}`
    );
  }
  return { kind: "append", content: options.buildContent() };
}

/**
 * Resolve an already-accepted exact command without touching live fold state.
 * This must run before reconstructing event payloads: rollback can remove an
 * accepted apply's records from the current materialized view while its
 * immutable command receipt remains in the event history.
 */
function resolveAcceptedCommand(
  ledger: BackfillLedger,
  commandId: string,
  commandDigest: VersionedDigest
): boolean {
  const prior = ledger.accepted_commands.find((entry) => entry.command_id === commandId);
  if (prior === undefined) return false;
  if (!sameVersionedDigest(prior.command_digest, commandDigest)) {
    throw new BackfillCommandConflictError(
      `command_id "${commandId}" was already accepted with a different payload ` +
        `(prior digest ${prior.command_digest.digest}, retry digest ${commandDigest.digest})`
    );
  }
  return true;
}

function mintCommandDigest(material: unknown): VersionedDigest {
  return mintInventoryDigest("inventory.backfill-command", LEDGER_DIGEST_VERSION, material);
}

function appendEvent(
  ledger: BackfillLedger,
  content: Omit<BackfillLedgerEvent, "event_digest">
): BackfillLedger {
  const event = decodeStoredEvent(
    {
      ...content,
      event_digest: mintEventDigest(content),
    },
    "new event"
  );
  return materialize([...ledger.events, event]);
}

// ── Public surface ───────────────────────────────────────────────────────────

/** A fresh, empty, pre-authority ledger. */
export function createBackfillLedger(): BackfillLedger {
  return materialize([]);
}

/**
 * Rebuild a ledger from stored events (untrusted bytes). Every event's
 * digest, the chain linkage, every record's package-verified identity, and
 * every structural invariant are re-proven by the same fold the mutators use.
 */
export function replayBackfillLedger(events: unknown): BackfillLedger {
  if (!Array.isArray(events)) {
    throw new ValidationError("events", events, "an array of backfill ledger events");
  }
  return materialize(
    events.map((event, index) => decodeStoredEvent(event, `stored event ${index + 1}`))
  );
}

/**
 * Canonical (RFC 8785) JSON of the ledger's events — byte-stable for a given
 * event history, so the persisted artifact diffs and digests deterministically.
 */
export function serializeBackfillLedger(ledger: BackfillLedger): string {
  const canonical = runProtocol(
    canonicalize({
      schema_version: 1,
      contract_version: IDENTITY_BACKFILL_CONTRACT_VERSION,
      events: ledger.events,
    })
  );
  if (Either.isLeft(canonical)) {
    throw new BackfillIntegrityError(
      `ledger events are not canonically encodable — ${String(canonical.left)}`
    );
  }
  return canonical.right;
}

/** Parse + fully re-verify a serialized ledger artifact. */
export function deserializeBackfillLedger(text: string): BackfillLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ValidationError("ledger", text.slice(0, 80), `valid JSON — ${String(error)}`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schema_version?: unknown }).schema_version !== 1 ||
    (parsed as { contract_version?: unknown }).contract_version !==
      IDENTITY_BACKFILL_CONTRACT_VERSION
  ) {
    throw new ValidationError(
      "ledger",
      parsed,
      `a { schema_version: 1, contract_version: "${IDENTITY_BACKFILL_CONTRACT_VERSION}", events } artifact`
    );
  }
  return replayBackfillLedger((parsed as { events: unknown }).events);
}

/**
 * Apply a dry-run plan (pre-authority only). The plan must have been computed
 * against the ledger's CURRENT materialized state and its digest must
 * recompute exactly (tamper refusal). Quarantine/blocked items apply nothing
 * but are recorded verbatim in the event for the audit trail. Replaying the
 * same plan is refused as stale (the state moved); re-PLANNING the same
 * inputs yields an all-noop plan whose apply appends a zero-effect event —
 * idempotency you can prove, not assume. Exact-command retries with the same
 * `command_id` + payload are no-ops; a different payload under the same id
 * is a conflict.
 */
export function applyBackfillPlan(
  ledger: BackfillLedger,
  plan: BackfillPlan,
  options: {
    readonly applied_at: string;
    readonly command_id: string;
    /** CAS token — must equal `ledger.state_digest` on first acceptance. */
    readonly expected_state_digest: VersionedDigest;
  }
): BackfillLedger {
  if (plan.contract_version !== IDENTITY_BACKFILL_CONTRACT_VERSION) {
    throw new ValidationError("plan.contract_version", plan.contract_version, IDENTITY_BACKFILL_CONTRACT_VERSION);
  }
  const { plan_digest, ...header } = plan;
  const recomputed = mintPlanDigest(header);
  if (!sameVersionedDigest(recomputed, plan_digest)) {
    throw new BackfillIntegrityError(
      `plan digest mismatch — stored ${plan_digest.digest}, recomputed ${recomputed.digest}; ` +
        `refusing tampered plan`
    );
  }
  for (const [index, item] of plan.items.entries()) {
    if (item.proposed !== undefined) {
      verifyRecordContent(item.proposed, `plan item ${index + 1} proposal`);
    }
  }

  const occurred_at = assertIsoUtcTimestamp(options.applied_at, "applied_at");
  const command_digest = mintCommandDigest({
    kind: "backfill_applied",
    command_id: options.command_id,
    occurred_at,
    plan_digest: plan.plan_digest,
    base_state_digest: plan.base_state_digest,
    registry_digest: plan.registry_digest,
    evidence_digest: plan.evidence_digest,
    counts: plan.counts,
    items: plan.items.map(stripProposal),
  });

  // The immutable command receipt is authoritative for exact retries. Resolve
  // it before reading current materialized records: a later rollback may have
  // legitimately removed the original apply's targets from the live view.
  if (resolveAcceptedCommand(ledger, options.command_id, command_digest)) {
    return ledger;
  }

  // For first acceptance, reconstruct created/superseded from the plan and
  // stored record digests. Exact retries have already returned above.
  const created: BackfillRecordContent[] = [];
  const superseded: RecordPointer[] = [];
  for (const item of plan.items) {
    if ((item.action === "create" || item.action === "update") && item.proposed) {
      created.push(item.proposed);
      if (item.action === "update") {
        const before = ledger.records.find(
          (record) =>
            record.collection_key === item.collection_key &&
            item.before_record_digest !== undefined &&
            sameVersionedDigest(record.record_digest, item.before_record_digest)
        );
        if (!before) {
          throw new BackfillStalePlanError(
            `update item for "${item.collection_key}" no longer matches a stored record`
          );
        }
        superseded.push({
          collection_key: before.collection_key,
          identity_version: before.identity_version,
          record_digest: before.record_digest,
        });
      }
    }
  }

  // The shared mutation gate now enforces CAS and rechecks command uniqueness
  // before constructing the appendable event.
  const gate = beginMutation(ledger, {
    command_id: options.command_id,
    command_digest,
    expected_state_digest: options.expected_state_digest,
    buildContent: () => ({
      schema_version: 1 as const,
      kind: "backfill_applied" as const,
      sequence: ledger.events.length + 1,
      occurred_at,
      command_id: options.command_id,
      command_digest,
      ...(ledger.events.length > 0
        ? { prev_event_digest: ledger.events[ledger.events.length - 1]!.event_digest }
        : {}),
      plan_digest: plan.plan_digest,
      base_state_digest: plan.base_state_digest,
      registry_digest: plan.registry_digest,
      evidence_digest: plan.evidence_digest,
      counts: plan.counts,
      created,
      superseded,
      items: plan.items.map(stripProposal),
    }),
  });
  if (gate.kind === "idempotent") return gate.ledger;

  if (ledger.authority !== "pre_authority") {
    throw new BackfillAuthorityError(
      "applyBackfillPlan is a pre-authority verb; after cutover use applyOperatorRevision/revokeEquivalence"
    );
  }

  // First acceptance: plan must bind the live state, and update targets must
  // still be the ACTIVE versions (fold enforces this too).
  if (!sameVersionedDigest(plan.base_state_digest, ledger.state_digest)) {
    throw new BackfillStalePlanError(
      `plan was computed against state ${plan.base_state_digest.digest} but the ledger is at ` +
        `${ledger.state_digest.digest}; re-run planIdentityBackfill against the current ledger`
    );
  }
  for (const pointer of superseded) {
    const active = ledger.records.find(
      (record) =>
        record.collection_key === pointer.collection_key &&
        record.identity_version === pointer.identity_version
    );
    if (!active || active.status !== "active") {
      throw new BackfillStalePlanError(
        `update target ${pointer.collection_key}#${pointer.identity_version} is not active`
      );
    }
  }
  return appendEvent(ledger, gate.content);
}

function stripProposal(item: BackfillPlanItem): AppliedPlanItemSummary {
  return {
    action: item.action,
    reason_code: item.reason_code,
    detail: item.detail,
    ...(item.collection_key !== undefined ? { collection_key: item.collection_key } : {}),
    affected_deployment_ids: item.affected_deployment_ids,
    evidence_refs: item.evidence_refs,
    ...(item.before_record_digest !== undefined
      ? { before_record_digest: item.before_record_digest }
      : {}),
    ...(item.after_record_digest !== undefined
      ? { after_record_digest: item.after_record_digest }
      : {}),
  };
}

/**
 * Rewind the materialized state to just after `through_sequence` (0 = empty).
 * Pre-authority only — the escape hatch that exists precisely BECAUSE no
 * external consumer trusts the keys yet. The rollback is itself an
 * append-only event: history is never deleted, the view just returns to the
 * snapshot, and a fresh plan against the rewound state reproduces the
 * original plan byte-for-byte (determinism you can test).
 */
export function rollbackBackfill(
  ledger: BackfillLedger,
  options: {
    readonly through_sequence: number;
    readonly reason: string;
    readonly rolled_back_at: string;
    readonly command_id: string;
    readonly expected_state_digest: VersionedDigest;
  }
): BackfillLedger {
  if (options.reason.length === 0) {
    throw new ValidationError("reason", options.reason, "a non-empty rollback reason");
  }
  const occurred_at = assertIsoUtcTimestamp(options.rolled_back_at, "rolled_back_at");
  const command_digest = mintCommandDigest({
    kind: "backfill_rolled_back",
    command_id: options.command_id,
    occurred_at,
    through_sequence: options.through_sequence,
    reason: options.reason,
  });
  // Exact-command idempotency BEFORE authority-state gating.
  const gate = beginMutation(ledger, {
    command_id: options.command_id,
    command_digest,
    expected_state_digest: options.expected_state_digest,
    buildContent: () => ({
      schema_version: 1 as const,
      kind: "backfill_rolled_back" as const,
      sequence: ledger.events.length + 1,
      occurred_at,
      command_id: options.command_id,
      command_digest,
      ...(ledger.events.length > 0
        ? { prev_event_digest: ledger.events[ledger.events.length - 1]!.event_digest }
        : {}),
      through_sequence: options.through_sequence,
      reason: options.reason,
    }),
  });
  if (gate.kind === "idempotent") return gate.ledger;

  if (ledger.authority !== "pre_authority") {
    throw new BackfillAuthorityError(
      "rollback after authority enablement is forbidden; correct forward with a new immutable " +
        "identity version (applyOperatorRevision / revokeEquivalence)"
    );
  }
  return appendEvent(ledger, gate.content);
}

/**
 * The parity-shaped proof `enableAuthority` binds. Produced only by
 * re-invoking `proveLegacyNewParity` over the live ledger + registry —
 * never a thin caller-forged `{ pass: true }` stub, and never by treating a
 * caller-minted report as the authority source.
 */
export type AuthorityParityEvidence = ReadParityReport;

function parityReportsExactlyEqual(left: ReadParityReport, right: ReadParityReport): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Flip the authority state machine — the cutover. Refused unless:
 * (a) the canonical legacy/new parity proof recomputed over the supplied
 *     registry snapshot and this ledger PASSES (any miss, ambiguous edge, or
 *     changed metadata/equivalence already failed the proof), and
 * (b) a CLEAN plan (zero quarantine) computed against the same state and the
 *     same registry snapshot is presented — open conflicts keep production
 *     Ordering disabled, exactly as CR-108 requires.
 * An optional `expected_parity` may be supplied for auditability: it is
 * strict-decoded and must equal the recomputed report exactly, but it is
 * never the source of authority. After this event, apply and rollback are
 * refused forever (except identical exact-command replays of previously
 * accepted pre-authority commands).
 *
 * Exact-command replay/conflict precedes live parity verification: an
 * already-accepted enablement command returns the CURRENT ledger (preserving
 * any later revisions) without recomputing parity; a same-id payload change
 * throws `BackfillCommandConflictError` before any parity work. Only a
 * genuinely new enablement command recomputes parity from actual reads.
 */
export function enableAuthority(
  ledger: BackfillLedger,
  options: {
    readonly registry: readonly CollectionRegistryEntry[];
    readonly clean_plan: BackfillPlan;
    readonly enabled_at: string;
    readonly command_id: string;
    readonly expected_state_digest: VersionedDigest;
    /**
     * Optional audit copy of a previously observed parity report. Strict-
     * decoded and required to equal the internally recomputed proof; never
     * consulted as the authority source.
     */
    readonly expected_parity?: unknown;
  }
): BackfillLedger {
  // Strict-decode/canonicalize the submitted command BEFORE any live parity
  // work, so accepted-command replay/conflict cannot be preempted by a later
  // state's parity failure.
  if (options.command_id.length === 0) {
    throw new ValidationError("command_id", options.command_id, "a non-empty exact-command id");
  }
  const occurred_at = assertIsoUtcTimestamp(options.enabled_at, "enabled_at");
  const { clean_plan } = options;
  const { plan_digest, ...header } = clean_plan;
  if (!sameVersionedDigest(mintPlanDigest(header), plan_digest)) {
    throw new BackfillIntegrityError("clean plan digest mismatch; refusing tampered plan");
  }

  // Command identity is the submitted request payload — not the live-recomputed
  // parity report (that is an enablement OUTPUT bound on the event). Including
  // live parity in the digest would make identical retries conflict after later
  // identity revisions.
  const command_digest = mintCommandDigest({
    kind: "authority_enabled",
    command_id: options.command_id,
    occurred_at,
    plan_digest: clean_plan.plan_digest,
    state_digest: options.expected_state_digest,
    registry_digest: clean_plan.registry_digest,
  });
  const prior = ledger.accepted_commands.find(
    (entry) => entry.command_id === options.command_id
  );
  if (prior !== undefined) {
    if (!sameVersionedDigest(prior.command_digest, command_digest)) {
      throw new BackfillCommandConflictError(
        `command_id "${options.command_id}" was already accepted with a different payload ` +
          `(prior digest ${prior.command_digest.digest}, retry digest ${command_digest.digest})`
      );
    }
    // Idempotent replay: return the current ledger — never resurrect the
    // pre-revision state snapshot the original enablement observed.
    return ledger;
  }

  // Genuinely new enablement command — recompute parity from actual reads.
  const parity = proveLegacyNewParity({
    ledger,
    registry: options.registry,
  });
  if (options.expected_parity !== undefined) {
    let expected: ReadParityReport;
    try {
      expected = verifyAuthorityParityReport(options.expected_parity);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new BackfillParityError(
          `expected parity evidence failed strict verification — ${error.message}`
        );
      }
      throw error;
    }
    if (!parityReportsExactlyEqual(expected, parity)) {
      throw new BackfillParityError(
        "expected parity report does not exactly equal the proof recomputed from the live " +
          "ledger and registry snapshot; caller-minted reports cannot authorize enablement"
      );
    }
  }
  if (!parity.pass) {
    throw new BackfillParityError(
      "read-parity proof does not pass; production Ordering stays disabled"
    );
  }
  if (parity.checked_deployments === 0) {
    throw new BackfillParityError(
      "read-parity proof checked zero deployments; an empty proof proves nothing"
    );
  }
  if (clean_plan.counts.quarantine !== 0) {
    throw new BackfillParityError(
      `plan holds ${clean_plan.counts.quarantine} quarantined item(s); conflicts, ambiguous ` +
        `grouping, missing network identity, and code/proxy changes must be resolved before ` +
        `new-key authority`
    );
  }

  const registryDigest = registrySnapshotDigestOf(options.registry);
  if (!sameVersionedDigest(registryDigest, clean_plan.registry_digest)) {
    throw new BackfillParityError(
      "enablement registry snapshot does not match the clean plan's registry digest"
    );
  }
  if (!sameVersionedDigest(parity.registry_digest, registryDigest)) {
    throw new BackfillParityError(
      "recomputed parity proof is bound to a different registry snapshot than enablement"
    );
  }

  if (!sameVersionedDigest(options.expected_state_digest, ledger.state_digest)) {
    throw new BackfillStalePlanError(
      `CAS refused: expected state ${options.expected_state_digest.digest} but ledger is at ` +
        `${ledger.state_digest.digest}`
    );
  }
  if (ledger.authority !== "pre_authority") {
    throw new BackfillAuthorityError("authority is already enabled");
  }
  if (!sameVersionedDigest(parity.state_digest, ledger.state_digest)) {
    throw new BackfillParityError(
      `read-parity proof is bound to state ${parity.state_digest.digest} but the ledger is at ` +
        `${ledger.state_digest.digest}; re-prove parity against the current state`
    );
  }
  if (!sameVersionedDigest(parity.registry_digest, clean_plan.registry_digest)) {
    throw new BackfillParityError(
      "parity proof and clean plan were computed against different registry snapshots"
    );
  }
  if (!sameVersionedDigest(clean_plan.base_state_digest, ledger.state_digest)) {
    throw new BackfillParityError(
      "clean plan is not bound to the ledger's current state; re-plan and re-prove"
    );
  }
  if (!sameVersionedDigest(clean_plan.registry_digest, parity.registry_digest)) {
    throw new BackfillParityError(
      "clean plan and parity proof were computed against different registry snapshots"
    );
  }

  const content: Omit<AuthorityEnabledEvent, "event_digest"> = {
    schema_version: 1 as const,
    kind: "authority_enabled" as const,
    sequence: ledger.events.length + 1,
    occurred_at,
    command_id: options.command_id,
    command_digest,
    ...(ledger.events.length > 0
      ? { prev_event_digest: ledger.events[ledger.events.length - 1]!.event_digest }
      : {}),
    parity_report_digest: parity.report_digest,
    plan_digest: clean_plan.plan_digest,
    state_digest: options.expected_state_digest,
    registry_digest: clean_plan.registry_digest,
  };
  return appendEvent(ledger, content);
}

/** True once new-key authority is enabled — the gate production Ordering consumes. */
export function isProductionOrderingEnabled(ledger: BackfillLedger): boolean {
  return ledger.authority === "authority_enabled";
}

// ── Post-authority: append-only revision (operator merge) ───────────────────

const decodeProvenanceForMint = decodeProvenanceStrict;

function mintProvenanceEntry(
  source: "operator_ratified" | "inventory_registry",
  sourceReference: string,
  observedAt: string,
  material: unknown
): Provenance {
  const candidate = {
    schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
    source,
    source_reference: sourceReference,
    observed_at: observedAt,
    evidence_digest: mintInventoryDigest("collection.provenance", 1, { source, material }),
  };
  const decoded = decodeProvenanceForMint(candidate);
  if (Either.isLeft(decoded)) {
    throw new ValidationError("provenance", candidate, String(decoded.left));
  }
  return decoded.right;
}

/**
 * Post-authority operator revision: apply a whole-row merge the planner
 * deliberately `blocked` pre-authority. The assertion must cover, exactly and
 * wholly, the deployment sets of ≥ 2 ACTIVE records; the canonical key must
 * be one of the member keys and still exist in the registry snapshot (the
 * successor serves that row's metadata); each member record must still agree
 * with its current registry row (post-cutover curated drift is refused, not
 * reconciled silently). Emits the CR-012A supersession event with the
 * caller-enumerated impact references.
 *
 * Incomplete impact discovery (`discovery_complete: false`) returns a typed
 * blocked result and leaves authoritative identity unchanged — but only after
 * exact-command replay/conflict is checked against the accepted command ledger.
 */
export function applyOperatorRevision(
  ledger: BackfillLedger,
  options: {
    readonly assertion: unknown;
    readonly registry: readonly CollectionRegistryEntry[];
    readonly impact: QuarantineImpactSet;
    readonly reason: string;
    readonly occurred_at: string;
    readonly command_id: string;
    readonly expected_state_digest: VersionedDigest;
  }
): PostAuthorityMutationResult {
  const assertion = decodeOperatorEquivalenceAssertion(options.assertion);
  const impact = decodeQuarantineImpactSet(options.impact);
  const occurredAt = assertIsoUtcTimestamp(options.occurred_at, "occurred_at");
  const command_digest = mintCommandDigest({
    kind: "identity_superseded",
    cause: "operator_revision",
    command_id: options.command_id,
    occurred_at: occurredAt,
    authority_ref: assertion.authority_ref,
    assertion_digest: assertion.assertion_digest,
    reason: options.reason,
    impact,
  });
  // Exact-command replay/conflict precedes incomplete-discovery blocking.
  const prior = ledger.accepted_commands.find(
    (entry) => entry.command_id === options.command_id
  );
  if (prior !== undefined) {
    if (!sameVersionedDigest(prior.command_digest, command_digest)) {
      throw new BackfillCommandConflictError(
        `command_id "${options.command_id}" was already accepted with a different payload ` +
          `(prior digest ${prior.command_digest.digest}, retry digest ${command_digest.digest})`
      );
    }
    return { status: "accepted", ledger };
  }
  if (!impact.discovery_complete) {
    return {
      status: "blocked",
      reason_code: "discovery_incomplete",
      ledger,
      impact,
      detail:
        `impact enumeration "${impact.enumeration_ref}" is incomplete; post-authority ` +
        `identity mutation requires discovery_complete:true with the explicit complete set ` +
        `of reachable work-row/artifact refs`,
    };
  }
  if (!sameVersionedDigest(options.expected_state_digest, ledger.state_digest)) {
    throw new BackfillStalePlanError(
      `CAS refused: expected state ${options.expected_state_digest.digest} but ledger is at ` +
        `${ledger.state_digest.digest}`
    );
  }

  if (ledger.authority !== "authority_enabled") {
    throw new BackfillAuthorityError(
      "applyOperatorRevision is a post-authority verb; pre-authority merges stay blocked until cutover"
    );
  }

  if (ledger.revoked_equivalence.includes(versionedDigestKeyOf(assertion.assertion_digest))) {
    throw new BackfillRevocationError(
      `assertion ${assertion.authority_ref} carries a revoked equivalence digest; a corrected ` +
        `grouping needs a fresh authority record`
    );
  }

  // Resolve the ACTIVE records the assertion's deployments belong to.
  const active = ledger.records.filter((record) => record.status === "active");
  const byDeployment = new Map<string, BackfillIdentityRecord>();
  for (const record of active) {
    for (const deployment of record.identity.deployments) {
      byDeployment.set(deployment.deployment_id.digest, record);
    }
  }
  const members = new Map<string, BackfillIdentityRecord>();
  for (const deployment of assertion.deployments) {
    const record = byDeployment.get(deployment.deployment_id.digest);
    if (!record) {
      throw new BackfillRevocationError(
        `assertion ${assertion.authority_ref} references deployment ` +
          `${deployment.normalized_address} which no active identity holds`
      );
    }
    members.set(recordKeyOf(record), record);
  }
  if (members.size < 2) {
    throw new BackfillRevocationError(
      "an operator revision merges at least two active identities; a single-identity " +
        "ratification has no post-authority effect"
    );
  }
  const memberRecords = [...members.values()];
  const assertionDigests = new Set(
    assertion.deployments.map((deployment) => deployment.deployment_id.digest)
  );
  for (const record of memberRecords) {
    for (const deployment of record.identity.deployments) {
      if (!assertionDigests.has(deployment.deployment_id.digest)) {
        throw new BackfillRevocationError(
          `assertion ${assertion.authority_ref} covers only part of active identity ` +
            `"${record.collection_key}" v${record.identity_version}; partial-identity grouping ` +
            `is ambiguous and never applies`
        );
      }
    }
  }
  const memberKeys = memberRecords.map((record) => record.collection_key).sort(compareStrings);
  if (!memberKeys.includes(assertion.canonical_collection_key)) {
    throw new BackfillRevocationError(
      `canonical_collection_key "${assertion.canonical_collection_key}" is not among the merged ` +
        `identities (${memberKeys.join(", ")})`
    );
  }
  const registryByKey = new Map(options.registry.map((entry) => [entry.collectionKey, entry]));
  for (const record of memberRecords) {
    const entry = registryByKey.get(record.collection_key);
    if (!entry) {
      throw new BackfillRevocationError(
        `merged identity "${record.collection_key}" no longer exists in the registry snapshot; ` +
          `this substrate refuses to merge against drifted curation`
      );
    }
    const rowIdentity = mintRegistryRowIdentity(entry);
    if (!sameVersionedDigest(rowIdentity.identity.collection_id, record.identity.collection_id)) {
      throw new BackfillRevocationError(
        `active identity "${record.collection_key}" v${record.identity_version} disagrees with ` +
          `the current registry row; reconcile curation before revising equivalence`
      );
    }
  }

  const mergedDeployments = memberRecords
    .flatMap((record) => record.identity.deployments)
    .sort((l, r) =>
      compareStrings(versionedDigestKeyOf(l.deployment_id), versionedDigestKeyOf(r.deployment_id))
    );
  const identity = runProtocol(
    makeCollectionIdentity({
      schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
      collection_key: assertion.canonical_collection_key,
      deployments: mergedDeployments,
      equivalence_basis: {
        schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
        kind: "operator_ratified",
        assertion_digest: assertion.assertion_digest,
        authority_ref: assertion.authority_ref,
      },
    })
  );
  if (Either.isLeft(identity)) {
    throw new ValidationError(
      "assertion",
      assertion.authority_ref,
      `a CR-001-assemblable merged identity — ${String(identity.left)}`
    );
  }

  const provenance: Provenance[] = [
    mintProvenanceEntry("operator_ratified", assertion.authority_ref, assertion.approved_at, {
      assertion_digest: assertion.assertion_digest,
    }),
    ...memberKeys.map((key) =>
      mintProvenanceEntry("inventory_registry", `inventory-registry:${key}`, occurredAt, {
        collection_key: key,
        deployment_ids: sortVersionedDigests(
          [...members.values()]
            .filter((record) => record.collection_key === key)
            .flatMap((record) =>
              record.identity.deployments.map((deployment) => deployment.deployment_id)
            )
        ),
      })
    ),
  ];

  const proxy_implementations = mergeProxyImplementations(
    memberRecords.map((record) => record.proxy_implementations)
  );

  const ceiling = Math.max(
    0,
    ...ledger.records
      .filter((record) => record.collection_key === assertion.canonical_collection_key)
      .map((record) => record.identity_version)
  );
  const recordContent: Omit<BackfillRecordContent, "record_digest"> = {
    schema_version: 1,
    collection_key: assertion.canonical_collection_key,
    identity_version: ceiling + 1,
    identity: identity.right,
    provenance,
    proxy_implementations,
  };
  const successor: BackfillRecordContent = {
    ...recordContent,
    record_digest: mintRecordDigest(recordContent),
  };

  return {
    status: "accepted",
    ledger: appendEvent(ledger, {
      schema_version: 1,
      kind: "identity_superseded",
      contract_version: IDENTITY_SUPERSESSION_CONTRACT_VERSION,
      cause: "operator_revision",
      sequence: ledger.events.length + 1,
      occurred_at: occurredAt,
      command_id: options.command_id,
      command_digest,
      ...(ledger.events.length > 0
        ? { prev_event_digest: ledger.events[ledger.events.length - 1]!.event_digest }
        : {}),
      authority_ref: assertion.authority_ref,
      reason: options.reason,
      affected_deployment_ids: sortVersionedDigests(
        mergedDeployments.map((deployment) => deployment.deployment_id)
      ),
      superseded: memberRecords
        .sort(
          (l, r) =>
            compareStrings(l.collection_key, r.collection_key) ||
            l.identity_version - r.identity_version
        )
        .map((record) => ({
          collection_key: record.collection_key,
          identity_version: record.identity_version,
          record_digest: record.record_digest,
        })),
      successors: [successor],
      revoked_equivalence_digests: [],
      impact,
    } as Omit<IdentitySupersededEvent, "event_digest">),
  };
}

function mergeProxyImplementations(
  groups: readonly (readonly RecordedProxyImplementation[])[]
): readonly RecordedProxyImplementation[] {
  const byKey = new Map<string, RecordedProxyImplementation>();
  for (const group of groups) {
    for (const binding of group) {
      const key = `${binding.proxy_id.digest}:${binding.implementation_id.digest}:${binding.source_reference}`;
      byKey.set(key, binding);
    }
  }
  return [...byKey.values()].sort(
    (l, r) =>
      compareStrings(versionedDigestKeyOf(l.proxy_id), versionedDigestKeyOf(r.proxy_id)) ||
      compareStrings(
        versionedDigestKeyOf(l.implementation_id),
        versionedDigestKeyOf(r.implementation_id)
      ) ||
      compareStrings(l.source_reference, r.source_reference)
  );
}

// ── Post-authority: equivalence revocation ───────────────────────────────────

/**
 * How the deployments freed by a revocation regroup. `curated_row` re-mints
 * a CURRENT registry row's identity (the corrected registry is the source of
 * truth); `operator_group` applies a fresh operator-approved grouping for
 * corrections the registry cannot yet express. In both cases the successor's
 * equivalence basis must not reuse a revoked assertion digest — the fold
 * refuses it.
 */
export type RevocationSuccessorSpec =
  | { readonly kind: "curated_row"; readonly collection_key: string }
  | { readonly kind: "operator_group"; readonly assertion: OperatorEquivalenceAssertion };

export interface EquivalenceRevocationRequest {
  /** The active identity version whose equivalence edge is wrong. */
  readonly revoked: RecordPointer;
  /** Operator authority record authorizing the revocation. */
  readonly authority_ref: string;
  readonly reason: string;
  readonly successors: readonly RevocationSuccessorSpec[];
  /** Current registry snapshot (successor identities mint from it). */
  readonly registry: readonly CollectionRegistryEntry[];
  /** CR-012A impact enumeration — explicit references only. */
  readonly impact: QuarantineImpactSet;
  readonly revoked_at: string;
  readonly command_id: string;
  readonly expected_state_digest: VersionedDigest;
}

/**
 * Revoke a wrong equivalence edge — post-authority only. The revoked identity
 * version becomes `revoked` (never deleted, never edited); its assertion
 * digest enters the permanent revoked set; the affected deployments regroup
 * into successor identities minted through the CR-001 package under NEW
 * immutable versions. The emitted event enumerates every affected deployment
 * and carries the CR-012A quarantine/supersession trigger for every reachable
 * work row and issued artifact the caller enumerated. Live-key surgery has no
 * API here: there is nothing to call that mutates an existing version.
 *
 * Incomplete impact discovery returns a typed blocked result without mutating
 * authoritative identity or revocation state — after exact-command
 * replay/conflict against the accepted command ledger.
 */
export function revokeEquivalence(
  ledger: BackfillLedger,
  request: EquivalenceRevocationRequest
): PostAuthorityMutationResult {
  if (request.authority_ref.length === 0) {
    throw new ValidationError("authority_ref", request.authority_ref, "a non-empty authority record reference");
  }
  const impact = decodeQuarantineImpactSet(request.impact);
  const occurredAt = assertIsoUtcTimestamp(request.revoked_at, "revoked_at");
  const decodedSuccessors = request.successors.map((spec) =>
    spec.kind === "curated_row"
      ? spec
      : {
          kind: "operator_group" as const,
          assertion: decodeOperatorEquivalenceAssertion(spec.assertion),
        }
  );
  const command_digest = mintCommandDigest({
    kind: "identity_superseded",
    cause: "equivalence_revocation",
    command_id: request.command_id,
    occurred_at: occurredAt,
    authority_ref: request.authority_ref,
    reason: request.reason,
    revoked: request.revoked,
    successors: decodedSuccessors.map((spec) =>
      spec.kind === "curated_row"
        ? { kind: spec.kind, collection_key: spec.collection_key }
        : {
            kind: spec.kind,
            assertion_digest: spec.assertion.assertion_digest,
            authority_ref: spec.assertion.authority_ref,
            canonical_collection_key: spec.assertion.canonical_collection_key,
          }
    ),
    impact,
  });
  // Exact-command replay/conflict precedes incomplete-discovery blocking.
  const prior = ledger.accepted_commands.find(
    (entry) => entry.command_id === request.command_id
  );
  if (prior !== undefined) {
    if (!sameVersionedDigest(prior.command_digest, command_digest)) {
      throw new BackfillCommandConflictError(
        `command_id "${request.command_id}" was already accepted with a different payload ` +
          `(prior digest ${prior.command_digest.digest}, retry digest ${command_digest.digest})`
      );
    }
    return { status: "accepted", ledger };
  }
  if (!impact.discovery_complete) {
    return {
      status: "blocked",
      reason_code: "discovery_incomplete",
      ledger,
      impact,
      detail:
        `impact enumeration "${impact.enumeration_ref}" is incomplete; revocation requires ` +
        `discovery_complete:true with the explicit complete set of reachable work-row/artifact refs`,
    };
  }
  if (!sameVersionedDigest(request.expected_state_digest, ledger.state_digest)) {
    throw new BackfillStalePlanError(
      `CAS refused: expected state ${request.expected_state_digest.digest} but ledger is at ` +
        `${ledger.state_digest.digest}`
    );
  }

  if (ledger.authority !== "authority_enabled") {
    throw new BackfillAuthorityError(
      "revokeEquivalence is a post-authority verb; pre-authority correction is plan/apply/rollback"
    );
  }

  const target = ledger.records.find(
    (record) =>
      record.collection_key === request.revoked.collection_key &&
      record.identity_version === request.revoked.identity_version
  );
  if (!target || !sameVersionedDigest(target.record_digest, request.revoked.record_digest)) {
    throw new BackfillRevocationError(
      `revocation target ${recordKeyOf(request.revoked)} does not match a stored record`
    );
  }
  if (target.status !== "active") {
    throw new BackfillRevocationError(
      `revocation target ${recordKeyOf(request.revoked)} is ${target.status}; only the active ` +
        `version carries authority`
    );
  }
  const basis = target.identity.equivalence_basis;
  if (basis.kind === "single_deployment") {
    throw new BackfillRevocationError(
      `identity "${target.collection_key}" v${target.identity_version} has a single_deployment ` +
        `basis — there is no equivalence edge to revoke; correct curation and supersede instead`
    );
  }

  const registryByKey = new Map(request.registry.map((entry) => [entry.collectionKey, entry]));
  const ceilingOf = (key: string): number =>
    Math.max(
      0,
      ...ledger.records
        .filter((record) => record.collection_key === key)
        .map((record) => record.identity_version)
    );

  const successors: BackfillRecordContent[] = [];
  const seenSuccessorKeys = new Set<string>();
  for (const spec of decodedSuccessors) {
    if (spec.kind === "curated_row") {
      const entry = registryByKey.get(spec.collection_key);
      if (!entry) {
        throw new BackfillRevocationError(
          `successor curated_row "${spec.collection_key}" does not exist in the registry ` +
            `snapshot; land the registry correction before revoking`
        );
      }
      const rowIdentity = mintRegistryRowIdentity(entry);
      const provenance = [
        mintProvenanceEntry(
          "inventory_registry",
          `inventory-registry:${entry.collectionKey}`,
          occurredAt,
          {
            collection_key: entry.collectionKey,
            deployment_ids: sortVersionedDigests(
              rowIdentity.identity.deployments.map((deployment) => deployment.deployment_id)
            ),
          }
        ),
      ];
      const content: Omit<BackfillRecordContent, "record_digest"> = {
        schema_version: 1,
        collection_key: entry.collectionKey,
        identity_version: ceilingOf(entry.collectionKey) + 1,
        identity: rowIdentity.identity,
        provenance,
        proxy_implementations: [],
      };
      successors.push({ ...content, record_digest: mintRecordDigest(content) });
    } else {
      const assertion = spec.assertion;
      if (ledger.revoked_equivalence.includes(versionedDigestKeyOf(assertion.assertion_digest))) {
        throw new BackfillRevocationError(
          `successor operator_group assertion ${assertion.authority_ref} reuses a revoked ` +
            `equivalence digest; a corrected grouping needs a fresh authority record`
        );
      }
      if (!registryByKey.has(assertion.canonical_collection_key)) {
        throw new BackfillRevocationError(
          `successor operator_group canonical key "${assertion.canonical_collection_key}" does ` +
            `not exist in the registry snapshot; the new view cannot serve metadata for it`
        );
      }
      const identity = runProtocol(
        makeCollectionIdentity({
          schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
          collection_key: assertion.canonical_collection_key,
          deployments: assertion.deployments,
          equivalence_basis: {
            schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
            kind: "operator_ratified",
            assertion_digest: assertion.assertion_digest,
            authority_ref: assertion.authority_ref,
          },
        })
      );
      if (Either.isLeft(identity)) {
        throw new ValidationError(
          "successors",
          assertion.authority_ref,
          `a CR-001-assemblable operator group — ${String(identity.left)}`
        );
      }
      const content: Omit<BackfillRecordContent, "record_digest"> = {
        schema_version: 1,
        collection_key: assertion.canonical_collection_key,
        identity_version: ceilingOf(assertion.canonical_collection_key) + 1,
        identity: identity.right,
        provenance: [
          mintProvenanceEntry("operator_ratified", assertion.authority_ref, assertion.approved_at, {
            assertion_digest: assertion.assertion_digest,
          }),
        ],
        proxy_implementations: [],
      };
      successors.push({ ...content, record_digest: mintRecordDigest(content) });
    }
    const last = successors[successors.length - 1]!;
    if (seenSuccessorKeys.has(last.collection_key)) {
      throw new BackfillRevocationError(
        `two successors share collection_key "${last.collection_key}"`
      );
    }
    seenSuccessorKeys.add(last.collection_key);
  }

  return {
    status: "accepted",
    ledger: appendEvent(ledger, {
      schema_version: 1,
      kind: "identity_superseded",
      contract_version: IDENTITY_SUPERSESSION_CONTRACT_VERSION,
      cause: "equivalence_revocation",
      sequence: ledger.events.length + 1,
      occurred_at: occurredAt,
      command_id: request.command_id,
      command_digest,
      ...(ledger.events.length > 0
        ? { prev_event_digest: ledger.events[ledger.events.length - 1]!.event_digest }
        : {}),
      authority_ref: request.authority_ref,
      reason: request.reason,
      affected_deployment_ids: sortVersionedDigests(
        target.identity.deployments.map((deployment) => deployment.deployment_id)
      ),
      superseded: [
        {
          collection_key: target.collection_key,
          identity_version: target.identity_version,
          record_digest: target.record_digest,
        },
      ],
      successors,
      revoked_equivalence_digests: [basis.assertion_digest],
      impact,
    } as Omit<IdentitySupersededEvent, "event_digest">),
  };
}

// ── New-key read view ────────────────────────────────────────────────────────

export interface BackfilledIdentityHit {
  readonly found: true;
  readonly record: BackfillIdentityRecord;
}

export interface BackfilledIdentityMiss {
  readonly found: false;
}

export type BackfilledIdentityResult = BackfilledIdentityHit | BackfilledIdentityMiss;

/**
 * Resolve a CR-001 deployment reference against the backfilled identity view.
 * Input decodes through the same protocol boundary as the CR-105 lookup
 * (digest-verified full refs, strict inputs, hybrids rejected). Exactly one
 * ACTIVE record may hold a deployment — the fold guarantees it.
 */
export function resolveBackfilledIdentity(
  ledger: BackfillLedger,
  input: unknown
): BackfilledIdentityResult {
  const query = decodeDeploymentReference(input);
  const record = ledger.records.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.identity.deployments.some(
        (deployment) => sameVersionedDigest(deployment.deployment_id, query.deployment_id)
      )
  );
  return record ? { found: true, record } : { found: false };
}

// ── Shared work keys (CR-001 collection.work-key) ────────────────────────────

export interface SharedWorkKeyRequest {
  readonly identity: CollectionIdentity;
  readonly capability: string;
  /** Semver-shaped capability version (CR-001 VersionIdentifier). */
  readonly capability_version: string;
  readonly finality_policies: readonly {
    readonly network_namespace: "eip155" | "solana";
    readonly network_reference: string;
    readonly finality_policy_version: string;
  }[];
}

/**
 * Mint the CR-001 shared work key for an identity version. The material is
 * decoded through the package (`CollectionWorkKeyMaterial`) and digested by
 * `digestCollectionWorkKey` — so the collision posture is CR-001's, not
 * ours: the key binds capability, capability version, `collection_id`
 * (which itself binds the deployment set and the explicit equivalence
 * basis), every `deployment_id`, and the finality policy set. Distinct
 * deployments cannot collapse; only an explicitly versioned equivalence can
 * share a logical key; a revocation mints a different `collection_id` and
 * therefore a different key.
 */
export function mintSharedWorkKey(request: SharedWorkKeyRequest): VersionedDigest {
  const identity = request.identity;
  if (
    identity.collection_id.domain !== "collection.identity" ||
    identity.collection_id.major_version !== COLLECTION_PROTOCOL_SCHEMA_VERSION
  ) {
    throw new ValidationError(
      "identity.collection_id",
      identity.collection_id,
      `collection.identity v${COLLECTION_PROTOCOL_SCHEMA_VERSION}`
    );
  }
  for (const deployment of identity.deployments) {
    if (
      deployment.deployment_id.domain !== "collection.deployment" ||
      deployment.deployment_id.major_version !== COLLECTION_PROTOCOL_SCHEMA_VERSION
    ) {
      throw new ValidationError(
        "identity.deployments",
        deployment.deployment_id,
        `collection.deployment v${COLLECTION_PROTOCOL_SCHEMA_VERSION}`
      );
    }
  }
  // Refuse grafted digests: re-assemble through the package so collection_id
  // is recomputed from deployments+basis, not trusted from the caller.
  const reassembled = runProtocol(
    makeCollectionIdentity({
      schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
      ...(identity.collection_key !== undefined
        ? { collection_key: identity.collection_key }
        : {}),
      deployments: identity.deployments,
      equivalence_basis: identity.equivalence_basis,
    })
  );
  if (Either.isLeft(reassembled)) {
    throw new ValidationError(
      "identity",
      identity.collection_id,
      `a CR-001-assemblable identity — ${String(reassembled.left)}`
    );
  }
  if (!sameVersionedDigest(reassembled.right.collection_id, identity.collection_id)) {
    throw new ValidationError(
      "identity.collection_id",
      identity.collection_id,
      `the package-recomputed collection_id ${reassembled.right.collection_id.digest} ` +
        `(grafted or tampered digests are refused)`
    );
  }

  const material = {
    schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
    capability: request.capability,
    capability_version: request.capability_version,
    collection_id: identity.collection_id,
    deployment_ids: sortVersionedDigests(
      identity.deployments.map((deployment) => deployment.deployment_id)
    ),
    finality_policies: [...request.finality_policies]
      .sort(
        (l, r) =>
          compareStrings(l.network_namespace, r.network_namespace) ||
          compareStrings(l.network_reference, r.network_reference)
      )
      .map((policy) => ({
        schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
        network: {
          schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
          network_namespace: policy.network_namespace,
          network_reference: policy.network_reference,
        },
        finality_policy_version: policy.finality_policy_version,
      })),
  };
  const decoded = runProtocol(decodeCollectionWorkKeyMaterial(material));
  if (Either.isLeft(decoded)) {
    throw new ValidationError(
      "work_key_material",
      material,
      `CR-001 CollectionWorkKeyMaterial — ${String(decoded.left)}`
    );
  }
  const digest = runProtocol(digestCollectionWorkKey(decoded.right));
  if (Either.isLeft(digest)) {
    throw new ValidationError(
      "work_key_material",
      material,
      `a digestable work key — ${String(digest.left)}`
    );
  }
  return digest.right;
}

// ── Reconciliation report ────────────────────────────────────────────────────

export interface BackfillReconciliationReport {
  readonly schema_version: 1;
  readonly contract_version: typeof IDENTITY_BACKFILL_CONTRACT_VERSION;
  readonly authority: AuthorityState;
  readonly state_digest: VersionedDigest;
  readonly event_count: number;
  readonly records: readonly {
    readonly collection_key: string;
    readonly identity_version: number;
    readonly status: BackfillRecordStatus;
    readonly collection_id: VersionedDigest;
    readonly record_digest: VersionedDigest;
    readonly deployment_count: number;
    readonly equivalence_kind: string;
  }[];
  readonly revoked_equivalence: readonly string[];
  readonly events: readonly {
    readonly sequence: number;
    readonly kind: BackfillLedgerEvent["kind"];
    readonly occurred_at: string;
    readonly event_digest: VersionedDigest;
    readonly summary: string;
    readonly counts?: Readonly<Record<BackfillAction, number>>;
    readonly items?: readonly AppliedPlanItemSummary[];
    readonly affected_deployment_ids?: readonly VersionedDigest[];
    readonly impact?: QuarantineImpactSet;
  }[];
  readonly report_digest: VersionedDigest;
}

/**
 * The auditable reconciliation report: the full event trail (including every
 * quarantine/blocked line item verbatim), the current record inventory, and
 * the revoked-edge set — deterministic, digest-pinned, derived entirely from
 * the ledger.
 */
export function reconciliationReportOf(ledger: BackfillLedger): BackfillReconciliationReport {
  const events = ledger.events.map((event) => {
    const base = {
      sequence: event.sequence,
      kind: event.kind,
      occurred_at: event.occurred_at,
      event_digest: event.event_digest,
    };
    switch (event.kind) {
      case "backfill_applied":
        return {
          ...base,
          summary:
            `applied plan ${event.plan_digest.digest.slice(0, 12)}…: ` +
            `${event.counts.create} create, ${event.counts.noop} noop, ` +
            `${event.counts.update} update, ${event.counts.quarantine} quarantine, ` +
            `${event.counts.blocked} blocked`,
          counts: event.counts,
          items: event.items,
        };
      case "backfill_rolled_back":
        return {
          ...base,
          summary: `rolled back to sequence ${event.through_sequence}: ${event.reason}`,
        };
      case "authority_enabled":
        return {
          ...base,
          summary:
            `new-key authority enabled (parity ${event.parity_report_digest.digest.slice(0, 12)}…, ` +
            `state ${event.state_digest.digest.slice(0, 12)}…)`,
        };
      case "identity_superseded":
        return {
          ...base,
          summary:
            `${event.cause === "equivalence_revocation" ? "equivalence revoked" : "operator revision"} ` +
            `by ${event.authority_ref}: ${event.superseded.length} superseded → ` +
            `${event.successors.length} successor(s); impact refs: ` +
            `${event.impact.work_rows.length} work row(s), ` +
            `${event.impact.issued_artifacts.length} artifact(s) (explicit references only)`,
          affected_deployment_ids: event.affected_deployment_ids,
          impact: event.impact,
        };
    }
  });

  const body: Omit<BackfillReconciliationReport, "report_digest"> = {
    schema_version: 1 as const,
    contract_version: IDENTITY_BACKFILL_CONTRACT_VERSION,
    authority: ledger.authority,
    state_digest: ledger.state_digest,
    event_count: ledger.events.length,
    records: ledger.records.map((record) => ({
      collection_key: record.collection_key,
      identity_version: record.identity_version,
      status: record.status,
      collection_id: record.identity.collection_id,
      record_digest: record.record_digest,
      deployment_count: record.identity.deployments.length,
      equivalence_kind: record.identity.equivalence_basis.kind,
    })),
    revoked_equivalence: ledger.revoked_equivalence,
    events,
  };
  return {
    ...body,
    report_digest: mintInventoryDigest(REPORT_DIGEST_DOMAIN, LEDGER_DIGEST_VERSION, body),
  };
}
