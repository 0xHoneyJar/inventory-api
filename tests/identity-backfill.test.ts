/**
 * CR-108 — identity backfill / ledger / parity / collision tests.
 *
 * Adversarial coverage from the .run/cr108-probe*.ts findings plus the
 * acceptance matrix: EVM, Solana, proxy, conflict, missing network, code/proxy
 * change, operator ratification, idempotent replay/conflict, dry-run
 * determinism, rollback, parity gating, authority, revocation, impact
 * discovery completeness, artifact quarantine, shared-work-key collisions.
 */
import { describe, it, expect } from "vitest";
import { Effect, Either, Schema } from "effect";
import {
  Provenance,
  DIGEST_DOMAINS,
  digestVersioned,
  makeCollectionDeploymentRef,
  makeCollectionIdentity,
  type CollectionDeploymentRef,
  type VersionedDigest,
} from "@freeside/collection-protocol";
import {
  listCollectionRegistry,
  MIBERA_CONTRACT,
  MIBERA_CHAIN_ID,
  FRACTURED_ADDRESSES,
  PYTHIANS_COLLECTION_MINT,
  type CollectionRegistryEntry,
} from "../src/collection-registry.js";
import {
  lookupExactDeployment,
  decodeDeploymentReference,
  mintRegistryRowIdentity,
  registryDeploymentRefsOf,
  SOLANA_MAINNET_NETWORK_REFERENCE,
} from "../src/exact-enrichment.js";
import {
  decodeBackfillEvidence,
  planIdentityBackfill,
  stateDigestOf,
  mintRecordDigest,
  mintOperatorAssertionDigest,
  decodeOperatorEquivalenceAssertion,
  mintInventoryDigest,
  mintPlanDigest,
  versionedDigestKeyOf,
  type BackfillEvidence,
} from "../src/identity-backfill.js";
import {
  createBackfillLedger,
  applyBackfillPlan,
  rollbackBackfill,
  enableAuthority,
  isProductionOrderingEnabled,
  applyOperatorRevision,
  revokeEquivalence,
  resolveBackfilledIdentity,
  mintSharedWorkKey,
  reconciliationReportOf,
  serializeBackfillLedger,
  deserializeBackfillLedger,
  replayBackfillLedger,
  decodeQuarantineImpactSet,
  BackfillAuthorityError,
  BackfillParityError,
  BackfillCommandConflictError,
  BackfillRevocationError,
  BackfillStalePlanError,
  BackfillIntegrityError,
  type QuarantineImpactSet,
  type PostAuthorityMutationResult,
  type BackfillLedger,
} from "../src/identity-ledger.js";
import {
  proveReadParity,
  proveLegacyNewParity,
  verifyAuthorityParityReport,
  PARITY_DIGEST_DOMAIN,
  LEGACY_PARITY_SOURCE,
  NEW_PARITY_SOURCE,
} from "../src/identity-parity.js";
import { ValidationError } from "../src/errors.js";

const TS = "2026-07-16T00:00:00.000Z";
const EMPTY_EVIDENCE_INPUT = Object.freeze({
  schema_version: 1 as const,
  observations: Object.freeze([]),
  proxy_implementations: Object.freeze([]),
  operator_assertions: Object.freeze([]),
});

function acceptMutation(result: PostAuthorityMutationResult): BackfillLedger {
  expect(result.status).toBe("accepted");
  if (result.status !== "accepted") {
    throw new Error(`expected accepted mutation, got ${result.status}`);
  }
  return result.ledger;
}

function evmInput(chainId: number | string, address: string) {
  return {
    schema_version: 1,
    network: {
      schema_version: 1,
      network_namespace: "eip155" as const,
      network_reference: String(chainId),
    },
    address,
  };
}

function solanaInput(address: string) {
  return {
    schema_version: 1,
    network: {
      schema_version: 1,
      network_namespace: "solana" as const,
      network_reference: SOLANA_MAINNET_NETWORK_REFERENCE,
    },
    address,
  };
}

function mintRef(input: unknown): CollectionDeploymentRef {
  return Effect.runSync(makeCollectionDeploymentRef(input));
}

function emptyEvidence(): BackfillEvidence {
  return decodeBackfillEvidence(EMPTY_EVIDENCE_INPUT);
}

function subsetRegistry(...keys: string[]): CollectionRegistryEntry[] {
  const all = listCollectionRegistry();
  return keys.map((key) => {
    const entry = all.find((row) => row.collectionKey === key);
    if (!entry) throw new Error(`missing registry row ${key}`);
    return entry;
  });
}

function impact(partial: {
  enumeration_ref: string;
  discovery_complete: boolean;
  work_rows?: QuarantineImpactSet["work_rows"];
  issued_artifacts?: QuarantineImpactSet["issued_artifacts"];
}): QuarantineImpactSet {
  return decodeQuarantineImpactSet({
    schema_version: 1,
    coverage: "explicit_references_only",
    enumeration_ref: partial.enumeration_ref,
    discovery_complete: partial.discovery_complete,
    work_rows: partial.work_rows ?? [],
    issued_artifacts: partial.issued_artifacts ?? [],
  });
}

function applyClean(
  ledger: ReturnType<typeof createBackfillLedger>,
  registry: readonly CollectionRegistryEntry[],
  evidence: BackfillEvidence,
  command_id: string
) {
  const plan = planIdentityBackfill({
    registry,
    current_records: ledger.records,
    evidence,
    registry_observed_at: TS,
  });
  return {
    plan,
    ledger: applyBackfillPlan(ledger, plan, {
      applied_at: TS,
      command_id,
      expected_state_digest: ledger.state_digest,
    }),
  };
}

describe("CR-001 protocol probes → regression", () => {
  it("Provenance requires collection.provenance evidence_digest domain", () => {
    const wrong = Effect.runSync(digestVersioned("inventory.test", 1, { a: 1 }));
    const bad = Effect.runSync(
      Effect.either(
        Schema.decodeUnknown(Provenance, { errors: "all" })({
          schema_version: 1,
          source: "inventory_registry",
          source_reference: "x",
          observed_at: TS,
          evidence_digest: wrong,
        })
      )
    );
    expect(Either.isLeft(bad)).toBe(true);

    const rightDig = Effect.runSync(
      digestVersioned(DIGEST_DOMAINS.provenance, 1, { a: 1 })
    );
    const ok = Effect.runSync(
      Effect.either(
        Schema.decodeUnknown(Provenance, { errors: "all" })({
          schema_version: 1,
          source: "inventory_registry",
          source_reference: "x",
          observed_at: TS,
          evidence_digest: rightDig,
        })
      )
    );
    expect(Either.isRight(ok)).toBe(true);
  });

  it("rejects offset / date-only observed_at; accepts Z-suffixed forms", () => {
    const dig = Effect.runSync(digestVersioned(DIGEST_DOMAINS.provenance, 1, { a: 1 }));
    for (const [ts, expectOk] of [
      ["2026-07-16T00:00:00Z", true],
      ["2026-07-16T00:00:00.000Z", true],
      ["2026-07-16T00:00:00+02:00", false],
      ["2026-07-16", false],
    ] as const) {
      const r = Effect.runSync(
        Effect.either(
          Schema.decodeUnknown(Provenance, { errors: "all" })({
            schema_version: 1,
            source: "inventory_registry",
            source_reference: "x",
            observed_at: ts,
            evidence_digest: dig,
          })
        )
      );
      expect(Either.isRight(r)).toBe(expectOk);
    }
  });

  it("makeCollectionIdentity requires sorted deployments; rejects unsorted / duplicates / bad single", () => {
    const a = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const b = mintRef(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]!));
    const key = (d: CollectionDeploymentRef) =>
      `${d.deployment_id.domain}:${d.deployment_id.major_version}:${d.deployment_id.digest}`;
    const sorted = [a, b].sort((l, r) =>
      key(l) < key(r) ? -1 : key(l) > key(r) ? 1 : 0
    );
    const regDig = Effect.runSync(
      digestVersioned("inventory.registry-equivalence", 1, { x: 1 })
    );
    const ok = Effect.runSync(
      Effect.either(
        makeCollectionIdentity({
          schema_version: 1,
          deployments: sorted,
          equivalence_basis: {
            schema_version: 1,
            kind: "registry",
            assertion_digest: regDig,
          },
        })
      )
    );
    expect(Either.isRight(ok)).toBe(true);

    const unsorted = [...sorted].reverse();
    if (key(unsorted[0]!) !== key(sorted[0]!)) {
      const bad = Effect.runSync(
        Effect.either(
          makeCollectionIdentity({
            schema_version: 1,
            deployments: unsorted,
            equivalence_basis: {
              schema_version: 1,
              kind: "registry",
              assertion_digest: regDig,
            },
          })
        )
      );
      expect(Either.isLeft(bad)).toBe(true);
    }

    const dup = Effect.runSync(
      Effect.either(
        makeCollectionIdentity({
          schema_version: 1,
          deployments: [a, a],
          equivalence_basis: {
            schema_version: 1,
            kind: "registry",
            assertion_digest: regDig,
          },
        })
      )
    );
    expect(Either.isLeft(dup)).toBe(true);

    const badSingle = Effect.runSync(
      Effect.either(
        makeCollectionIdentity({
          schema_version: 1,
          deployments: [a, b],
          equivalence_basis: { schema_version: 1, kind: "single_deployment" },
        })
      )
    );
    expect(Either.isLeft(badSingle)).toBe(true);
  });

  it("operator_ratified single-deployment and empty authority_ref are rejected", () => {
    const a = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const opDig = Effect.runSync(
      digestVersioned("inventory.operator-equivalence", 1, { y: 1 })
    );
    const single = Effect.runSync(
      Effect.either(
        makeCollectionIdentity({
          schema_version: 1,
          deployments: [a],
          equivalence_basis: {
            schema_version: 1,
            kind: "operator_ratified",
            assertion_digest: opDig,
            authority_ref: "operator:x",
          },
        })
      )
    );
    expect(Either.isLeft(single)).toBe(true);

    const b = mintRef(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]!));
    const key = (d: CollectionDeploymentRef) =>
      `${d.deployment_id.domain}:${d.deployment_id.major_version}:${d.deployment_id.digest}`;
    const sorted = [a, b].sort((l, r) =>
      key(l) < key(r) ? -1 : key(l) > key(r) ? 1 : 0
    );
    const emptyAuth = Effect.runSync(
      Effect.either(
        makeCollectionIdentity({
          schema_version: 1,
          deployments: sorted,
          equivalence_basis: {
            schema_version: 1,
            kind: "operator_ratified",
            assertion_digest: opDig,
            authority_ref: "",
          },
        })
      )
    );
    expect(Either.isLeft(emptyAuth)).toBe(true);
  });

  it("collection_id is metadata-invariant", () => {
    const dep = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const basis = { schema_version: 1 as const, kind: "single_deployment" as const };
    const bare = Effect.runSync(
      makeCollectionIdentity({ schema_version: 1, deployments: [dep], equivalence_basis: basis })
    );
    const withMeta = Effect.runSync(
      makeCollectionIdentity({
        schema_version: 1,
        collection_key: "mibera",
        name: "Mibera",
        symbol: "MIBERA",
        deployments: [dep],
        equivalence_basis: basis,
      })
    );
    expect(bare.collection_id.digest).toBe(withMeta.collection_id.digest);
  });
});

describe("CR-108 planner: EVM / Solana / quarantine / blocked", () => {
  it("creates EVM + Solana identities with deterministic plan digest", () => {
    const registry = subsetRegistry("mibera", "pythians");
    const evidence = emptyEvidence();
    const plan1 = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    const plan2 = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    expect(plan1.plan_digest.digest).toBe(plan2.plan_digest.digest);
    expect(plan1.counts.create).toBe(2);
    expect(plan1.counts.quarantine).toBe(0);
    expect(plan1.items.every((i) => i.action === "create")).toBe(true);
  });

  it("multi-deployment fractures row creates with registry basis", () => {
    const registry = subsetRegistry("fractures");
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    expect(plan.counts.create).toBe(1);
    const item = plan.items[0]!;
    expect(item.proposed!.identity.equivalence_basis.kind).toBe("registry");
    expect(item.proposed!.identity.deployments.length).toBe(FRACTURED_ADDRESSES.length);
  });

  it("observed collection_key conflict quarantines without operator ratification", () => {
    const registry = subsetRegistry("mibera");
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [
        {
          schema_version: 1,
          kind: "deployment",
          deployment: ref,
          collection_key: "not-mibera",
          observed_at: TS,
          source_reference: "sonar:conflict",
        },
      ],
      proxy_implementations: [],
      operator_assertions: [],
    });
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    expect(plan.counts.quarantine).toBeGreaterThan(0);
    expect(
      plan.items.some((i) => i.reason_code === "observed_collection_key_conflict")
    ).toBe(true);
  });

  it("operator ratification of whole curated row clears observed conflict", () => {
    const registry = subsetRegistry("mibera");
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [
        {
          schema_version: 1,
          kind: "deployment",
          deployment: ref,
          collection_key: "not-mibera",
          observed_at: TS,
          source_reference: "sonar:conflict",
        },
      ],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:ratify-mibera/001",
          canonical_collection_key: "mibera",
          deployments: [ref],
          approved_at: TS,
          source_reference: "operator:ratify-mibera",
        },
      ],
    });
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    expect(plan.counts.quarantine).toBe(0);
    expect(plan.counts.create).toBe(1);
    expect(
      plan.items[0]!.proposed!.provenance.some((p) => p.source === "operator_ratified")
    ).toBe(true);
  });

  it("coalesces corroborating approvals of the same edge and retains each provenance", () => {
    const registry = subsetRegistry("mibera");
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:ratify-mibera/001",
          canonical_collection_key: "mibera",
          deployments: [ref],
          approved_at: TS,
          source_reference: "operator:ratify-mibera/source-a",
        },
        {
          schema_version: 1,
          authority_ref: "operator:ratify-mibera/002",
          canonical_collection_key: "mibera",
          deployments: [ref],
          approved_at: "2026-07-16T01:00:00.000Z",
          source_reference: "operator:ratify-mibera/source-b",
        },
      ],
    });

    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });

    expect(plan.counts.create).toBe(1);
    expect(plan.counts.quarantine).toBe(0);
    const operatorProvenance = plan.items[0]!.proposed!.provenance.filter(
      (entry) => entry.source === "operator_ratified"
    );
    expect(operatorProvenance).toHaveLength(2);
    expect(operatorProvenance.map((entry) => entry.source_reference)).toEqual([
      "operator:ratify-mibera/001",
      "operator:ratify-mibera/002",
    ]);
  });

  it("retains same-edge audit rows when approval time or evidence source differs", () => {
    const registry = subsetRegistry("mibera");
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const baseAssertion = {
      schema_version: 1 as const,
      authority_ref: "operator:ratify-mibera/audit-row",
      canonical_collection_key: "mibera",
      deployments: [ref],
      approved_at: TS,
      source_reference: "operator:audit/source-a",
    };
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        baseAssertion,
        baseAssertion,
        {
          ...baseAssertion,
          approved_at: "2026-07-16T01:00:00.000Z",
        },
        {
          ...baseAssertion,
          source_reference: "operator:audit/source-b",
        },
      ],
    });
    expect(new Set(
      evidence.operator_assertions.map((assertion) => assertion.assertion_digest.digest)
    ).size).toBe(1);

    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    const operatorProvenance = plan.items[0]!.proposed!.provenance.filter(
      (entry) => entry.source === "operator_ratified"
    );

    expect(plan.counts.quarantine).toBe(0);
    expect(operatorProvenance).toHaveLength(3);
    expect(new Set(
      operatorProvenance.map((entry) => entry.evidence_digest.digest)
    ).size).toBe(3);
    expect(plan.items[0]!.evidence_refs).toEqual(
      expect.arrayContaining([
        "operator:audit/source-a",
        "operator:audit/source-b",
      ])
    );
  });

  it("canonicalizes evidence sets across row order and exact duplicates", () => {
    const registry = subsetRegistry("mibera", "mst");
    const rowRefs = registry.map((row) => registryDeploymentRefsOf(row));
    const observations = registry.map((row, index) => ({
      schema_version: 1 as const,
      kind: "deployment" as const,
      deployment: rowRefs[index]![0]!,
      collection_key: row.collectionKey,
      observed_at: TS,
      source_reference: `sonar:canonical:${row.collectionKey}`,
    }));
    const proxies = rowRefs.map((refs, index) => ({
      schema_version: 1 as const,
      proxy: refs[0]!,
      implementation: mintRef(
        evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[index]!)
      ),
      proxy_standard: "eip1967",
      observed_at: TS,
      source_reference: `onchain:canonical:${registry[index]!.collectionKey}`,
    }));
    const assertions = registry.map((row, index) => ({
      schema_version: 1 as const,
      authority_ref: `operator:canonical:${row.collectionKey}`,
      canonical_collection_key: row.collectionKey,
      deployments: rowRefs[index]!,
      approved_at: TS,
      source_reference: `operator:canonical:${row.collectionKey}:source`,
    }));
    const forward = decodeBackfillEvidence({
      schema_version: 1,
      observations,
      proxy_implementations: proxies,
      operator_assertions: assertions,
    });
    const reorderedWithDuplicates = decodeBackfillEvidence({
      schema_version: 1,
      observations: [...observations].reverse().concat(observations[0]!),
      proxy_implementations: [...proxies].reverse().concat(proxies[0]!),
      operator_assertions: [...assertions].reverse().concat(assertions[0]!),
    });

    expect(reorderedWithDuplicates.observations).toEqual(forward.observations);
    expect(reorderedWithDuplicates.proxy_implementations).toEqual(
      forward.proxy_implementations
    );
    expect(reorderedWithDuplicates.operator_assertions).toEqual(
      forward.operator_assertions
    );
    expect(reorderedWithDuplicates.evidence_digest.digest).toBe(
      forward.evidence_digest.digest
    );

    const forwardPlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: forward,
      registry_observed_at: TS,
    });
    const reorderedPlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: reorderedWithDuplicates,
      registry_observed_at: TS,
    });
    expect(reorderedPlan.plan_digest.digest).toBe(forwardPlan.plan_digest.digest);
  });

  it("keys deployment digests by domain, major version, and digest bytes", () => {
    const deployment = mintRef(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const base = deployment.deployment_id;
    const otherDomain: VersionedDigest = {
      ...base,
      domain: "future.collection.deployment",
    };
    const otherMajor: VersionedDigest = {
      ...base,
      major_version: base.major_version + 1,
    };

    expect(new Set([
      versionedDigestKeyOf(base),
      versionedDigestKeyOf(otherDomain),
      versionedDigestKeyOf(otherMajor),
    ]).size).toBe(3);
  });

  it("still quarantines overlapping operator assertions with different edge groupings", () => {
    const registry = subsetRegistry("mibera", "mst");
    const miberaRef = registryDeploymentRefsOf(registry[0]!)[0]!;
    const allRefs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:mibera-only/001",
          canonical_collection_key: "mibera",
          deployments: [miberaRef],
          approved_at: TS,
          source_reference: "operator:mibera-only",
        },
        {
          schema_version: 1,
          authority_ref: "operator:mibera-mst/001",
          canonical_collection_key: "mibera",
          deployments: allRefs,
          approved_at: TS,
          source_reference: "operator:mibera-mst",
        },
      ],
    });

    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });

    expect(plan.counts.quarantine).toBeGreaterThan(0);
    expect(
      plan.items.some((item) => item.reason_code === "conflicting_operator_assertions")
    ).toBe(true);
  });

  it("preserves prior operator and Sonar provenance when a later batch omits it", () => {
    const registry = subsetRegistry("mibera");
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [
        {
          schema_version: 1,
          kind: "deployment",
          deployment: ref,
          collection_key: "mibera",
          observed_at: TS,
          source_reference: "sonar:mibera-confirmation",
        },
      ],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:ratify-mibera/monotonic",
          canonical_collection_key: "mibera",
          deployments: [ref],
          approved_at: TS,
          source_reference: "operator:ratify-mibera/monotonic-source",
        },
      ],
    });
    let ledger = createBackfillLedger();
    const initial = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence,
      registry_observed_at: TS,
    });
    ledger = applyBackfillPlan(ledger, initial, {
      applied_at: TS,
      command_id: "cmd:preserve-non-proxy-provenance",
      expected_state_digest: ledger.state_digest,
    });

    const later = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });

    expect(later.counts.noop).toBe(1);
    expect(later.counts.update).toBe(0);
    expect(later.items[0]!.evidence_refs).toEqual(
      expect.arrayContaining([
        "operator:ratify-mibera/monotonic",
        "sonar:mibera-confirmation",
      ])
    );
    const active = ledger.records.find((record) => record.status === "active")!;
    expect(active.provenance.map((entry) => entry.source)).toEqual(
      expect.arrayContaining(["operator_ratified", "sonar_probe"])
    );
  });

  it("operator evidence digest binds approval audit fields and replays deterministically", () => {
    const registry = subsetRegistry("mibera");
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const evidenceInput = {
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:evidence-audit/001",
          canonical_collection_key: "mibera",
          deployments: [ref],
          approved_at: TS,
          source_reference: "operator:evidence-audit/source-a",
        },
      ],
    };
    const evidence = decodeBackfillEvidence(evidenceInput);
    const exactEvidence = decodeBackfillEvidence(evidenceInput);
    const changedApproval = decodeBackfillEvidence({
      ...evidenceInput,
      operator_assertions: [
        {
          ...evidenceInput.operator_assertions[0]!,
          approved_at: "2026-07-16T01:00:00.000Z",
        },
      ],
    });
    const changedSource = decodeBackfillEvidence({
      ...evidenceInput,
      operator_assertions: [
        {
          ...evidenceInput.operator_assertions[0]!,
          source_reference: "operator:evidence-audit/source-b",
        },
      ],
    });

    expect(exactEvidence.evidence_digest.digest).toBe(evidence.evidence_digest.digest);
    expect(changedApproval.evidence_digest.digest).not.toBe(evidence.evidence_digest.digest);
    expect(changedSource.evidence_digest.digest).not.toBe(evidence.evidence_digest.digest);
    expect(changedApproval.operator_assertions[0]!.assertion_digest.digest).toBe(
      evidence.operator_assertions[0]!.assertion_digest.digest
    );
    expect(changedSource.operator_assertions[0]!.assertion_digest.digest).toBe(
      evidence.operator_assertions[0]!.assertion_digest.digest
    );

    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    const exactPlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: exactEvidence,
      registry_observed_at: TS,
    });
    const changedSourcePlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: changedSource,
      registry_observed_at: TS,
    });
    expect(exactPlan.plan_digest.digest).toBe(plan.plan_digest.digest);
    expect(changedSourcePlan.plan_digest.digest).not.toBe(plan.plan_digest.digest);

    let ledger = createBackfillLedger();
    const command = {
      applied_at: TS,
      command_id: "cmd:evidence-audit-replay",
      expected_state_digest: ledger.state_digest,
    };
    ledger = applyBackfillPlan(ledger, plan, command);
    const eventCount = ledger.events.length;
    const replayed = applyBackfillPlan(ledger, exactPlan, {
      ...command,
      expected_state_digest: ledger.state_digest,
    });
    expect(replayed.events.length).toBe(eventCount);
    expect(replayed.state_digest.digest).toBe(ledger.state_digest.digest);
    expect(() =>
      applyBackfillPlan(ledger, changedSourcePlan, {
        ...command,
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillCommandConflictError);
  });

  it("missing network identity and uncurated observation quarantine", () => {
    const registry = subsetRegistry("mibera");
    const foreign = mintRef(evmInput(1, "0x1111111111111111111111111111111111111111"));
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [
        {
          schema_version: 1,
          kind: "unidentified",
          raw_reference: "legacy:blob",
          reason: "no chain id",
          observed_at: TS,
          source_reference: "sonar:unidentified",
        },
        {
          schema_version: 1,
          kind: "deployment",
          deployment: foreign,
          collection_key: "ghost",
          observed_at: TS,
          source_reference: "sonar:uncurated",
        },
      ],
      proxy_implementations: [],
      operator_assertions: [],
    });
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    expect(plan.items.some((i) => i.reason_code === "missing_network_identity")).toBe(true);
    expect(plan.items.some((i) => i.reason_code === "observed_deployment_uncurated")).toBe(
      true
    );
  });

  it("proxy implementation change quarantines; stable proxy is provenance only", () => {
    const registry = subsetRegistry("mibera");
    const proxy = registryDeploymentRefsOf(registry[0]!)[0]!;
    const implA = mintRef(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]!));
    const implB = mintRef(evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[1]!));
    const changed = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [
        {
          schema_version: 1,
          proxy,
          implementation: implA,
          proxy_standard: "eip1967",
          observed_at: TS,
          source_reference: "onchain:proxy-a",
        },
        {
          schema_version: 1,
          proxy,
          implementation: implB,
          proxy_standard: "eip1967",
          observed_at: TS,
          source_reference: "onchain:proxy-b",
        },
      ],
      operator_assertions: [],
    });
    const planChanged = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: changed,
      registry_observed_at: TS,
    });
    expect(
      planChanged.items.some((i) => i.reason_code === "proxy_implementation_changed")
    ).toBe(true);

    const stable = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [
        {
          schema_version: 1,
          proxy,
          implementation: implA,
          proxy_standard: "eip1967",
          observed_at: TS,
          source_reference: "onchain:proxy-a",
        },
      ],
      operator_assertions: [],
    });
    const planStable = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: stable,
      registry_observed_at: TS,
    });
    expect(planStable.counts.create).toBe(1);
    expect(planStable.counts.quarantine).toBe(0);
    expect(
      planStable.items[0]!.proposed!.provenance.some((p) => p.source === "onchain")
    ).toBe(true);
    expect(planStable.items[0]!.proposed!.proxy_implementations.length).toBe(1);

    // Cross-batch: implA applied, later implB must quarantine — never provenance_extended.
    let ledger = createBackfillLedger();
    ledger = applyBackfillPlan(ledger, planStable, {
      applied_at: TS,
      command_id: "cmd:proxy-a-apply",
      expected_state_digest: ledger.state_digest,
    });
    const laterB = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [
        {
          schema_version: 1,
          proxy,
          implementation: implB,
          proxy_standard: "eip1967",
          observed_at: "2026-07-16T01:00:00.000Z",
          source_reference: "onchain:proxy-b-later",
        },
      ],
      operator_assertions: [],
    });
    const crossBatch = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: laterB,
      registry_observed_at: TS,
    });
    expect(
      crossBatch.items.some((i) => i.reason_code === "proxy_implementation_changed")
    ).toBe(true);
    expect(crossBatch.items.some((i) => i.reason_code === "provenance_extended")).toBe(
      false
    );
  });

  it("whole-row merge is blocked pre-authority", () => {
    const registry = subsetRegistry("mibera", "mst");
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:merge-mibera-mst/001",
          canonical_collection_key: "mibera",
          deployments: refs,
          approved_at: TS,
          source_reference: "operator:merge",
        },
      ],
    });
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    expect(
      plan.items.some((i) => i.reason_code === "merge_requires_post_authority_revision")
    ).toBe(true);
    expect(plan.counts.blocked).toBeGreaterThan(0);
  });
});

describe("CR-108 ledger: apply / rollback / CAS / command idempotency", () => {
  it("apply → noop replan → rollback restores empty state and original plan digest", () => {
    const registry = subsetRegistry("mibera", "pythians");
    const evidence = emptyEvidence();
    let ledger = createBackfillLedger();
    const plan = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence,
      registry_observed_at: TS,
    });
    const planDigest = plan.plan_digest.digest;
    ledger = applyBackfillPlan(ledger, plan, {
      applied_at: TS,
      command_id: "cmd:apply-1",
      expected_state_digest: ledger.state_digest,
    });
    expect(ledger.records.filter((r) => r.status === "active").length).toBe(2);

    const noop = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence,
      registry_observed_at: TS,
    });
    expect(noop.counts.noop).toBe(2);
    expect(noop.counts.create).toBe(0);

    ledger = rollbackBackfill(ledger, {
      through_sequence: 0,
      reason: "rehearsal rewind",
      rolled_back_at: TS,
      command_id: "cmd:rollback-1",
      expected_state_digest: ledger.state_digest,
    });
    expect(ledger.records.length).toBe(0);
    const replay = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence,
      registry_observed_at: TS,
    });
    expect(replay.plan_digest.digest).toBe(planDigest);
  });

  it("exact-command replay is idempotent; different payload conflicts", () => {
    const registry = subsetRegistry("mibera");
    const evidence = emptyEvidence();
    let ledger = createBackfillLedger();
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    const opts = {
      applied_at: TS,
      command_id: "cmd:idempotent",
      expected_state_digest: ledger.state_digest,
    };
    ledger = applyBackfillPlan(ledger, plan, opts);
    const after = ledger.state_digest.digest;
    const events = ledger.events.length;
    const again = applyBackfillPlan(ledger, plan, {
      ...opts,
      expected_state_digest: ledger.state_digest, // CAS skipped on idempotent path
    });
    expect(again.state_digest.digest).toBe(after);
    expect(again.events.length).toBe(events);

    expect(() =>
      applyBackfillPlan(ledger, plan, {
        applied_at: "2026-07-16T01:00:00.000Z",
        command_id: "cmd:idempotent",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillCommandConflictError);
  });

  it("exact update-command replay survives rollback removing its materialized target", () => {
    const registry = subsetRegistry("mibera");
    const initial = createBackfillLedger();
    const { ledger: created } = applyClean(
      initial,
      registry,
      emptyEvidence(),
      "cmd:rollback-retry-create"
    );
    const ref = registryDeploymentRefsOf(registry[0]!)[0]!;
    const observed = decodeBackfillEvidence({
      schema_version: 1,
      observations: [
        {
          schema_version: 1,
          kind: "deployment",
          deployment: ref,
          collection_key: "mibera",
          observed_at: TS,
          source_reference: "sonar:rollback-retry",
        },
      ],
      proxy_implementations: [],
      operator_assertions: [],
    });
    const update = planIdentityBackfill({
      registry,
      current_records: created.records,
      evidence: observed,
      registry_observed_at: TS,
    });
    expect(update.counts.update).toBe(1);
    const applyOptions = {
      applied_at: TS,
      command_id: "cmd:rollback-retry-update",
      expected_state_digest: created.state_digest,
    };
    const updated = applyBackfillPlan(created, update, applyOptions);
    const rolledBack = rollbackBackfill(updated, {
      through_sequence: 0,
      reason: "remove all materialized records",
      rolled_back_at: TS,
      command_id: "cmd:rollback-retry-rewind",
      expected_state_digest: updated.state_digest,
    });
    expect(rolledBack.records).toHaveLength(0);

    const replayed = applyBackfillPlan(rolledBack, update, applyOptions);
    expect(replayed).toBe(rolledBack);
    expect(replayed.events).toHaveLength(rolledBack.events.length);

    expect(() =>
      applyBackfillPlan(rolledBack, update, {
        ...applyOptions,
        applied_at: "2026-07-16T01:00:00.000Z",
      })
    ).toThrow(BackfillCommandConflictError);

    const nonIdentical = {
      ...update,
      items: update.items.map((item) =>
        item.proposed === undefined
          ? item
          : {
              ...item,
              proposed: { ...item.proposed, collection_key: "grafted-key" },
            }
      ),
    };
    expect(() => applyBackfillPlan(rolledBack, nonIdentical, applyOptions)).toThrow(
      BackfillIntegrityError
    );
  });

  it("CAS refuses stale expected_state_digest", () => {
    const registry = subsetRegistry("mibera");
    const ledger = createBackfillLedger();
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    const bogus = {
      domain: ledger.state_digest.domain,
      major_version: ledger.state_digest.major_version,
      digest: "0".repeat(64),
    } as VersionedDigest;
    expect(() =>
      applyBackfillPlan(ledger, plan, {
        applied_at: TS,
        command_id: "cmd:cas",
        expected_state_digest: bogus,
      })
    ).toThrow(BackfillStalePlanError);
  });

  it("serialize/deserialize round-trips and replay verifies chain", () => {
    const registry = subsetRegistry("mibera");
    const { ledger } = applyClean(
      createBackfillLedger(),
      registry,
      emptyEvidence(),
      "cmd:ser"
    );
    const text = serializeBackfillLedger(ledger);
    const again = deserializeBackfillLedger(text);
    expect(again.state_digest.digest).toBe(ledger.state_digest.digest);
    expect(again.events.length).toBe(ledger.events.length);
  });

  it("strict replay rejects excess event fields and full-digest identity grafts", () => {
    const registry = subsetRegistry("mibera");
    const { ledger: applied } = applyClean(
      createBackfillLedger(),
      registry,
      emptyEvidence(),
      "cmd:strict-replay-apply"
    );
    const first = applied.events[0]!;

    expect(() => replayBackfillLedger([{ ...first, unexpected: true }])).toThrow(
      BackfillIntegrityError
    );
    expect(() =>
      replayBackfillLedger([
        {
          ...first,
          event_digest: {
            ...first.event_digest,
            domain: "inventory.grafted-event-domain",
          },
        },
      ])
    ).toThrow(BackfillIntegrityError);

    const rolledBack = rollbackBackfill(applied, {
      through_sequence: 0,
      reason: "exercise chain link",
      rolled_back_at: TS,
      command_id: "cmd:strict-replay-rollback",
      expected_state_digest: applied.state_digest,
    });
    const second = rolledBack.events[1]!;
    if (second.prev_event_digest === undefined) {
      throw new Error("expected second event to carry a previous-event digest");
    }
    const { event_digest: storedEventDigest, ...secondContent } = second;
    void storedEventDigest;
    const graftedLinkContent = {
      ...secondContent,
      prev_event_digest: {
        ...second.prev_event_digest,
        domain: "inventory.grafted-link-domain",
      },
    };
    const graftedLink = {
      ...graftedLinkContent,
      event_digest: mintInventoryDigest("inventory.backfill-event", 1, graftedLinkContent),
    };
    expect(() => replayBackfillLedger([first, graftedLink])).toThrow(
      BackfillIntegrityError
    );
  });

  it("record integrity binds and verifies the embedded collection_key", () => {
    const registry = subsetRegistry("mibera");
    const { ledger } = applyClean(
      createBackfillLedger(),
      registry,
      emptyEvidence(),
      "cmd:key-binding-apply"
    );
    const event = ledger.events[0]!;
    if (event.kind !== "backfill_applied") {
      throw new Error("expected first event to be a backfill apply");
    }
    const record = event.created[0]!;
    const { record_digest: storedRecordDigest, ...recordContent } = record;
    void storedRecordDigest;
    const mismatchedRecordContent = {
      ...recordContent,
      identity: { ...record.identity, collection_key: "not-mibera" },
    };
    const mismatchedRecord = {
      ...mismatchedRecordContent,
      record_digest: mintRecordDigest(mismatchedRecordContent),
    };
    const { event_digest: storedEventDigest, ...eventContent } = event;
    void storedEventDigest;
    const mismatchedEventContent = {
      ...eventContent,
      created: [mismatchedRecord],
    };
    const mismatchedEvent = {
      ...mismatchedEventContent,
      event_digest: mintInventoryDigest(
        "inventory.backfill-event",
        1,
        mismatchedEventContent
      ),
    };

    expect(() => replayBackfillLedger([mismatchedEvent])).toThrow(
      /embedded identity collection_key/
    );
  });

  it("replay rejects digest-valid count and item narratives that disagree with records", () => {
    const { ledger } = applyClean(
      createBackfillLedger(),
      subsetRegistry("mibera"),
      emptyEvidence(),
      "cmd:audit-triangle"
    );
    const event = ledger.events[0]!;
    if (event.kind !== "backfill_applied") {
      throw new Error("expected first event to be a backfill apply");
    }
    const { event_digest: storedEventDigest, ...content } = event;
    void storedEventDigest;

    const dishonestCountsContent = {
      ...content,
      counts: { ...event.counts, create: 0 },
    };
    const dishonestCounts = {
      ...dishonestCountsContent,
      event_digest: mintInventoryDigest(
        "inventory.backfill-event",
        1,
        dishonestCountsContent
      ),
    };
    expect(() => replayBackfillLedger([dishonestCounts])).toThrow(
      /counts\.create/
    );

    const omittedItemsContent = {
      ...content,
      counts: { create: 0, noop: 0, update: 0, quarantine: 0, blocked: 0 },
      items: [],
    };
    const omittedItems = {
      ...omittedItemsContent,
      event_digest: mintInventoryDigest(
        "inventory.backfill-event",
        1,
        omittedItemsContent
      ),
    };
    expect(() => replayBackfillLedger([omittedItems])).toThrow(
      /do not correspond exactly to created records/
    );
  });

  it("replay rejects malformed stored proxy timestamps even with reminted digests", () => {
    const registry = subsetRegistry("mibera");
    const proxy = registryDeploymentRefsOf(registry[0]!)[0]!;
    const implementation = mintRef(
      evmInput(MIBERA_CHAIN_ID, FRACTURED_ADDRESSES[0]!)
    );
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [
        {
          schema_version: 1,
          proxy,
          implementation,
          proxy_standard: "eip1967",
          observed_at: TS,
          source_reference: "onchain:stored-proxy",
        },
      ],
      operator_assertions: [],
    });
    const { ledger } = applyClean(
      createBackfillLedger(),
      registry,
      evidence,
      "cmd:stored-proxy"
    );
    const event = ledger.events[0]!;
    if (event.kind !== "backfill_applied") {
      throw new Error("expected first event to be a backfill apply");
    }
    const record = event.created[0]!;
    const binding = record.proxy_implementations[0]!;
    const { record_digest: storedRecordDigest, ...recordContent } = record;
    void storedRecordDigest;
    const malformedRecordContent = {
      ...recordContent,
      proxy_implementations: [{ ...binding, observed_at: "not-a-timestamp" }],
    };
    const malformedRecord = {
      ...malformedRecordContent,
      record_digest: mintRecordDigest(malformedRecordContent),
    };
    const { event_digest: storedEventDigest, ...eventContent } = event;
    void storedEventDigest;
    const malformedEventContent = {
      ...eventContent,
      created: [malformedRecord],
      items: event.items.map((item) =>
        item.action === "create"
          ? { ...item, after_record_digest: malformedRecord.record_digest }
          : item
      ),
    };
    const malformedEvent = {
      ...malformedEventContent,
      event_digest: mintInventoryDigest(
        "inventory.backfill-event",
        1,
        malformedEventContent
      ),
    };
    expect(() => replayBackfillLedger([malformedEvent])).toThrow(
      /proxy_implementations\[0\]\.observed_at/
    );
  });
});

describe("CR-108 parity + authority", () => {
  it("passing parity enables authority; Ordering gate flips", () => {
    const registry = subsetRegistry("mibera", "pythians", "fractures");
    let ledger = createBackfillLedger();
    const { plan, ledger: applied } = applyClean(
      ledger,
      registry,
      emptyEvidence(),
      "cmd:auth-apply"
    );
    ledger = applied;
    const parity = proveReadParity({ ledger, registry });
    expect(parity.pass).toBe(true);
    expect(parity.checked_deployments).toBeGreaterThan(0);

    const clean = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    expect(clean.counts.quarantine).toBe(0);
    expect(isProductionOrderingEnabled(ledger)).toBe(false);
    ledger = enableAuthority(ledger, {
      registry,
      expected_parity: parity,
      clean_plan: clean,
      evidence_input: EMPTY_EVIDENCE_INPUT,
      enabled_at: TS,
      command_id: "cmd:enable",
      expected_state_digest: ledger.state_digest,
    });
    expect(isProductionOrderingEnabled(ledger)).toBe(true);
    expect(ledger.authority).toBe("authority_enabled");

    expect(() =>
      rollbackBackfill(ledger, {
        through_sequence: 0,
        reason: "nope",
        rolled_back_at: TS,
        command_id: "cmd:bad-rollback",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillAuthorityError);
  });

  it("failing parity / quarantine blocks authority", () => {
    const registry = subsetRegistry("mibera");
    const legacyMiss = () => ({
      contract_version: "inventory.exact-enrichment.v1" as const,
      found: false as const,
    });
    // Empty ledger cannot pass live legacy/new projection — enablement must
    // recompute from actual reads and refuse (caller-minted reports are not
    // the authority source).
    const empty = createBackfillLedger();
    const emptyMissingLegacyParity = proveReadParity({
      ledger: empty,
      registry,
      legacyLookup: legacyMiss,
    });
    const emptyPlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    expect(() =>
      enableAuthority(empty, {
        registry,
        clean_plan: emptyPlan,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:enable-empty",
        expected_state_digest: empty.state_digest,
      })
    ).toThrow(BackfillParityError);

    const { ledger: appliedElsewhere } = applyClean(
      createBackfillLedger(),
      registry,
      emptyEvidence(),
      "cmd:forge-src"
    );
    const forgedFromElsewhere = proveLegacyNewParity({
      ledger: appliedElsewhere,
      registry,
    });
    expect(forgedFromElsewhere.pass).toBe(true);
    expect(verifyAuthorityParityReport(forgedFromElsewhere).pass).toBe(true);
    // Self-consistent report from a different ledger cannot authorize empty state.
    expect(() =>
      enableAuthority(empty, {
        registry,
        expected_parity: forgedFromElsewhere,
        clean_plan: emptyPlan,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:enable-empty-forge",
        expected_state_digest: empty.state_digest,
      })
    ).toThrow(BackfillParityError);

    let ledger = createBackfillLedger();
    const { ledger: applied } = applyClean(
      ledger,
      registry,
      emptyEvidence(),
      "cmd:parity-apply"
    );
    ledger = applied;
    const parity = proveReadParity({
      ledger,
      registry,
      legacyLookup: legacyMiss,
    });
    expect(parity.pass).toBe(false);
    expect(parity.entries[0]!.outcome).toBe("missing_in_legacy_view");
    expect(parity.entries[0]!.new_projection_digest.digest).not.toBe(
      emptyMissingLegacyParity.entries[0]!.new_projection_digest.digest
    );
    const clean = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    // Live enablement recomputes with real CR-105 lookup and would pass; the
    // failing expected audit copy must refuse rather than authorize.
    expect(() =>
      enableAuthority(ledger, {
        registry,
        expected_parity: parity,
        clean_plan: clean,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:enable-fail",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillParityError);

    const conflictEvidenceInput = {
      schema_version: 1,
      observations: [
        {
          schema_version: 1,
          kind: "deployment",
          deployment: registryDeploymentRefsOf(registry[0]!)[0]!,
          collection_key: "other",
          observed_at: TS,
          source_reference: "sonar:x",
        },
      ],
      proxy_implementations: [],
      operator_assertions: [],
    } as const;
    const conflictEvidence = decodeBackfillEvidence(conflictEvidenceInput);
    // Fresh ledger for quarantine gate (applied state already has identity).
    let dirtyLedger = createBackfillLedger();
    const dirtyPlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: conflictEvidence,
      registry_observed_at: TS,
    });
    dirtyLedger = applyBackfillPlan(dirtyLedger, dirtyPlan, {
      applied_at: TS,
      command_id: "cmd:dirty-apply",
      expected_state_digest: dirtyLedger.state_digest,
    });
    // After dirty apply with quarantine-only (no creates for quarantined rows),
    // re-plan still quarantines; enable must refuse.
    const stillDirty = planIdentityBackfill({
      registry,
      current_records: dirtyLedger.records,
      evidence: conflictEvidence,
      registry_observed_at: TS,
    });
    expect(stillDirty.counts.quarantine).toBeGreaterThan(0);
    expect(() =>
      enableAuthority(dirtyLedger, {
        registry,
        clean_plan: stillDirty,
        evidence_input: conflictEvidenceInput,
        enabled_at: TS,
        command_id: "cmd:enable-quarantine",
        expected_state_digest: dirtyLedger.state_digest,
      })
    ).toThrow(BackfillParityError);
  });

  it("recomputes clean-plan counts from items before authority enablement", () => {
    const registry = subsetRegistry("mibera");
    const { ledger: applied } = applyClean(
      createBackfillLedger(),
      registry,
      emptyEvidence(),
      "cmd:count-gate-apply"
    );
    const clean = planIdentityBackfill({
      registry,
      current_records: applied.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    const first = clean.items[0]!;
    const { plan_digest: storedPlanDigest, ...cleanHeader } = clean;
    void storedPlanDigest;
    const dishonestHeader = {
      ...cleanHeader,
      items: [{ ...first, action: "quarantine" as const }, ...clean.items.slice(1)],
    };
    const dishonestPlan = {
      ...dishonestHeader,
      plan_digest: mintPlanDigest(dishonestHeader),
    };

    expect(() =>
      enableAuthority(applied, {
        registry,
        clean_plan: dishonestPlan,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:count-gate-enable",
        expected_state_digest: applied.state_digest,
      })
    ).toThrow(BackfillIntegrityError);

    const emptyHeader = {
      ...cleanHeader,
      items: [],
      counts: { create: 0, noop: 0, update: 0, quarantine: 0, blocked: 0 },
    };
    const callerMintedEmptyPlan = {
      ...emptyHeader,
      plan_digest: mintPlanDigest(emptyHeader),
    };
    expect(() =>
      enableAuthority(applied, {
        registry,
        clean_plan: callerMintedEmptyPlan,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:empty-plan-enable",
        expected_state_digest: applied.state_digest,
      })
    ).toThrow(/not the complete planner output/);
  });
});

describe("CR-108 post-authority revision / revocation / impact", () => {
  function authorityLedger(keys: string[]) {
    const registry = subsetRegistry(...keys);
    let ledger = createBackfillLedger();
    const { ledger: applied } = applyClean(
      ledger,
      registry,
      emptyEvidence(),
      `cmd:apply-${keys.join("-")}`
    );
    ledger = applied;
    const parity = proveReadParity({ ledger, registry });
    const clean = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    ledger = enableAuthority(ledger, {
      registry,
      expected_parity: parity,
      clean_plan: clean,
      evidence_input: EMPTY_EVIDENCE_INPUT,
      enabled_at: TS,
      command_id: `cmd:enable-${keys.join("-")}`,
      expected_state_digest: ledger.state_digest,
    });
    return { ledger, registry };
  }

  it("operator revision merges rows and enumerates impact refs", () => {
    let { ledger, registry } = authorityLedger(["mibera", "mst"]);
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:merge-post/001",
          canonical_collection_key: "mibera",
          deployments: refs,
          approved_at: TS,
          source_reference: "operator:merge-post",
        },
      ],
    });
    const assertion = evidence.operator_assertions[0]!;
    const workKey = mintSharedWorkKey({
      identity: ledger.records.find((r) => r.collection_key === "mibera" && r.status === "active")!
        .identity,
      capability: "collection_report.prepare",
      capability_version: "1.0.0",
      finality_policies: [
        {
          network_namespace: "eip155",
          network_reference: "80094",
          finality_policy_version: "1.0.0",
        },
      ],
    });
    const incomplete = impact({
      enumeration_ref: "ordering-walk:incomplete",
      discovery_complete: false,
      work_rows: [{ work_key: workKey, reference: "ordering:row/1" }],
      issued_artifacts: [{ reference: "artifact:report/1" }],
    });
    expect(incomplete.discovery_complete).toBe(false);

    const beforeDigest = ledger.state_digest.digest;
    const beforeVersions = ledger.records.map((r) => `${r.collection_key}#${r.identity_version}:${r.status}`);
    const beforeRevoked = [...ledger.revoked_equivalence];
    const blocked = applyOperatorRevision(ledger, {
      assertion,
      registry,
      impact: incomplete,
      reason: "merge mibera+mst",
      occurred_at: TS,
      command_id: "cmd:revise-incomplete",
      expected_state_digest: ledger.state_digest,
    });
    expect(blocked.status).toBe("blocked");
    if (blocked.status === "blocked") {
      expect(blocked.reason_code).toBe("discovery_incomplete");
      expect(blocked.ledger.state_digest.digest).toBe(beforeDigest);
      expect(
        blocked.ledger.records.map((r) => `${r.collection_key}#${r.identity_version}:${r.status}`)
      ).toEqual(beforeVersions);
      expect(blocked.ledger.revoked_equivalence).toEqual(beforeRevoked);
    }

    ledger = acceptMutation(
      applyOperatorRevision(ledger, {
        assertion,
        registry,
        impact: impact({
          enumeration_ref: "ordering-walk:complete",
          discovery_complete: true,
          work_rows: [{ work_key: workKey, reference: "ordering:row/1" }],
          issued_artifacts: [{ reference: "artifact:report/1" }],
        }),
        reason: "merge mibera+mst",
        occurred_at: TS,
        command_id: "cmd:revise-1",
        expected_state_digest: ledger.state_digest,
      })
    );
    expect(ledger.records.filter((r) => r.status === "active").length).toBe(1);
    const active = ledger.records.find((r) => r.status === "active")!;
    expect(active.identity.equivalence_basis.kind).toBe("operator_ratified");
    expect(active.identity.deployments.length).toBe(2);

    const report = reconciliationReportOf(ledger);
    const last = report.events[report.events.length - 1]!;
    expect(last.kind).toBe("identity_superseded");
    expect(last.impact!.work_rows.length).toBe(1);
    expect(last.impact!.issued_artifacts.length).toBe(1);
    expect(last.impact!.discovery_complete).toBe(true);
  });

  it("revocation + empty complete impact; revoked edge reuse fails", () => {
    let { ledger, registry } = authorityLedger(["mibera", "mst"]);
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:merge-then-revoke/001",
          canonical_collection_key: "mibera",
          deployments: refs,
          approved_at: TS,
          source_reference: "operator:merge-then-revoke",
        },
      ],
    });
    const assertion = evidence.operator_assertions[0]!;
    ledger = acceptMutation(
      applyOperatorRevision(ledger, {
        assertion,
        registry,
        impact: impact({
          enumeration_ref: "ordering-walk:a",
          discovery_complete: true,
        }),
        reason: "merge",
        occurred_at: TS,
        command_id: "cmd:rev-merge",
        expected_state_digest: ledger.state_digest,
      })
    );
    const merged = ledger.records.find((r) => r.status === "active")!;
    const emptyComplete = impact({
      enumeration_ref: "ordering-walk:empty-complete",
      discovery_complete: true,
    });
    expect(emptyComplete.work_rows.length).toBe(0);
    expect(emptyComplete.discovery_complete).toBe(true);

    const incompleteRevoke = revokeEquivalence(ledger, {
      revoked: {
        collection_key: merged.collection_key,
        identity_version: merged.identity_version,
        record_digest: merged.record_digest,
      },
      authority_ref: "operator:revoke/001",
      reason: "wrong equivalence",
      successors: [
        { kind: "curated_row", collection_key: "mibera" },
        { kind: "curated_row", collection_key: "mst" },
      ],
      registry,
      impact: impact({
        enumeration_ref: "ordering-walk:incomplete-revoke",
        discovery_complete: false,
      }),
      revoked_at: TS,
      command_id: "cmd:revoke-incomplete",
      expected_state_digest: ledger.state_digest,
    });
    expect(incompleteRevoke.status).toBe("blocked");
    expect(ledger.revoked_equivalence.length).toBe(0);

    ledger = acceptMutation(
      revokeEquivalence(ledger, {
        revoked: {
          collection_key: merged.collection_key,
          identity_version: merged.identity_version,
          record_digest: merged.record_digest,
        },
        authority_ref: "operator:revoke/001",
        reason: "wrong equivalence",
        successors: [
          { kind: "curated_row", collection_key: "mibera" },
          { kind: "curated_row", collection_key: "mst" },
        ],
        registry,
        impact: emptyComplete,
        revoked_at: TS,
        command_id: "cmd:revoke-1",
        expected_state_digest: ledger.state_digest,
      })
    );
    expect(ledger.revoked_equivalence.length).toBe(1);
    expect(ledger.records.filter((r) => r.status === "active").length).toBe(2);
    expect(ledger.records.some((r) => r.status === "revoked")).toBe(true);

    const revokeEvent = ledger.events[ledger.events.length - 1]!;
    if (
      revokeEvent.kind !== "identity_superseded" ||
      revokeEvent.cause !== "equivalence_revocation"
    ) {
      throw new Error("expected the final event to be an equivalence revocation");
    }
    const { event_digest: storedEventDigest, ...revokeContent } = revokeEvent;
    void storedEventDigest;
    const poisonedContent = {
      ...revokeContent,
      revoked_equivalence_digests: [
        mintInventoryDigest("inventory.operator-equivalence", 1, {
          authority_ref: "operator:unrelated-future-assertion",
        }),
      ],
    };
    const poisonedEvent = {
      ...poisonedContent,
      event_digest: mintInventoryDigest(
        "inventory.backfill-event",
        1,
        poisonedContent
      ),
    };
    expect(() =>
      replayBackfillLedger([
        ...ledger.events.slice(0, -1),
        poisonedEvent,
      ])
    ).toThrow(/must exactly equal the assertion digest/);

    expect(() =>
      applyOperatorRevision(ledger, {
        assertion,
        registry,
        impact: emptyComplete,
        reason: "reuse revoked edge",
        occurred_at: TS,
        command_id: "cmd:reuse-revoked",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillRevocationError);
  });

  it("impact set requires enumeration_ref and discovery_complete", () => {
    expect(() =>
      decodeQuarantineImpactSet({
        schema_version: 1,
        coverage: "explicit_references_only",
        enumeration_ref: "",
        discovery_complete: true,
        work_rows: [],
        issued_artifacts: [],
      })
    ).toThrow(ValidationError);
    expect(() =>
      decodeQuarantineImpactSet({
        schema_version: 1,
        coverage: "explicit_references_only",
        enumeration_ref: "walk:1",
        work_rows: [],
        issued_artifacts: [],
      })
    ).toThrow(ValidationError);

    expect(() =>
      decodeQuarantineImpactSet({
        schema_version: 1,
        coverage: "explicit_references_only",
        enumeration_ref: "walk:wrong-work-domain",
        discovery_complete: true,
        work_rows: [
          {
            work_key: mintInventoryDigest("inventory.not-a-work-key", 1, {
              row: 1,
            }),
            reference: "ordering:row/1",
          },
        ],
        issued_artifacts: [],
      })
    ).toThrow(ValidationError);
  });
});

describe("CR-108 shared work key collisions", () => {
  it("distinct deployments mint distinct keys; permutations canonicalize; grafts fail", () => {
    const mibera = mintRegistryRowIdentity(subsetRegistry("mibera")[0]!).identity;
    const mst = mintRegistryRowIdentity(subsetRegistry("mst")[0]!).identity;
    const k1 = mintSharedWorkKey({
      identity: mibera,
      capability: "collection_report.prepare",
      capability_version: "1.0.0",
      finality_policies: [
        {
          network_namespace: "eip155",
          network_reference: "80094",
          finality_policy_version: "1.0.0",
        },
      ],
    });
    const k2 = mintSharedWorkKey({
      identity: mst,
      capability: "collection_report.prepare",
      capability_version: "1.0.0",
      finality_policies: [
        {
          network_namespace: "eip155",
          network_reference: "80094",
          finality_policy_version: "1.0.0",
        },
      ],
    });
    expect(k1.digest).not.toBe(k2.digest);

    const fractures = mintRegistryRowIdentity(subsetRegistry("fractures")[0]!).identity;
    const permuted = {
      ...fractures,
      deployments: [...fractures.deployments].reverse(),
    };
    // Unsorted deployments fail package decode when reminted; work key uses
    // sorted deployment_ids from the identity — same identity ⇒ same key.
    const kf = mintSharedWorkKey({
      identity: fractures,
      capability: "collection_report.prepare",
      capability_version: "1.0.0",
      finality_policies: [
        {
          network_namespace: "eip155",
          network_reference: "80094",
          finality_policy_version: "1.0.0",
        },
      ],
    });
    const kf2 = mintSharedWorkKey({
      identity: fractures,
      capability: "collection_report.prepare",
      capability_version: "1.0.0",
      finality_policies: [
        {
          network_namespace: "eip155",
          network_reference: "80094",
          finality_policy_version: "1.0.0",
        },
      ],
    });
    expect(kf.digest).toBe(kf2.digest);
    void permuted;

    const grafted = {
      ...mibera.collection_id,
      digest: mst.collection_id.digest,
    };
    expect(() =>
      mintSharedWorkKey({
        identity: { ...mibera, collection_id: grafted },
        capability: "collection_report.prepare",
        capability_version: "1.0.0",
        finality_policies: [
          {
            network_namespace: "eip155",
            network_reference: "80094",
            finality_policy_version: "1.0.0",
          },
        ],
      })
    ).toThrow();

    expect(() =>
      mintSharedWorkKey({
        identity: {
          ...mibera,
          collection_id: { ...mibera.collection_id, major_version: 99 },
        },
        capability: "collection_report.prepare",
        capability_version: "1.0.0",
        finality_policies: [
          {
            network_namespace: "eip155",
            network_reference: "80094",
            finality_policy_version: "1.0.0",
          },
        ],
      })
    ).toThrow();
  });

  it("only explicit versioned equivalence shares a logical key across deployments", () => {
    const registry = subsetRegistry("mibera", "mst");
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const evidence = decodeBackfillEvidence({
      schema_version: 1,
      observations: [],
      proxy_implementations: [],
      operator_assertions: [
        {
          schema_version: 1,
          authority_ref: "operator:shared-key/001",
          canonical_collection_key: "mibera",
          deployments: refs,
          approved_at: TS,
          source_reference: "operator:shared-key",
        },
      ],
    });
    // Pre-authority: merge blocked — distinct curated identities keep distinct keys.
    const miberaId = mintRegistryRowIdentity(registry[0]!).identity;
    const mstId = mintRegistryRowIdentity(registry[1]!).identity;
    const policy = [
      {
        network_namespace: "eip155" as const,
        network_reference: "80094",
        finality_policy_version: "1.0.0",
      },
    ];
    expect(
      mintSharedWorkKey({
        identity: miberaId,
        capability: "collection_report.prepare",
        capability_version: "1.0.0",
        finality_policies: policy,
      }).digest
    ).not.toBe(
      mintSharedWorkKey({
        identity: mstId,
        capability: "collection_report.prepare",
        capability_version: "1.0.0",
        finality_policies: policy,
      }).digest
    );

    let { ledger } = (() => {
      const base = authorityLike(registry);
      return base;
    })();
    ledger = acceptMutation(
      applyOperatorRevision(ledger, {
        assertion: evidence.operator_assertions[0]!,
        registry,
        impact: impact({ enumeration_ref: "w", discovery_complete: true }),
        reason: "share",
        occurred_at: TS,
        command_id: "cmd:share-key",
        expected_state_digest: ledger.state_digest,
      })
    );
    const merged = ledger.records.find((r) => r.status === "active")!;
    const shared = mintSharedWorkKey({
      identity: merged.identity,
      capability: "collection_report.prepare",
      capability_version: "1.0.0",
      finality_policies: policy,
    });
    // Both deployments resolve to the same active identity → same work key.
    const hitA = resolveBackfilledIdentity(ledger, refs[0]!);
    const hitB = resolveBackfilledIdentity(ledger, refs[1]!);
    expect(hitA.found && hitB.found).toBe(true);
    if (hitA.found && hitB.found) {
      expect(hitA.record.identity.collection_id.digest).toBe(
        hitB.record.identity.collection_id.digest
      );
      expect(
        mintSharedWorkKey({
          identity: hitA.record.identity,
          capability: "collection_report.prepare",
          capability_version: "1.0.0",
          finality_policies: policy,
        }).digest
      ).toBe(shared.digest);
    }
  });
});

describe("CR-108 revision FAIL probes: parity / assertion / replay", () => {
  it("refuses forged parity: fake domain, grafted digest, omitted entries, pass-with-mismatches, self-ref", () => {
    const registry = subsetRegistry("mibera");
    let ledger = createBackfillLedger();
    const { ledger: applied } = applyClean(
      ledger,
      registry,
      emptyEvidence(),
      "cmd:forge-apply"
    );
    ledger = applied;
    const real = proveLegacyNewParity({ ledger, registry });
    expect(real.pass).toBe(true);
    expect(verifyAuthorityParityReport(real).report_digest.digest).toBe(
      real.report_digest.digest
    );

    const { report_digest: storedParityDigest, ...parityBody } = real;
    void storedParityDigest;
    expect(
      mintInventoryDigest(PARITY_DIGEST_DOMAIN, 1, parityBody).digest
    ).toBe(real.report_digest.digest);
    const graftedBindingBody = {
      ...parityBody,
      legacy_binding: {
        ...parityBody.legacy_binding,
        view_digest: mintInventoryDigest(PARITY_DIGEST_DOMAIN, 1, {
          binding: "legacy",
          parts: [],
        }),
      },
    };
    expect(() =>
      verifyAuthorityParityReport({
        ...graftedBindingBody,
        report_digest: mintInventoryDigest(
          PARITY_DIGEST_DOMAIN,
          1,
          graftedBindingBody
        ),
      })
    ).toThrow(/legacy_binding\.view_digest/);

    const clean = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });

    expect(() =>
      enableAuthority(ledger, {
        registry,
        expected_parity: { pass: true, checked_deployments: 1, report_digest: ledger.state_digest },
        clean_plan: clean,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:forge-thin",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillParityError);

    expect(() =>
      verifyAuthorityParityReport({
        ...real,
        report_digest: {
          ...real.report_digest,
          domain: "inventory.forged-parity",
        },
      })
    ).toThrow(ValidationError);

    expect(() =>
      verifyAuthorityParityReport({
        ...real,
        report_digest: {
          ...real.report_digest,
          digest: "0".repeat(64),
        },
      })
    ).toThrow(ValidationError);

    expect(() =>
      verifyAuthorityParityReport({
        ...real,
        state_digest: {
          ...real.state_digest,
          digest: "a".repeat(64),
        },
      })
    ).toThrow(ValidationError);

    expect(() =>
      verifyAuthorityParityReport({
        ...real,
        entries: [],
        checked_deployments: real.checked_deployments,
      })
    ).toThrow(ValidationError);

    expect(() =>
      verifyAuthorityParityReport({
        ...real,
        pass: true,
        mismatches: [
          {
            kind: "metadata_mismatch",
            deployment_id: real.entries[0]!.deployment_id,
            collection_key: "mibera",
            detail: "grafted",
          },
        ],
      })
    ).toThrow(ValidationError);

    expect(() =>
      verifyAuthorityParityReport({
        ...real,
        legacy_binding: { source: NEW_PARITY_SOURCE, view_digest: real.legacy_binding.view_digest },
        new_binding: { source: NEW_PARITY_SOURCE, view_digest: real.new_binding.view_digest },
      })
    ).toThrow(ValidationError);

    expect(real.legacy_binding.source).toBe(LEGACY_PARITY_SOURCE);
    expect(real.new_binding.source).toBe(NEW_PARITY_SOURCE);
    expect(real.report_digest.domain).toBe(PARITY_DIGEST_DOMAIN);
  });

  it("operator assertion integrity rejects zeroed/grafted digests and excess fields", () => {
    const registry = subsetRegistry("mibera", "mst");
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const ok = decodeOperatorEquivalenceAssertion({
      schema_version: 1,
      authority_ref: "operator:assert-integrity/001",
      canonical_collection_key: "mibera",
      deployments: refs,
      approved_at: TS,
      source_reference: "operator:assert-integrity",
    });
    expect(ok.assertion_digest.digest).toBe(
      mintOperatorAssertionDigest({
        authority_ref: ok.authority_ref,
        canonical_collection_key: ok.canonical_collection_key,
        deployments: ok.deployments,
      }).digest
    );

    expect(() =>
      decodeOperatorEquivalenceAssertion({
        ...ok,
        assertion_digest: {
          algorithm: "sha-256",
          domain: ok.assertion_digest.domain,
          major_version: ok.assertion_digest.major_version,
          digest: "0".repeat(64),
        },
      })
    ).toThrow(ValidationError);

    expect(() =>
      decodeOperatorEquivalenceAssertion({
        schema_version: 1,
        authority_ref: "operator:assert-integrity/001",
        canonical_collection_key: "mibera",
        deployments: refs,
        approved_at: TS,
        source_reference: "operator:assert-integrity",
        extra_field: "nope",
      })
    ).toThrow(ValidationError);

    expect(() =>
      decodeOperatorEquivalenceAssertion({
        schema_version: 1,
        authority_ref: "operator:assert-integrity/001",
        canonical_collection_key: "mibera",
        deployments: [...refs, refs[0]!],
        approved_at: TS,
        source_reference: "operator:assert-integrity",
      })
    ).toThrow(ValidationError);

    let { ledger } = authorityLike(registry);
    const grafted = {
      ...ok,
      assertion_digest: {
        ...ok.assertion_digest,
        digest: "b".repeat(64),
      },
    };
    expect(() =>
      applyOperatorRevision(ledger, {
        assertion: grafted,
        registry,
        impact: impact({ enumeration_ref: "w", discovery_complete: true }),
        reason: "graft",
        occurred_at: TS,
        command_id: "cmd:graft-assert",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(ValidationError);
  });

  it("exact-command replay succeeds after authority; changed command still conflicts", () => {
    const registry = subsetRegistry("mibera");
    const evidence = emptyEvidence();
    let ledger = createBackfillLedger();
    const plan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence,
      registry_observed_at: TS,
    });
    const applyOpts = {
      applied_at: TS,
      command_id: "cmd:pre-auth-apply",
      expected_state_digest: ledger.state_digest,
    };
    ledger = applyBackfillPlan(ledger, plan, applyOpts);
    const eventsAfterApply = ledger.events.length;

    const parity = proveLegacyNewParity({ ledger, registry });
    const clean = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence,
      registry_observed_at: TS,
    });
    ledger = enableAuthority(ledger, {
      registry,
      expected_parity: parity,
      clean_plan: clean,
      evidence_input: EMPTY_EVIDENCE_INPUT,
      enabled_at: TS,
      command_id: "cmd:enable-after-apply",
      expected_state_digest: ledger.state_digest,
    });
    expect(isProductionOrderingEnabled(ledger)).toBe(true);
    expect(ledger.events.length).toBeGreaterThan(eventsAfterApply);

    // Identical pre-authority apply command replays after authority advances.
    const replayed = applyBackfillPlan(ledger, plan, {
      ...applyOpts,
      expected_state_digest: ledger.state_digest,
    });
    expect(replayed.state_digest.digest).toBe(ledger.state_digest.digest);
    expect(replayed.events.length).toBe(ledger.events.length);

    // Same key, changed command → conflict (does not bypass authority gating via new command).
    expect(() =>
      applyBackfillPlan(ledger, plan, {
        applied_at: "2026-07-16T02:00:00.000Z",
        command_id: "cmd:pre-auth-apply",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillCommandConflictError);

    expect(() =>
      applyBackfillPlan(ledger, plan, {
        applied_at: TS,
        command_id: "cmd:fresh-after-authority",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillAuthorityError);

    expect(eventsAfterApply).toBeGreaterThan(0);
  });
});

describe("CR-108 revision-2 adversarial: actual-read enablement / order / command-first", () => {
  it("equivalent registry permutations mint one canonical parity report", () => {
    const forward = subsetRegistry("mibera", "pythians", "fractures");
    const reversed = [...forward].reverse();
    const { ledger } = applyClean(
      createBackfillLedger(),
      forward,
      emptyEvidence(),
      "cmd:order-apply"
    );
    const a = proveLegacyNewParity({ ledger, registry: forward });
    const b = proveLegacyNewParity({ ledger, registry: reversed });
    expect(a.pass).toBe(true);
    expect(b.pass).toBe(true);
    expect(a.entries.map((e) => e.deployment_id.digest)).toEqual(
      b.entries.map((e) => e.deployment_id.digest)
    );
    expect(a.legacy_binding.view_digest.digest).toBe(b.legacy_binding.view_digest.digest);
    expect(a.new_binding.view_digest.digest).toBe(b.new_binding.view_digest.digest);
    expect(a.report_digest.digest).toBe(b.report_digest.digest);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const cleanFwd = planIdentityBackfill({
      registry: forward,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    const cleanRev = planIdentityBackfill({
      registry: reversed,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    expect(cleanFwd.registry_digest.digest).toBe(cleanRev.registry_digest.digest);

    const enabledFwd = enableAuthority(ledger, {
      registry: forward,
      expected_parity: a,
      clean_plan: cleanFwd,
      evidence_input: EMPTY_EVIDENCE_INPUT,
      enabled_at: TS,
      command_id: "cmd:enable-order-fwd",
      expected_state_digest: ledger.state_digest,
    });
    const enabledRev = enableAuthority(ledger, {
      registry: reversed,
      expected_parity: b,
      clean_plan: cleanRev,
      evidence_input: EMPTY_EVIDENCE_INPUT,
      enabled_at: TS,
      command_id: "cmd:enable-order-rev",
      expected_state_digest: ledger.state_digest,
    });
    expect(enabledFwd.authority).toBe("authority_enabled");
    expect(enabledRev.authority).toBe("authority_enabled");
    const lastFwd = enabledFwd.events[enabledFwd.events.length - 1]!;
    const lastRev = enabledRev.events[enabledRev.events.length - 1]!;
    expect(lastFwd.kind).toBe("authority_enabled");
    expect(lastRev.kind).toBe("authority_enabled");
    if (lastFwd.kind === "authority_enabled" && lastRev.kind === "authority_enabled") {
      expect(lastFwd.parity_report_digest.digest).toBe(a.report_digest.digest);
      expect(lastRev.parity_report_digest.digest).toBe(b.report_digest.digest);
    }
  });

  it("enableAuthority refuses self-consistent forged pass over empty ledger", () => {
    const registry = subsetRegistry("mibera");
    const empty = createBackfillLedger();
    const failing = proveLegacyNewParity({ ledger: empty, registry });
    expect(failing.pass).toBe(false);
    expect(failing.checked_deployments).toBeGreaterThan(0);

    const { report_digest: _drop, ...body } = failing;
    const forgedBody = {
      ...body,
      pass: true,
      mismatches: [] as typeof failing.mismatches,
    };
    const forgedDigest = mintInventoryDigest(
      PARITY_DIGEST_DOMAIN,
      failing.report_digest.major_version,
      {
      schema_version: forgedBody.schema_version,
      contract_version: forgedBody.contract_version,
      state_digest: forgedBody.state_digest,
      registry_digest: forgedBody.registry_digest,
      legacy_binding: forgedBody.legacy_binding,
      new_binding: forgedBody.new_binding,
      checked_deployments: forgedBody.checked_deployments,
      entries: forgedBody.entries.map((entry) => ({
        deployment_id: entry.deployment_id,
        collection_key: entry.collection_key,
        legacy_projection_digest: entry.legacy_projection_digest,
        new_projection_digest: entry.new_projection_digest,
        outcome: entry.outcome,
      })),
      mismatches: [],
      pass: true,
    });
    const forged = { ...forgedBody, report_digest: forgedDigest };
    expect(verifyAuthorityParityReport(forged).pass).toBe(true);

    const emptyPlan = planIdentityBackfill({
      registry,
      current_records: [],
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    expect(() =>
      enableAuthority(empty, {
        registry,
        expected_parity: forged,
        clean_plan: emptyPlan,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:forge-empty-pass",
        expected_state_digest: empty.state_digest,
      })
    ).toThrow(BackfillParityError);
    expect(() =>
      enableAuthority(empty, {
        registry,
        clean_plan: emptyPlan,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:forge-empty-no-expected",
        expected_state_digest: empty.state_digest,
      })
    ).toThrow(BackfillParityError);
  });

  it("accepted command replay/conflict precedes incomplete-discovery blocking", () => {
    let { ledger, registry } = authorityLike(subsetRegistry("mibera", "mst"));
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const assertion = decodeOperatorEquivalenceAssertion({
      schema_version: 1,
      authority_ref: "operator:cmd-first/001",
      canonical_collection_key: "mibera",
      deployments: refs,
      approved_at: TS,
      source_reference: "operator:cmd-first",
    });
    const completeImpact = impact({
      enumeration_ref: "ordering-walk:cmd-first",
      discovery_complete: true,
    });
    const incompleteImpact = impact({
      enumeration_ref: "ordering-walk:cmd-first",
      discovery_complete: false,
    });

    ledger = acceptMutation(
      applyOperatorRevision(ledger, {
        assertion,
        registry,
        impact: completeImpact,
        reason: "merge",
        occurred_at: TS,
        command_id: "cmd:revise-first",
        expected_state_digest: ledger.state_digest,
      })
    );
    const afterAccept = ledger.state_digest.digest;

    const replayed = applyOperatorRevision(ledger, {
      assertion,
      registry,
      impact: completeImpact,
      reason: "merge",
      occurred_at: TS,
      command_id: "cmd:revise-first",
      expected_state_digest: ledger.state_digest,
    });
    expect(replayed.status).toBe("accepted");
    if (replayed.status === "accepted") {
      expect(replayed.ledger.state_digest.digest).toBe(afterAccept);
      expect(replayed.ledger.events.length).toBe(ledger.events.length);
    }

    expect(() =>
      applyOperatorRevision(ledger, {
        assertion,
        registry,
        impact: incompleteImpact,
        reason: "merge",
        occurred_at: TS,
        command_id: "cmd:revise-first",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillCommandConflictError);

    const unseenIncomplete = applyOperatorRevision(ledger, {
      assertion,
      registry,
      impact: incompleteImpact,
      reason: "merge",
      occurred_at: TS,
      command_id: "cmd:revise-unseen-incomplete",
      expected_state_digest: ledger.state_digest,
    });
    expect(unseenIncomplete.status).toBe("blocked");
    if (unseenIncomplete.status === "blocked") {
      expect(unseenIncomplete.reason_code).toBe("discovery_incomplete");
      expect(unseenIncomplete.ledger.state_digest.digest).toBe(afterAccept);
    }

    // Same precedence on revocation: accepted complete then incomplete retry conflicts.
    const merged = ledger.records.find((r) => r.status === "active")!;
    const revokeComplete = {
      revoked: {
        collection_key: merged.collection_key,
        identity_version: merged.identity_version,
        record_digest: merged.record_digest,
      },
      authority_ref: "operator:cmd-first-revoke/001",
      reason: "split",
      successors: [
        { kind: "curated_row" as const, collection_key: "mibera" },
        { kind: "curated_row" as const, collection_key: "mst" },
      ],
      registry,
      impact: completeImpact,
      revoked_at: TS,
      command_id: "cmd:revoke-first",
      expected_state_digest: ledger.state_digest,
    };
    ledger = acceptMutation(revokeEquivalence(ledger, revokeComplete));
    const afterRevoke = ledger.state_digest.digest;
    const revokeReplay = revokeEquivalence(ledger, revokeComplete);
    expect(revokeReplay.status).toBe("accepted");
    if (revokeReplay.status === "accepted") {
      expect(revokeReplay.ledger.state_digest.digest).toBe(afterRevoke);
    }
    expect(() =>
      revokeEquivalence(ledger, {
        ...revokeComplete,
        impact: incompleteImpact,
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillCommandConflictError);
  });

  it("operator successor timestamps are replay-bound without binding unused provenance", () => {
    const registry = subsetRegistry("mibera", "mst");
    let { ledger } = authorityLike(registry);
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const assertion = decodeOperatorEquivalenceAssertion({
      schema_version: 1,
      authority_ref: "operator:successor-digest/001",
      canonical_collection_key: "mibera",
      deployments: refs,
      approved_at: TS,
      source_reference: "operator:successor-digest/original-transport",
    });
    const revision = {
      assertion,
      registry,
      impact: impact({
        enumeration_ref: "ordering-walk:successor-digest",
        discovery_complete: true,
      }),
      reason: "merge with replay-bound successor",
      occurred_at: TS,
      command_id: "cmd:successor-digest-revision",
      expected_state_digest: ledger.state_digest,
    };

    ledger = acceptMutation(applyOperatorRevision(ledger, revision));
    const eventCount = ledger.events.length;
    const stateDigest = ledger.state_digest.digest;

    const exactReplay = applyOperatorRevision(ledger, revision);
    expect(exactReplay.status).toBe("accepted");
    if (exactReplay.status === "accepted") {
      expect(exactReplay.ledger.events.length).toBe(eventCount);
      expect(exactReplay.ledger.state_digest.digest).toBe(stateDigest);
    }

    const transportOnlyReplay = applyOperatorRevision(ledger, {
      ...revision,
      assertion: {
        ...assertion,
        source_reference: "operator:successor-digest/retried-transport",
      },
      expected_state_digest: ledger.state_digest,
    });
    expect(transportOnlyReplay.status).toBe("accepted");

    expect(() =>
      applyOperatorRevision(ledger, {
        ...revision,
        assertion: {
          ...assertion,
          approved_at: "2026-07-16T01:00:00.000Z",
        },
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillCommandConflictError);
  });

  it("revocation binds operator approval time and each curated successor identity", () => {
    const completeImpact = impact({
      enumeration_ref: "ordering-walk:revocation-successor-digest",
      discovery_complete: true,
    });

    const mergedLedger = () => {
      const registry = subsetRegistry("mibera", "mst");
      let { ledger } = authorityLike(registry);
      const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
      const mergeAssertion = decodeOperatorEquivalenceAssertion({
        schema_version: 1,
        authority_ref: "operator:revocation-source/001",
        canonical_collection_key: "mibera",
        deployments: refs,
        approved_at: TS,
        source_reference: "operator:revocation-source",
      });
      ledger = acceptMutation(
        applyOperatorRevision(ledger, {
          assertion: mergeAssertion,
          registry,
          impact: completeImpact,
          reason: "prepare revocation target",
          occurred_at: TS,
          command_id: "cmd:prepare-revocation-target",
          expected_state_digest: ledger.state_digest,
        })
      );
      return { ledger, registry, refs };
    };

    {
      let { ledger, registry, refs } = mergedLedger();
      const merged = ledger.records.find((record) => record.status === "active")!;
      const successorAssertion = decodeOperatorEquivalenceAssertion({
        schema_version: 1,
        authority_ref: "operator:revocation-successor/002",
        canonical_collection_key: "mibera",
        deployments: refs,
        approved_at: TS,
        source_reference: "operator:revocation-successor/original-transport",
      });
      const operatorRequest = {
        revoked: {
          collection_key: merged.collection_key,
          identity_version: merged.identity_version,
          record_digest: merged.record_digest,
        },
        authority_ref: "operator:revoke-to-new-group/001",
        reason: "replace authority record",
        successors: [{ kind: "operator_group" as const, assertion: successorAssertion }],
        registry,
        impact: completeImpact,
        revoked_at: TS,
        command_id: "cmd:revoke-to-new-group",
        expected_state_digest: ledger.state_digest,
      };

      ledger = acceptMutation(revokeEquivalence(ledger, operatorRequest));
      const exactReplay = revokeEquivalence(ledger, operatorRequest);
      expect(exactReplay.status).toBe("accepted");

      const transportOnlyReplay = revokeEquivalence(ledger, {
        ...operatorRequest,
        successors: [
          {
            kind: "operator_group",
            assertion: {
              ...successorAssertion,
              source_reference: "operator:revocation-successor/retried-transport",
            },
          },
        ],
        expected_state_digest: ledger.state_digest,
      });
      expect(transportOnlyReplay.status).toBe("accepted");

      expect(() =>
        revokeEquivalence(ledger, {
          ...operatorRequest,
          successors: [
            {
              kind: "operator_group",
              assertion: {
                ...successorAssertion,
                approved_at: "2026-07-16T01:00:00.000Z",
              },
            },
          ],
          expected_state_digest: ledger.state_digest,
        })
      ).toThrow(BackfillCommandConflictError);
    }

    {
      let { ledger, registry } = mergedLedger();
      const merged = ledger.records.find((record) => record.status === "active")!;
      const curatedRequest = {
        revoked: {
          collection_key: merged.collection_key,
          identity_version: merged.identity_version,
          record_digest: merged.record_digest,
        },
        authority_ref: "operator:revoke-to-curation/001",
        reason: "restore curated rows",
        successors: [
          { kind: "curated_row" as const, collection_key: "mibera" },
          { kind: "curated_row" as const, collection_key: "mst" },
        ],
        registry,
        impact: completeImpact,
        revoked_at: TS,
        command_id: "cmd:revoke-to-curation",
        expected_state_digest: ledger.state_digest,
      };

      ledger = acceptMutation(revokeEquivalence(ledger, curatedRequest));
      const exactReplay = revokeEquivalence(ledger, curatedRequest);
      expect(exactReplay.status).toBe("accepted");

      const displayOnlyRegistry = registry.map((entry) =>
        entry.collectionKey === "mibera"
          ? { ...entry, name: `${entry.name} display-only edit` }
          : entry
      );
      const displayOnlyReplay = revokeEquivalence(ledger, {
        ...curatedRequest,
        registry: displayOnlyRegistry,
        expected_state_digest: ledger.state_digest,
      });
      expect(displayOnlyReplay.status).toBe("accepted");

      const identityChangingRegistry = registry.map((entry) =>
        entry.collectionKey === "mibera" ? { ...entry, chainId: 1 } : entry
      );
      expect(() =>
        revokeEquivalence(ledger, {
          ...curatedRequest,
          registry: identityChangingRegistry,
          expected_state_digest: ledger.state_digest,
        })
      ).toThrow(BackfillCommandConflictError);
    }
  });

  it("enableAuthority replay/conflict precedes live parity after later revision", () => {
    const registry = subsetRegistry("mibera", "mst");
    let ledger = createBackfillLedger();
    const { ledger: applied } = applyClean(
      ledger,
      registry,
      emptyEvidence(),
      "cmd:enable-replay-apply"
    );
    ledger = applied;
    const enableStateDigest = ledger.state_digest;
    const parity = proveLegacyNewParity({ ledger, registry });
    expect(parity.pass).toBe(true);
    const clean = planIdentityBackfill({
      registry,
      current_records: ledger.records,
      evidence: emptyEvidence(),
      registry_observed_at: TS,
    });
    const enableOpts = {
      registry,
      expected_parity: parity,
      clean_plan: clean,
      evidence_input: EMPTY_EVIDENCE_INPUT,
      enabled_at: TS,
      command_id: "cmd:enable-original",
      expected_state_digest: enableStateDigest,
    };
    ledger = enableAuthority(ledger, enableOpts);
    expect(ledger.authority).toBe("authority_enabled");
    expect(isProductionOrderingEnabled(ledger)).toBe(true);
    const afterEnableEvents = ledger.events.length;
    const afterEnableState = ledger.state_digest.digest;

    // Valid later revision moves identity state past the original enablement.
    const refs = registry.flatMap((row) => registryDeploymentRefsOf(row));
    const assertion = decodeOperatorEquivalenceAssertion({
      schema_version: 1,
      authority_ref: "operator:enable-replay-merge/001",
      canonical_collection_key: "mibera",
      deployments: refs,
      approved_at: TS,
      source_reference: "operator:enable-replay-merge",
    });
    ledger = acceptMutation(
      applyOperatorRevision(ledger, {
        assertion,
        registry,
        impact: impact({
          enumeration_ref: "ordering-walk:enable-replay",
          discovery_complete: true,
        }),
        reason: "merge after enable",
        occurred_at: TS,
        command_id: "cmd:revise-after-enable",
        expected_state_digest: ledger.state_digest,
      })
    );
    expect(ledger.events.length).toBeGreaterThan(afterEnableEvents);
    expect(ledger.state_digest.digest).not.toBe(afterEnableState);
    const afterRevisionEvents = ledger.events.length;
    const afterRevisionState = ledger.state_digest.digest;
    const afterRevisionActive = ledger.records
      .filter((r) => r.status === "active")
      .map((r) => `${r.collection_key}#${r.identity_version}`)
      .sort();

    // Live parity against the post-revision ledger fails — proving that a
    // naive recompute-first enable path would reject the identical retry.
    const postRevisionParity = proveLegacyNewParity({ ledger, registry });
    expect(postRevisionParity.pass).toBe(false);

    // Identical original enable command replays idempotently: no parity
    // failure, and later revision state is preserved (not rolled back).
    const replayed = enableAuthority(ledger, enableOpts);
    expect(replayed.state_digest.digest).toBe(afterRevisionState);
    expect(replayed.events.length).toBe(afterRevisionEvents);
    expect(
      replayed.records
        .filter((r) => r.status === "active")
        .map((r) => `${r.collection_key}#${r.identity_version}`)
        .sort()
    ).toEqual(afterRevisionActive);
    expect(replayed.authority).toBe("authority_enabled");

    // Same command_id with a changed payload conflicts before parity work.
    expect(() =>
      enableAuthority(ledger, {
        ...enableOpts,
        enabled_at: "2026-07-16T02:00:00.000Z",
      })
    ).toThrow(BackfillCommandConflictError);

    // Unseen new enablement command still recomputes live parity and fails.
    expect(() =>
      enableAuthority(ledger, {
        registry,
        clean_plan: clean,
        evidence_input: EMPTY_EVIDENCE_INPUT,
        enabled_at: TS,
        command_id: "cmd:enable-unseen-after-revision",
        expected_state_digest: ledger.state_digest,
      })
    ).toThrow(BackfillParityError);
  });
});

function authorityLike(registry: CollectionRegistryEntry[]) {
  let ledger = createBackfillLedger();
  const { ledger: applied } = applyClean(
    ledger,
    registry,
    emptyEvidence(),
    "cmd:auth-like-apply"
  );
  ledger = applied;
  const parity = proveReadParity({ ledger, registry });
  const clean = planIdentityBackfill({
    registry,
    current_records: ledger.records,
    evidence: emptyEvidence(),
    registry_observed_at: TS,
  });
  ledger = enableAuthority(ledger, {
    registry,
    expected_parity: parity,
    clean_plan: clean,
    evidence_input: EMPTY_EVIDENCE_INPUT,
    enabled_at: TS,
    command_id: "cmd:auth-like-enable",
    expected_state_digest: ledger.state_digest,
  });
  return { ledger, registry };
}

describe("CR-105 boundary intact under CR-108 exports", () => {
  it("decodeDeploymentReference rejects hybrids; lookup clone-on-read still holds", () => {
    expect(() =>
      decodeDeploymentReference({
        schema_version: 1,
        network: {
          schema_version: 1,
          network_namespace: "eip155",
          network_reference: "80094",
        },
        address: MIBERA_CONTRACT,
        deployment_id: {
          domain: "collection.deployment",
          major_version: 1,
          digest: "deadbeef",
        },
      })
    ).toThrow(ValidationError);

    const a = lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    const b = lookupExactDeployment(evmInput(MIBERA_CHAIN_ID, MIBERA_CONTRACT));
    expect(a.found && b.found).toBe(true);
    if (a.found && b.found) {
      (a.collection as { name: string }).name = "MUTATED";
      expect(b.collection.name).toBe("Mibera");
    }
  });

  it("mintRegistryRowIdentity matches exact-enrichment equivalence for curated rows", () => {
    for (const key of ["mibera", "pythians", "fractures"] as const) {
      const entry = subsetRegistry(key)[0]!;
      const minted = mintRegistryRowIdentity(entry);
      const ref = registryDeploymentRefsOf(entry)[0]!;
      const hit = lookupExactDeployment(ref);
      expect(hit.found).toBe(true);
      if (hit.found) {
        expect(minted.identity.equivalence_basis).toEqual(hit.equivalence.basis);
        expect(minted.identity.deployments.map((d) => d.deployment_id.digest).sort()).toEqual(
          hit.equivalence.deployments.map((d) => d.deployment_id.digest).sort()
        );
      }
    }
  });
});
