/**
 * CR-108 — Old/new (legacy vs new-key) read parity proof
 * (`inventory.read-parity.v1`).
 *
 * The pre-cutover gate: before shared-work keys may trust the backfilled
 * identity view, every read the LEGACY path answers must be answered
 * identically by the NEW path.
 *
 * - The legacy read is the ACTUAL CR-105 exact-enrichment lookup
 *   (`lookupExactDeployment`) — not a re-derivation of it. The lookup is
 *   injectable so tests can simulate legacy-view drift, but the default is
 *   the real production read.
 * - The new read is the backfill ledger's active-record view, joined to the
 *   registry snapshot for metadata by the record's `collection_key` (the new
 *   view owns identity; metadata stays registry-owned per this repo's
 *   invariants).
 * - The proof walks BOTH directions: every registry-snapshot deployment must
 *   resolve identically in both views (miss, changed exact-hit metadata,
 *   changed equivalence — deployment set OR basis — and ambiguous edges all
 *   fail), and every active record's deployment must still be asserted by
 *   the registry snapshot (a record the legacy view cannot serve is a
 *   parity failure, not an "extra").
 *
 * Any mismatch ⇒ `pass: false` ⇒ `enableAuthority` refuses ⇒ production
 * Ordering stays disabled. The report is deterministic and digest-pinned so
 * the enablement event can bind the exact proof it accepted.
 *
 * `enableAuthority` NEVER trusts a caller-minted report as authority for a
 * genuinely new enablement command: it re-invokes this proof over the live
 * ledger + registry snapshot, then (if a caller-supplied expected report is
 * present for audit) strict-decodes that copy and requires exact equality
 * with the recomputed proof. Accepted-command replay/conflict for the same
 * `command_id` short-circuits before this recompute so later identity
 * revisions cannot turn an identical enable retry into a parity failure.
 * `verifyAuthorityParityReport` remains the strict-decode helper for that
 * audit path and refuses grafted bindings, omitted entries, pass-with-
 * mismatches, and self-referential proposed/proposed source pairs.
 *
 * Equivalent registry permutations produce one canonical report: every
 * projection part, entry, and view digest is ordered by the stable
 * deployment-identity key before hashing.
 */
import { Either, Schema } from "effect";
import {
  VersionedDigest,
  type VersionedDigest as VD,
} from "@freeside/collection-protocol";
import {
  lookupExactDeployment,
  registryDeploymentRefsOf,
  type ExactEnrichmentResult,
} from "./exact-enrichment.js";
import {
  mintInventoryDigest,
  registrySnapshotDigestOf,
  stateDigestOf,
  versionedDigestKeyOf,
} from "./identity-backfill.js";
import type { BackfillLedger } from "./identity-ledger.js";
import {
  effectiveRehostPolicy,
  type CollectionRegistryEntry,
} from "./collection-registry.js";
import { ValidationError } from "./errors.js";

export const READ_PARITY_CONTRACT_VERSION = "inventory.read-parity.v1";

export const PARITY_DIGEST_DOMAIN = "inventory.read-parity";
export const PARITY_DIGEST_VERSION = 1;

/** Legacy view source binding — must name the real CR-105 enrichment contract. */
export const LEGACY_PARITY_SOURCE = "inventory.exact-enrichment.v1" as const;
/** New view source binding — must name the backfill ledger contract. */
export const NEW_PARITY_SOURCE = "inventory.identity-backfill.v1" as const;

const STRICT = { errors: "all" as const, onExcessProperty: "error" as const };

export type ReadParityMismatchKind =
  | "missing_in_legacy_view"
  | "missing_in_new_view"
  | "ambiguous_new_view"
  | "metadata_mismatch"
  | "equivalence_mismatch"
  | "record_not_curated";

export interface ReadParityMismatch {
  readonly kind: ReadParityMismatchKind;
  readonly deployment_id: VD;
  readonly collection_key?: string;
  readonly detail: string;
}

export interface ReadParityEntry {
  readonly deployment_id: VD;
  readonly collection_key: string;
  readonly legacy_projection_digest: VD;
  readonly new_projection_digest: VD;
  readonly outcome: "match" | ReadParityMismatchKind;
}

export interface ReadParityViewBinding {
  readonly source: typeof LEGACY_PARITY_SOURCE | typeof NEW_PARITY_SOURCE;
  readonly view_digest: VD;
}

export interface ReadParityReport {
  readonly schema_version: 1;
  readonly contract_version: typeof READ_PARITY_CONTRACT_VERSION;
  /** State digest of the ledger view the proof ran against. */
  readonly state_digest: VD;
  /** Registry snapshot digest the proof ran against. */
  readonly registry_digest: VD;
  /**
   * Legacy (CR-105) view binding. Self-referential proofs that bind both
   * sides to the proposed/backfill source are refused at verify time.
   */
  readonly legacy_binding: ReadParityViewBinding;
  /** New (backfill ledger) view binding. */
  readonly new_binding: ReadParityViewBinding;
  readonly checked_deployments: number;
  /** One entry per curated deployment checked in direction 1. */
  readonly entries: readonly ReadParityEntry[];
  readonly mismatches: readonly ReadParityMismatch[];
  readonly pass: boolean;
  readonly report_digest: VD;
}

export interface ReadParityInput {
  readonly ledger: BackfillLedger;
  readonly registry: readonly CollectionRegistryEntry[];
  /**
   * The legacy read. Defaults to the REAL CR-105 lookup; injectable so tests
   * can prove the gate trips on legacy/new divergence.
   */
  readonly legacyLookup?: (input: unknown) => ExactEnrichmentResult;
}

/** Exact-hit metadata surface compared between the two views. */
interface MetadataProjection {
  readonly collection_key: string;
  readonly name: string;
  readonly symbol: string;
  readonly aliases: readonly string[];
  readonly total_supply: number;
  readonly enabled: boolean;
  readonly metadata_strategy: unknown;
  readonly rehost_policy: string;
  readonly image_host?: readonly string[];
}

function legacyMetadataOf(hit: Extract<ExactEnrichmentResult, { found: true }>): MetadataProjection {
  return {
    collection_key: hit.collection.collection_key,
    name: hit.collection.name,
    symbol: hit.collection.symbol,
    aliases: hit.collection.aliases,
    total_supply: hit.collection.total_supply,
    enabled: hit.collection.enabled,
    metadata_strategy: hit.collection.metadata_strategy,
    rehost_policy: hit.collection.rehost_policy,
    ...("image_host" in hit.collection ? { image_host: hit.collection.image_host } : {}),
  };
}

function newViewMetadataOf(
  entry: CollectionRegistryEntry,
  rehostPolicy: string
): MetadataProjection {
  return {
    collection_key: entry.collectionKey,
    name: entry.name,
    symbol: entry.symbol,
    aliases: entry.aliases,
    total_supply: entry.totalSupply,
    enabled: entry.enabled,
    metadata_strategy: entry.metadataStrategy,
    rehost_policy: rehostPolicy,
    ...(entry.imageHost && entry.imageHost.length > 0
      ? { image_host: entry.imageHost }
      : {}),
  };
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectionDigest(label: string, material: unknown): VD {
  return mintInventoryDigest(PARITY_DIGEST_DOMAIN, PARITY_DIGEST_VERSION, {
    side: label,
    material,
  });
}

function compareDigestKeys(left: VD, right: VD): number {
  const lk = versionedDigestKeyOf(left);
  const rk = versionedDigestKeyOf(right);
  return lk < rk ? -1 : lk > rk ? 1 : 0;
}

function sameVersionedDigest(left: VD, right: VD): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.domain === right.domain &&
    left.major_version === right.major_version &&
    left.digest === right.digest
  );
}

/** Canonical identity-key order for equivalence deployment digests. */
function sortedDigestKeys(ids: readonly VD[]): readonly string[] {
  return [...ids]
    .sort(compareDigestKeys)
    .map((id) => versionedDigestKeyOf(id));
}

function sortProjectionParts(
  parts: readonly { readonly deployment_id: VD; readonly digest: VD }[]
): readonly { readonly deployment_id: VD; readonly digest: VD }[] {
  return [...parts].sort((l, r) => compareDigestKeys(l.deployment_id, r.deployment_id));
}

function reportDigestMaterial(body: Omit<ReadParityReport, "report_digest">): unknown {
  return {
    schema_version: body.schema_version,
    contract_version: body.contract_version,
    state_digest: body.state_digest,
    registry_digest: body.registry_digest,
    legacy_binding: body.legacy_binding,
    new_binding: body.new_binding,
    checked_deployments: body.checked_deployments,
    entries: body.entries.map((entry) => ({
      deployment_id: entry.deployment_id,
      collection_key: entry.collection_key,
      legacy_projection_digest: entry.legacy_projection_digest,
      new_projection_digest: entry.new_projection_digest,
      outcome: entry.outcome,
    })),
    mismatches: body.mismatches.map((mismatch) => ({
      kind: mismatch.kind,
      deployment_id: mismatch.deployment_id,
      ...(mismatch.collection_key !== undefined
        ? { collection_key: mismatch.collection_key }
        : {}),
      detail: mismatch.detail,
    })),
    pass: body.pass,
  };
}

function mintReportDigest(body: Omit<ReadParityReport, "report_digest">): VD {
  return mintInventoryDigest(
    PARITY_DIGEST_DOMAIN,
    PARITY_DIGEST_VERSION,
    reportDigestMaterial(body)
  );
}

/**
 * Prove (or refute) legacy vs new-key read parity. Pure over its inputs: no
 * I/O beyond the injected lookup, no clock, deterministic mismatch ordering,
 * canonical report digest. This is the sole constructor of a passing
 * authority-bound parity report — `enableAuthority` re-invokes it over the
 * live ledger + registry rather than trusting a caller-minted copy.
 */
export function proveLegacyNewParity(input: ReadParityInput): ReadParityReport {
  const legacyLookup = input.legacyLookup ?? lookupExactDeployment;
  const mismatches: ReadParityMismatch[] = [];
  const entries: ReadParityEntry[] = [];
  const legacyProjectionParts: { deployment_id: VD; digest: VD }[] = [];
  const newProjectionParts: { deployment_id: VD; digest: VD }[] = [];

  const registryByKey = new Map(input.registry.map((entry) => [entry.collectionKey, entry]));
  const activeRecords = input.ledger.records.filter((record) => record.status === "active");

  // New-view deployment index (also detects ambiguity defensively — the
  // ledger fold already makes a double-claim unrepresentable).
  const activeByDeployment = new Map<string, (typeof activeRecords)[number][]>();
  for (const record of activeRecords) {
    for (const deployment of record.identity.deployments) {
      const key = deployment.deployment_id.digest;
      const bucket = activeByDeployment.get(key) ?? [];
      bucket.push(record);
      activeByDeployment.set(key, bucket);
    }
  }

  // Direction 1: every curated deployment answers identically in both views.
  let checked = 0;
  const curatedDigests = new Set<string>();
  for (const entry of input.registry) {
    for (const ref of registryDeploymentRefsOf(entry)) {
      checked += 1;
      curatedDigests.add(ref.deployment_id.digest);

      const legacy = legacyLookup(ref);
      const holders = activeByDeployment.get(ref.deployment_id.digest) ?? [];

      let outcome: ReadParityEntry["outcome"] = "match";
      let legacyProjection: unknown = { found: false };
      let newProjection: unknown = { holders: 0 };

      if (!legacy.found) {
        outcome = "missing_in_legacy_view";
        mismatches.push({
          kind: "missing_in_legacy_view",
          deployment_id: ref.deployment_id,
          collection_key: entry.collectionKey,
          detail:
            `registry snapshot asserts ${ref.normalized_address} for "${entry.collectionKey}" ` +
            `but the legacy exact-enrichment lookup misses it`,
        });
      } else if (holders.length === 0) {
        legacyProjection = {
          found: true,
          metadata: legacyMetadataOf(legacy),
          equivalence: {
            basis: legacy.equivalence.basis,
            deployment_ids: sortedDigestKeys(
              legacy.equivalence.deployments.map((deployment) => deployment.deployment_id)
            ),
          },
        };
        outcome = "missing_in_new_view";
        mismatches.push({
          kind: "missing_in_new_view",
          deployment_id: ref.deployment_id,
          collection_key: entry.collectionKey,
          detail:
            `legacy lookup serves ${ref.normalized_address} ("${entry.collectionKey}") but no ` +
            `active backfilled identity holds it`,
        });
      } else if (holders.length > 1) {
        legacyProjection = {
          found: true,
          metadata: legacyMetadataOf(legacy),
          equivalence: {
            basis: legacy.equivalence.basis,
            deployment_ids: sortedDigestKeys(
              legacy.equivalence.deployments.map((deployment) => deployment.deployment_id)
            ),
          },
        };
        newProjection = { holders: holders.length };
        outcome = "ambiguous_new_view";
        mismatches.push({
          kind: "ambiguous_new_view",
          deployment_id: ref.deployment_id,
          collection_key: entry.collectionKey,
          detail:
            `deployment ${ref.normalized_address} resolves to ${holders.length} active ` +
            `identities — an ambiguous edge can never carry authority`,
        });
      } else {
        const record = holders[0]!;
        const newEntry = registryByKey.get(record.collection_key);
        const legacyEquivalence = {
          basis: legacy.equivalence.basis,
          deployment_ids: sortedDigestKeys(
            legacy.equivalence.deployments.map((deployment) => deployment.deployment_id)
          ),
        };
        legacyProjection = {
          found: true,
          metadata: legacyMetadataOf(legacy),
          equivalence: legacyEquivalence,
        };
        if (!newEntry) {
          newProjection = { holders: 1, collection_key: record.collection_key, metadata: null };
          outcome = "metadata_mismatch";
          mismatches.push({
            kind: "metadata_mismatch",
            deployment_id: ref.deployment_id,
            collection_key: record.collection_key,
            detail:
              `new view resolves ${ref.normalized_address} to collection_key ` +
              `"${record.collection_key}" which the registry snapshot cannot serve metadata for`,
          });
        } else {
          const legacyMetadata = legacyMetadataOf(legacy);
          const newMetadata = newViewMetadataOf(newEntry, effectiveRehostPolicy(newEntry));
          const newEquivalence = {
            basis: record.identity.equivalence_basis,
            deployment_ids: sortedDigestKeys(
              record.identity.deployments.map((deployment) => deployment.deployment_id)
            ),
          };
          newProjection = {
            found: true,
            metadata: newMetadata,
            equivalence: newEquivalence,
          };
          if (!stableEqual(legacyMetadata, newMetadata)) {
            outcome = "metadata_mismatch";
            mismatches.push({
              kind: "metadata_mismatch",
              deployment_id: ref.deployment_id,
              collection_key: entry.collectionKey,
              detail:
                `exact-hit metadata changed between views for ${ref.normalized_address}: legacy ` +
                `serves "${legacyMetadata.collection_key}", new view serves ` +
                `"${newMetadata.collection_key}" (full projections differ)`,
            });
          } else if (!stableEqual(legacyEquivalence, newEquivalence)) {
            outcome = "equivalence_mismatch";
            mismatches.push({
              kind: "equivalence_mismatch",
              deployment_id: ref.deployment_id,
              collection_key: entry.collectionKey,
              detail:
                `equivalence changed between views for ${ref.normalized_address}: legacy basis ` +
                `${legacy.equivalence.basis.kind} over ${legacyEquivalence.deployment_ids.length} ` +
                `deployment(s), new basis ${newEquivalence.basis.kind} over ` +
                `${newEquivalence.deployment_ids.length}`,
            });
          }
        }
      }

      const legacy_projection_digest = projectionDigest("legacy", {
        deployment_id: ref.deployment_id,
        projection: legacyProjection,
      });
      const new_projection_digest = projectionDigest("new", {
        deployment_id: ref.deployment_id,
        projection: newProjection,
      });
      legacyProjectionParts.push({
        deployment_id: ref.deployment_id,
        digest: legacy_projection_digest,
      });
      newProjectionParts.push({
        deployment_id: ref.deployment_id,
        digest: new_projection_digest,
      });
      entries.push({
        deployment_id: ref.deployment_id,
        collection_key: entry.collectionKey,
        legacy_projection_digest,
        new_projection_digest,
        outcome,
      });
    }
  }

  // Direction 2: no active record serves identity the registry snapshot
  // does not assert (the legacy view could never answer it).
  for (const record of activeRecords) {
    for (const deployment of record.identity.deployments) {
      if (!curatedDigests.has(deployment.deployment_id.digest)) {
        mismatches.push({
          kind: "record_not_curated",
          deployment_id: deployment.deployment_id,
          collection_key: record.collection_key,
          detail:
            `active identity "${record.collection_key}" v${record.identity_version} holds ` +
            `deployment ${deployment.normalized_address} which the registry snapshot does not ` +
            `assert; the legacy view cannot serve it`,
        });
      }
    }
  }

  mismatches.sort((l, r) => {
    const lk = `${versionedDigestKeyOf(l.deployment_id)} ${l.kind}`;
    const rk = `${versionedDigestKeyOf(r.deployment_id)} ${r.kind}`;
    return lk < rk ? -1 : lk > rk ? 1 : 0;
  });
  entries.sort((l, r) => compareDigestKeys(l.deployment_id, r.deployment_id));
  const canonicalLegacyParts = sortProjectionParts(legacyProjectionParts);
  const canonicalNewParts = sortProjectionParts(newProjectionParts);

  const body: Omit<ReadParityReport, "report_digest"> = {
    schema_version: 1,
    contract_version: READ_PARITY_CONTRACT_VERSION,
    state_digest: stateDigestOf(input.ledger.records),
    registry_digest: registrySnapshotDigestOf(input.registry),
    legacy_binding: {
      source: LEGACY_PARITY_SOURCE,
      view_digest: mintInventoryDigest(PARITY_DIGEST_DOMAIN, PARITY_DIGEST_VERSION, {
        binding: "legacy",
        parts: canonicalLegacyParts,
      }),
    },
    new_binding: {
      source: NEW_PARITY_SOURCE,
      view_digest: mintInventoryDigest(PARITY_DIGEST_DOMAIN, PARITY_DIGEST_VERSION, {
        binding: "new",
        parts: canonicalNewParts,
      }),
    },
    checked_deployments: checked,
    entries,
    mismatches,
    pass: mismatches.length === 0 && checked > 0,
  };
  return {
    ...body,
    report_digest: mintReportDigest(body),
  };
}

/** @deprecated Prefer `proveLegacyNewParity` — same semantics, clearer name. */
export const proveReadParity = proveLegacyNewParity;

const ReadParityMismatchKindSchema = Schema.Literal(
  "missing_in_legacy_view",
  "missing_in_new_view",
  "ambiguous_new_view",
  "metadata_mismatch",
  "equivalence_mismatch",
  "record_not_curated"
);

const ReadParityMismatchSchema = Schema.Struct({
  kind: ReadParityMismatchKindSchema,
  deployment_id: VersionedDigest,
  collection_key: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1)), { exact: true }),
  detail: Schema.String.pipe(Schema.minLength(1)),
});

const ReadParityEntrySchema = Schema.Struct({
  deployment_id: VersionedDigest,
  collection_key: Schema.String.pipe(Schema.minLength(1)),
  legacy_projection_digest: VersionedDigest,
  new_projection_digest: VersionedDigest,
  outcome: Schema.Union(Schema.Literal("match"), ReadParityMismatchKindSchema),
});

const ReadParityViewBindingSchema = Schema.Struct({
  source: Schema.Union(Schema.Literal(LEGACY_PARITY_SOURCE), Schema.Literal(NEW_PARITY_SOURCE)),
  view_digest: VersionedDigest,
});

const ReadParityReportSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  contract_version: Schema.Literal(READ_PARITY_CONTRACT_VERSION),
  state_digest: VersionedDigest,
  registry_digest: VersionedDigest,
  legacy_binding: ReadParityViewBindingSchema,
  new_binding: ReadParityViewBindingSchema,
  checked_deployments: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  entries: Schema.Array(ReadParityEntrySchema),
  mismatches: Schema.Array(ReadParityMismatchSchema),
  pass: Schema.Boolean,
  report_digest: VersionedDigest,
});

const decodeParityReport = Schema.decodeUnknownEither(ReadParityReportSchema, STRICT);

/**
 * Strict-decode + re-verify a parity report for authority enablement.
 * Refuses forged domains, grafted digests, omitted entries, pass-with-
 * mismatches, and self-referential proposed/proposed source bindings.
 */
export function verifyAuthorityParityReport(input: unknown): ReadParityReport {
  const decoded = decodeParityReport(input);
  if (Either.isLeft(decoded)) {
    throw new ValidationError(
      "parity_report",
      input,
      `a strict ${READ_PARITY_CONTRACT_VERSION} report — ${String(decoded.left)}`
    );
  }
  const report = decoded.right as ReadParityReport;

  if (report.report_digest.domain !== PARITY_DIGEST_DOMAIN) {
    throw new ValidationError(
      "parity_report.report_digest.domain",
      report.report_digest.domain,
      PARITY_DIGEST_DOMAIN
    );
  }
  if (report.report_digest.major_version !== PARITY_DIGEST_VERSION) {
    throw new ValidationError(
      "parity_report.report_digest.major_version",
      report.report_digest.major_version,
      String(PARITY_DIGEST_VERSION)
    );
  }
  if (report.legacy_binding.source !== LEGACY_PARITY_SOURCE) {
    throw new ValidationError(
      "parity_report.legacy_binding.source",
      report.legacy_binding.source,
      LEGACY_PARITY_SOURCE
    );
  }
  if (report.new_binding.source !== NEW_PARITY_SOURCE) {
    throw new ValidationError(
      "parity_report.new_binding.source",
      report.new_binding.source,
      NEW_PARITY_SOURCE
    );
  }
  // Self-referential proposed/proposed: both sides must name distinct contracts.
  // (Verified above as exact literals; keep an explicit refuse for grafted
  // reports that somehow share a source label under a widened decode.)
  if (
    (report.legacy_binding.source as string) === (report.new_binding.source as string)
  ) {
    throw new ValidationError(
      "parity_report.bindings",
      report.legacy_binding.source,
      "distinct legacy vs new sources — self-referential proposed/proposed proofs are refused"
    );
  }
  if (report.entries.length !== report.checked_deployments) {
    throw new ValidationError(
      "parity_report.entries",
      report.entries.length,
      `exactly checked_deployments (${report.checked_deployments}) entries — omitted entries are refused`
    );
  }
  const expectedLegacyBinding = mintInventoryDigest(
    PARITY_DIGEST_DOMAIN,
    PARITY_DIGEST_VERSION,
    {
      binding: "legacy",
      parts: sortProjectionParts(
        report.entries.map((entry) => ({
          deployment_id: entry.deployment_id,
          digest: entry.legacy_projection_digest,
        }))
      ),
    }
  );
  if (!sameVersionedDigest(expectedLegacyBinding, report.legacy_binding.view_digest)) {
    throw new ValidationError(
      "parity_report.legacy_binding.view_digest",
      report.legacy_binding.view_digest,
      `digest recomputed from all ${report.entries.length} legacy projection entries`
    );
  }
  const expectedNewBinding = mintInventoryDigest(
    PARITY_DIGEST_DOMAIN,
    PARITY_DIGEST_VERSION,
    {
      binding: "new",
      parts: sortProjectionParts(
        report.entries.map((entry) => ({
          deployment_id: entry.deployment_id,
          digest: entry.new_projection_digest,
        }))
      ),
    }
  );
  if (!sameVersionedDigest(expectedNewBinding, report.new_binding.view_digest)) {
    throw new ValidationError(
      "parity_report.new_binding.view_digest",
      report.new_binding.view_digest,
      `digest recomputed from all ${report.entries.length} new projection entries`
    );
  }
  const expectedPass = report.mismatches.length === 0 && report.checked_deployments > 0;
  if (report.pass !== expectedPass) {
    throw new ValidationError(
      "parity_report.pass",
      report.pass,
      `pass === (mismatches.length === 0 && checked_deployments > 0); got mismatches=${report.mismatches.length}, checked=${report.checked_deployments}`
    );
  }

  const { report_digest: _stored, ...body } = report;
  const recomputed = mintReportDigest(body);
  if (recomputed.digest !== report.report_digest.digest) {
    throw new ValidationError(
      "parity_report.report_digest",
      report.report_digest.digest,
      `recomputed digest ${recomputed.digest} — forged or tampered report material`
    );
  }
  return { ...body, report_digest: recomputed };
}

/**
 * Validating constructor: only a strict-verified full parity report may be
 * presented to `enableAuthority`. Thin `{ pass: true }` stubs cannot be minted.
 */
export function bindAuthorityParityEvidence(input: unknown): ReadParityReport {
  return verifyAuthorityParityReport(input);
}
