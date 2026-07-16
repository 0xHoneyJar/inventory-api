/**
 * CR-105 — Exact Inventory enrichment contract (`inventory.exact-enrichment.v1`).
 *
 * Exact deployment lookup over the curated collection registry, keyed by the
 * shared chain-qualified deployment reference from CR-001. The boundary is the
 * CR-001 package ITSELF — `@freeside/collection-protocol`, consumed as the
 * exact `pnpm pack` artifact of the CR-001 worktree (commit `a688e516`,
 * checksum-pinned; see `vendor/collection-protocol/PROVENANCE.md`, same seam
 * CR-003 uses). No schema here is a hand-mirrored copy, and no canonical
 * encoding is duplicated: decode, normalization, digest minting, and digest
 * verification all run through the package's own strict decoders.
 *
 * What this module is:
 * - Registry truth + enrichment for a deployment the caller ALREADY names
 *   exactly. The resolver (sonar-api, CR-102) joins its chain-probed
 *   candidates against this; Inventory never probes a chain, fans out, or
 *   guesses. Zero network I/O — one Map read over a module-load index.
 * - An immutable boundary: internal index state (verified refs, equivalence
 *   evidence, the collection snapshot) is deep-frozen at module load and
 *   shares nothing with the live registry objects; every hit is served as a
 *   fresh `structuredClone` of its frozen template. A caller mutating a
 *   result — popping the deployment set, rewriting nested network/digest
 *   fields, aliases, strategy, image hosts — can never corrupt later lookups,
 *   other callers' results, or the registry.
 *
 * Accepted input — exactly two CR-001 wire forms, nothing between:
 * - `CollectionDeploymentInput` (`{ schema_version, network, address }`),
 *   strict-decoded with excess properties rejected. Any partial/hybrid
 *   reference field (`normalized_address` or `deployment_id` without the
 *   other, or either without full-ref validity) fails BOTH decoders and is
 *   rejected as `ValidationError` — hybrids are unrepresentable, not merely
 *   discouraged.
 * - Full `CollectionDeploymentRef`, accepted ONLY after the package recomputes
 *   `deployment_id` from the canonical material and verifies it matches
 *   (`decodeCollectionDeploymentRef` → `ContractIntegrityError` on mismatch).
 *   A shape-valid but fake digest is rejected, never matched or echoed.
 *
 * Identity semantics are CR-001's, not weakened:
 * - EVM compares case-insensitively (lowercase comparison form) while results
 *   retain EIP-55 checksum display form; Solana keys are case-sensitive and
 *   never case-folded (strict 32-byte base58 public keys).
 * - Address-only and numeric-chain-only references are unrepresentable (the
 *   network object is required and namespace-tagged); no single numeric
 *   chain-id shape spans VMs — eip155 keys on the canonical decimal reference,
 *   solana on the cluster reference (`"mainnet-beta"`).
 * - Matching is exact-only, keyed on the package-minted `deployment_id`
 *   digest (which binds namespace + network reference + normalized address).
 *   Route aliases are not addresses and fail input decode, so an alias
 *   fallback is impossible by construction. Unknown exact deployment returns
 *   an explicit `{ found: false }`.
 *
 * Registry validation (module load, fail-closed): every deployment a registry
 * row asserts is run through `makeCollectionDeploymentRef` — the package
 * validates the EVM address pattern, the strict 32-byte Solana public key,
 * and the canonical EIP-155 decimal reference, then mints the verified
 * `deployment_id`. Rows gate on `Number.isSafeInteger(chainId)` before
 * decimal derivation (an unsafe integer stringifies to a silently-wrong but
 * pattern-valid decimal), and the legacy `chainId: 101` convention maps to
 * `"mainnet-beta"` — any other SVM id fails the load rather than guessing a
 * cluster. A row that cannot produce verified deployment identity breaks the
 * module load.
 *
 * Logical equivalence is CR-001 `EquivalenceBasis`, exactly:
 * - Single-deployment rows carry `{ schema_version, kind: "single_deployment" }`.
 * - Multi-deployment rows (curated registry evidence, e.g. Fractures) carry
 *   `{ schema_version, kind: "registry", assertion_digest }` where
 *   `assertion_digest` is a deterministic `VersionedDigest` minted through the
 *   package's canonical (RFC 8785) encoder over
 *   `{ source: "inventory_registry", source_reference:
 *   "inventory-registry:<collection_key>", deployment_ids: <sorted set> }` —
 *   cryptographically binding the exact deployment set (each `deployment_id`
 *   itself binds namespace/reference/normalized address) to the curated
 *   assertion source, under the versioned domain
 *   `inventory.registry-equivalence` v1.
 * - Every emitted basis is strict-decoded through the package's
 *   `EquivalenceBasis` schema at index build, and every (deployments, basis)
 *   pair must pass the package's own `makeCollectionIdentity` assembly
 *   (sorted-set + invariant checks). The minted `collection_id` is DISCARDED:
 *   logical-identity authority is CR-108's backfill deliverable, not this
 *   lookup's. Metadata similarity and aliases can never create equivalence —
 *   only the explicit curated assertion.
 *
 * Boundary errors stay this repo's typed errors (`ValidationError`); Effect is
 * an implementation detail of the protocol package and never escapes this
 * module.
 */
import { Effect, Either, Schema } from "effect";
import {
  COLLECTION_PROTOCOL_SCHEMA_VERSION,
  EquivalenceBasis,
  decodeCollectionDeploymentRef,
  digestVersioned,
  makeCollectionDeploymentRef,
  makeCollectionIdentity,
  type CollectionDeploymentInput,
  type CollectionDeploymentRef,
  type CollectionIdentity,
  type VersionedDigest,
} from "@freeside/collection-protocol";
import {
  listCollectionRegistry,
  effectiveRehostPolicy,
  type CollectionRegistryEntry,
  type MetadataStrategy,
  type RehostPolicy,
} from "./collection-registry.js";
import { toChecksumAddress } from "./address.js";
import { ValidationError } from "./errors.js";

export type {
  CollectionDeploymentInput,
  CollectionDeploymentRef,
  EquivalenceBasis,
  VersionedDigest,
} from "@freeside/collection-protocol";

export const EXACT_ENRICHMENT_CONTRACT_VERSION = "inventory.exact-enrichment.v1";

/**
 * Canonical Solana mainnet network reference — the CR-001 protocol fixture
 * value (`solana-candidate.valid.json`), NOT the legacy numeric 101.
 */
export const SOLANA_MAINNET_NETWORK_REFERENCE = "mainnet-beta";

/** Legacy registry convention: `chainId: 101` means Solana mainnet. */
const SOLANA_LEGACY_MAINNET_CHAIN_ID = 101;

/**
 * Versioned digest domain for the curated registry's equivalence assertion.
 * The domain is inventory's (the registry is inventory's curated assertion;
 * CR-001's `Provenance.source` vocabulary names this source
 * `"inventory_registry"`) — CR-001 constrains an equivalence assertion digest
 * to `major_version >= 1` and leaves the asserting authority to pick its
 * domain. Bump the major version if the assertion material layout changes.
 */
export const REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN = "inventory.registry-equivalence";
export const REGISTRY_EQUIVALENCE_ASSERTION_VERSION = 1;

// ── CR-001 package boundary (strict decode + digest verification) ───────────

const STRICT_DECODE_OPTIONS = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const decodeEquivalenceBasisStrict = Schema.decodeUnknownEither(
  EquivalenceBasis,
  STRICT_DECODE_OPTIONS
);

/** Both CR-001 wire forms the lookup accepts. */
export type ExactDeploymentQuery = CollectionDeploymentInput | CollectionDeploymentRef;

const EXPECTED_QUERY_SHAPE =
  "CR-001 chain-qualified deployment reference — either CollectionDeploymentInput " +
  '({ schema_version: 1, network: { schema_version: 1, network_namespace: "eip155" | "solana", ' +
  "network_reference }, address }) or a full CollectionDeploymentRef (input fields plus BOTH " +
  "normalized_address AND a deployment_id that matches the protocol-recomputed canonical digest); " +
  "hybrid/partial reference fields, address-only, and numeric-chain-only forms are rejected";

const EXPECTED_DIGEST_INTEGRITY =
  "a CollectionDeploymentRef whose deployment_id equals the protocol-recomputed canonical digest " +
  "for (network_namespace, network_reference, normalized_address) — the supplied digest does not; " +
  "refusing to treat an unverified digest as deployment identity";

/**
 * Decode a caller query through the CR-001 package. Input-form queries are
 * strict-decoded and MINT the canonical `deployment_id`; full-ref queries are
 * strict-decoded and their `deployment_id` is RECOMPUTED and verified. Either
 * way the returned ref's digest is protocol-verified — hybrids fail both
 * decoders.
 *
 * Exported as this module's ONE deployment-reference boundary: CR-108's
 * backfill evidence decoders reuse it verbatim so a digest-forged or hybrid
 * reference is rejected identically everywhere, with one implementation.
 */
export function decodeDeploymentReference(input: unknown): CollectionDeploymentRef {
  const asInput = Effect.runSync(Effect.either(makeCollectionDeploymentRef(input)));
  if (Either.isRight(asInput)) {
    return asInput.right;
  }

  const asFullRef = Effect.runSync(Effect.either(decodeCollectionDeploymentRef(input)));
  if (Either.isRight(asFullRef)) {
    return asFullRef.right;
  }

  const refFailure: { readonly _tag: string } = asFullRef.left;
  throw new ValidationError(
    "deployment_reference",
    input,
    refFailure._tag === "ContractIntegrityError"
      ? EXPECTED_DIGEST_INTEGRITY
      : EXPECTED_QUERY_SHAPE
  );
}

// ── Result contract ──────────────────────────────────────────────────────────

/**
 * Explicit logical-equivalence evidence.
 *
 * `basis` is the exact CR-001 `EquivalenceBasis` value (strict-decoded through
 * the protocol package at index build). `deployments` is the full deployment
 * set the basis governs — verified `CollectionDeploymentRef`s sorted by
 * `deployment_id` per CR-001's canonical set rule (a single-deployment row
 * carries its one ref). `assertion_ref` is the human-readable curated source
 * reference and is present exactly when `basis.kind === "registry"` (omitted
 * otherwise, never null) — the cryptographic binding lives in
 * `basis.assertion_digest`, not here. Similarity-based grouping does not
 * exist in this contract at all.
 */
export interface EquivalenceEvidence {
  readonly basis: EquivalenceBasis;
  readonly deployments: readonly CollectionDeploymentRef[];
  /** `inventory-registry:<collection_key>` — present iff `basis.kind === "registry"`. */
  readonly assertion_ref?: string;
}

export interface ExactEnrichmentHit {
  readonly contract_version: typeof EXACT_ENRICHMENT_CONTRACT_VERSION;
  readonly found: true;
  /**
   * The queried deployment as a verified CR-001 `CollectionDeploymentRef` in
   * registry display form — EVM address in EIP-55 checksum with lowercase
   * `normalized_address`, Solana verbatim base58 — with the package-minted
   * `deployment_id`.
   */
  readonly deployment: CollectionDeploymentRef;
  readonly collection: {
    /** Belt-gateway collection_key (sonar join key). */
    readonly collection_key: string;
    /** Curated display name. */
    readonly name: string;
    readonly symbol: string;
    readonly aliases: readonly string[];
    readonly total_supply: number;
    /** Registry serving posture — identity truth is returned either way. */
    readonly enabled: boolean;
    /**
     * Full metadata-resolution strategy (discriminated union, not just the
     * kind) — proxy pointers (`tokenuri`, `sonar-image`) stay mechanically
     * distinct from mirror hosting (`sovereign`, `sovereign-world`).
     */
    readonly metadata_strategy: MetadataStrategy;
    /** EFFECTIVE rights policy — concrete ("proxy" when the row omits it). */
    readonly rehost_policy: RehostPolicy;
    /**
     * Resolved-image host allowlist seam. OMITTED when the row publishes
     * none — never an explicit null (same wire rule as `CollectionSummary`).
     */
    readonly image_host?: readonly string[];
  };
  readonly equivalence: EquivalenceEvidence;
}

/** Explicit empty result — unknown exact deployment. Never an alias guess. */
export interface ExactEnrichmentMiss {
  readonly contract_version: typeof EXACT_ENRICHMENT_CONTRACT_VERSION;
  readonly found: false;
}

export type ExactEnrichmentResult = ExactEnrichmentHit | ExactEnrichmentMiss;

// ── Exact deployment index (module load, fail-closed) ───────────────────────

/** CR-001's canonical sort key for a versioned digest (contracts.ts digestKey). */
function digestKeyOf(digest: VersionedDigest): string {
  return `${digest.domain}:${digest.major_version}:${digest.digest}`;
}

function compareDigestKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function rowLoadError(entry: CollectionRegistryEntry, detail: string): Error {
  return new Error(
    `collection registry row "${entry.id}" (${entry.collectionKey}) ${detail}`
  );
}

/**
 * Derive the CR-001 `CollectionDeploymentInput`s a registry row asserts.
 * Fail-closed: a row whose deployment identity cannot be derived exactly
 * (missing contracts/mint, non-safe/non-positive EVM chainId, or an SVM
 * cluster id outside the mapped legacy convention) breaks the module load
 * rather than silently becoming unreachable-or-guessed identity.
 */
function entryDeploymentInputs(
  entry: CollectionRegistryEntry
): readonly CollectionDeploymentInput[] {
  if (entry.chain === "evm") {
    // Safe-integer gate BEFORE decimal derivation: String() of an unsafe
    // integer (e.g. 9007199254740993) yields a silently-wrong but
    // pattern-valid decimal that the protocol cannot catch.
    if (!Number.isSafeInteger(entry.chainId) || entry.chainId <= 0) {
      throw rowLoadError(
        entry,
        `has no canonical eip155 network reference: chainId ${entry.chainId} is not a ` +
          `positive safe integer.`
      );
    }
    const contracts = entry.evmContracts ?? [];
    if (contracts.length === 0) {
      throw rowLoadError(
        entry,
        `is chain "evm" but registers no evmContracts — it has no exact deployment identity.`
      );
    }
    const reference = String(entry.chainId);
    // Checksum display form at mint time; the digest binds the lowercase
    // comparison form either way, so casing at rest cannot change identity.
    return contracts.map((address) => ({
      schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
      network: {
        schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
        network_namespace: "eip155" as const,
        network_reference: reference,
      },
      address: toChecksumAddress(address),
    }));
  }

  if (!entry.svmCollectionMint) {
    throw rowLoadError(
      entry,
      `is chain "svm" but registers no svmCollectionMint — it has no exact deployment identity.`
    );
  }
  if (entry.chainId !== SOLANA_LEGACY_MAINNET_CHAIN_ID) {
    throw rowLoadError(
      entry,
      `is chain "svm" with chainId ${entry.chainId}, which maps to no known Solana cluster ` +
        `(legacy ${SOLANA_LEGACY_MAINNET_CHAIN_ID} = mainnet). Refusing to guess a network ` +
        `reference; add an explicit cluster mapping before registering non-mainnet SVM rows.`
    );
  }
  return [
    {
      schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
      network: {
        schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
        network_namespace: "solana" as const,
        network_reference: SOLANA_MAINNET_NETWORK_REFERENCE,
      },
      address: entry.svmCollectionMint,
    },
  ];
}

/**
 * Validate one registry-asserted deployment through the CR-001 package and
 * mint its verified ref. This is where the protocol's own semantics run
 * against registry rows: EVM address pattern, canonical EIP-155 decimal
 * reference, strict 32-byte base58 Solana public key.
 */
function mintRegistryDeploymentRef(
  entry: CollectionRegistryEntry,
  input: CollectionDeploymentInput
): CollectionDeploymentRef {
  const minted = Effect.runSync(Effect.either(makeCollectionDeploymentRef(input)));
  if (Either.isLeft(minted)) {
    throw rowLoadError(
      entry,
      `fails CR-001 deployment validation for ${input.network.network_namespace}:` +
        `${input.network.network_reference}:${input.address} — ${String(minted.left)}`
    );
  }
  return minted.right;
}

/**
 * Mint the deterministic registry-equivalence assertion digest. The material
 * binds the curated assertion source (CR-001 provenance vocabulary +
 * `inventory-registry:<collection_key>` reference) to the exact sorted
 * deployment set via each deployment's verified `deployment_id` (which itself
 * binds namespace, network reference, and normalized address). Same registry
 * assertion ⇒ same digest, on every load, on every machine.
 */
function mintRegistryAssertionDigest(
  entry: CollectionRegistryEntry,
  assertionRef: string,
  deployments: readonly CollectionDeploymentRef[]
): VersionedDigest {
  const digest = Effect.runSync(
    Effect.either(
      digestVersioned(
        REGISTRY_EQUIVALENCE_ASSERTION_DOMAIN,
        REGISTRY_EQUIVALENCE_ASSERTION_VERSION,
        {
          source: "inventory_registry",
          source_reference: assertionRef,
          deployment_ids: deployments.map((deployment) => deployment.deployment_id),
        }
      )
    )
  );
  if (Either.isLeft(digest)) {
    throw rowLoadError(
      entry,
      `cannot mint a registry equivalence assertion digest — ${String(digest.left)}`
    );
  }
  return digest.right;
}

/**
 * Derive and CR-001-validate every deployment a registry row asserts, minting
 * verified refs. This IS the module-load validation path
 * (`buildExactDeploymentIndex` runs it per row). Exported — same doctrine as
 * `assertRehostPolicyInvariant` — so tests can prove the fail-closed refusals
 * directly against hand-built rows without corrupting the real registry.
 */
export function registryDeploymentRefsOf(
  entry: CollectionRegistryEntry
): readonly CollectionDeploymentRef[] {
  return entryDeploymentInputs(entry).map((input) =>
    mintRegistryDeploymentRef(entry, input)
  );
}

interface RowIdentity {
  readonly basis: EquivalenceBasis;
  /** Verified refs, sorted by deployment_id per CR-001's canonical set rule. */
  readonly deployments: readonly CollectionDeploymentRef[];
  readonly assertionRef: string | undefined;
  /** The full package-assembled identity (CR-108 consumes its collection_id). */
  readonly identity: CollectionIdentity;
}

/**
 * Build a row's equivalence evidence as exact CR-001 values, then prove it:
 * the basis must strict-decode through the package's `EquivalenceBasis`
 * schema, and the (deployments, basis) pair must pass the package's own
 * `makeCollectionIdentity` assembly (re-verifies every deployment digest,
 * the sorted-set rule, and the single/multi invariant). The lookup index
 * still serves only basis + deployments; the assembled identity (with its
 * minted `collection_id`) is surfaced through `mintRegistryRowIdentity` —
 * logical-identity authority is CR-108's backfill deliverable.
 */
function buildRowIdentity(
  entry: CollectionRegistryEntry,
  deployments: readonly CollectionDeploymentRef[]
): RowIdentity {
  const sorted = [...deployments].sort((left, right) =>
    compareDigestKeys(digestKeyOf(left.deployment_id), digestKeyOf(right.deployment_id))
  );

  const assertionRef =
    sorted.length > 1 ? `inventory-registry:${entry.collectionKey}` : undefined;

  const candidateBasis: unknown =
    assertionRef === undefined
      ? {
          schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
          kind: "single_deployment",
        }
      : {
          schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
          kind: "registry",
          assertion_digest: mintRegistryAssertionDigest(entry, assertionRef, sorted),
        };

  const basis = decodeEquivalenceBasisStrict(candidateBasis);
  if (Either.isLeft(basis)) {
    throw rowLoadError(
      entry,
      `produced an equivalence basis that does not strict-decode through CR-001 — ${String(basis.left)}`
    );
  }

  const identity = Effect.runSync(
    Effect.either(
      makeCollectionIdentity({
        schema_version: COLLECTION_PROTOCOL_SCHEMA_VERSION,
        // The belt-gateway join key rides inside the identity so a backfilled
        // record is self-describing. collection_id is METADATA-INVARIANT by
        // CR-001's canonical rule ("display metadata and aliases are
        // excluded"), so embedding the key cannot move logical identity.
        collection_key: entry.collectionKey,
        deployments: sorted,
        equivalence_basis: basis.right,
      })
    )
  );
  if (Either.isLeft(identity)) {
    throw rowLoadError(
      entry,
      `fails CR-001 identity assembly (deployments + equivalence_basis) — ${String(identity.left)}`
    );
  }

  return { basis: basis.right, deployments: sorted, assertionRef, identity: identity.right };
}

/** A registry row's full CR-001 identity, as `mintRegistryRowIdentity` mints it. */
export interface RegistryRowIdentity {
  /**
   * The package-assembled `CollectionIdentity`: verified deployments (sorted
   * per the canonical set rule), the row's exact equivalence basis, the
   * embedded `collection_key`, and the protocol-minted `collection_id`.
   */
  readonly identity: CollectionIdentity;
  /** `inventory-registry:<collection_key>` — present iff the basis is `registry`. */
  readonly assertion_ref?: string;
}

/**
 * Mint one registry row's full CR-001 `CollectionIdentity` — the same
 * derivation the CR-105 index validates at module load, with the
 * `collection_id` KEPT instead of discarded. This is CR-108's curated-source
 * seam: the identity backfill proposes exactly these identities, so the
 * pre-authority new-key view is parity-with-the-lookup by construction.
 * Fail-closed like the index build: a row that cannot mint verified identity
 * throws rather than returning a guess.
 */
export function mintRegistryRowIdentity(
  entry: CollectionRegistryEntry
): RegistryRowIdentity {
  const row = buildRowIdentity(entry, registryDeploymentRefsOf(entry));
  return {
    identity: row.identity,
    ...(row.assertionRef !== undefined ? { assertion_ref: row.assertionRef } : {}),
  };
}

// ── Immutable lookup boundary ────────────────────────────────────────────────
//
// The index is module-level state shared by every caller. Two layers keep it
// incorruptible by anything a caller does to a returned result:
//  1. Internal state is DEEP-FROZEN at build — even a leaked template
//     reference cannot be mutated (strict mode throws on write).
//  2. Every hit is served as a fresh `structuredClone` of its frozen template
//     (structuredClone never carries frozenness over) — callers receive plain
//     mutable data that shares nothing with the index, the registry, or any
//     other caller's result. structuredClone, not JSON: it preserves the
//     omit-not-null key-presence semantics (`image_host`, `assertion_ref`)
//     and clones whatever fields future CR-001 values carry, with no
//     hand-projection to drift.

// Fail-closed at load: the response boundary depends on structuredClone
// (native in Bun and Node >= 17). Refuse to serve identity without it.
if (typeof structuredClone !== "function") {
  throw new Error(
    "exact-enrichment requires structuredClone (Bun / Node >= 17) for its immutable response boundary"
  );
}

/**
 * Recursively freeze a pure-data value (plain objects/arrays of primitives —
 * exactly what the index holds). Freeze-then-recurse; already-frozen nodes
 * are skipped, which is sound here because this module is the only freezer
 * of these values and always freezes a subtree completely (shared nodes —
 * the row's collection snapshot, the sorted deployment set — are simply
 * visited once).
 */
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

/**
 * Load-time snapshot of the registry-row fields a hit exposes. The snapshot
 * OWNS its data: registry-owned objects (aliases, metadata strategy, image
 * hosts) are cloned, so freezing the template never freezes live
 * `collection-registry.ts` state and no result path can reach it.
 */
function snapshotCollection(
  entry: CollectionRegistryEntry
): ExactEnrichmentHit["collection"] {
  return {
    collection_key: entry.collectionKey,
    name: entry.name,
    symbol: entry.symbol,
    aliases: structuredClone(entry.aliases),
    total_supply: entry.totalSupply,
    enabled: entry.enabled,
    metadata_strategy: structuredClone(entry.metadataStrategy),
    rehost_policy: effectiveRehostPolicy(entry),
    // Omit-not-null, same wire rule as CollectionSummary.imageHost.
    ...(entry.imageHost && entry.imageHost.length > 0
      ? { image_host: structuredClone(entry.imageHost) }
      : {}),
  };
}

function buildExactDeploymentIndex(
  entries: readonly CollectionRegistryEntry[]
): Map<string, ExactEnrichmentHit> {
  const index = new Map<string, ExactEnrichmentHit>();
  for (const entry of entries) {
    const refs = registryDeploymentRefsOf(entry);
    const identity = buildRowIdentity(entry, refs);
    // One snapshot per row, shared by its deployments inside the frozen
    // layer — invisible to callers, who only ever receive clones.
    const collection = snapshotCollection(entry);
    for (const ref of refs) {
      const key = ref.deployment_id.digest;
      if (index.has(key)) {
        throw new Error(
          `collection registry asserts deployment ${ref.network.network_namespace}:` +
            `${ref.network.network_reference}:${ref.normalized_address} in two rows — ` +
            `exact lookup would be ambiguous. Fix the registry before serving identity from it.`
        );
      }
      const hit: ExactEnrichmentHit = {
        contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION,
        found: true,
        deployment: ref,
        collection,
        equivalence: {
          basis: identity.basis,
          deployments: identity.deployments,
          ...(identity.assertionRef !== undefined
            ? { assertion_ref: identity.assertionRef }
            : {}),
        },
      };
      index.set(key, deepFreeze(hit));
    }
  }
  return index;
}

const _exactDeployments = buildExactDeploymentIndex(listCollectionRegistry());

// ── Lookup ───────────────────────────────────────────────────────────────────

/**
 * Exact deployment lookup (`inventory.exact-enrichment.v1`).
 *
 * @param input — a CR-001 deployment reference (`unknown`): either the strict
 *   `CollectionDeploymentInput` shape or a full `CollectionDeploymentRef`
 *   whose digest the protocol package recomputes and verifies. Malformed,
 *   hybrid, or digest-mismatched input throws `ValidationError`; a verified
 *   but unregistered deployment returns the explicit `{ found: false }` miss.
 * @returns a value the caller OWNS — a fresh deep copy per call (see the
 *   immutable-boundary section). Mutating a result never affects the index,
 *   the registry, or any other lookup's result.
 */
export function lookupExactDeployment(input: unknown): ExactEnrichmentResult {
  const query = decodeDeploymentReference(input);
  const hit = _exactDeployments.get(query.deployment_id.digest);

  if (!hit) {
    return { contract_version: EXACT_ENRICHMENT_CONTRACT_VERSION, found: false };
  }

  return structuredClone(hit);
}
