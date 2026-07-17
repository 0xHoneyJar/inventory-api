# CR-108 — Identity backfill runbook

Existing curated collection rows → CR-001 cross-VM identity versions, with an
append-only ledger and an explicit authority cutover. This substrate does
**not** by itself migrate production data, enable Ordering, or release gate
G2B.

## Source precedence

1. **Operator-approved equivalence** — may assert logical equivalence; pre-authority whole-row merges are `blocked` (post-authority revision); partial splits and conflicting edges quarantine.
2. **Curated Inventory** — sole pre-authority grouping; proposed identities are exactly `mintRegistryRowIdentity(row)` (parity with CR-105 by construction).
3. **Observed Sonar identity** — confirms bindings; disagreement quarantines; uncurated observations never invent collections.
4. **Proxy implementation evidence** — provenance only; never creates collection equivalence; implementation change quarantines.

Similarity is unrepresentable — there is no evidence type for it.

## Verbs

| Phase | Verb | Notes |
|-------|------|-------|
| Pre-authority | `planIdentityBackfill` | Pure dry-run; deterministic `plan_digest` / counts |
| Pre-authority | `applyBackfillPlan` | CAS on `expected_state_digest`; exact `command_id` idempotency |
| Pre-authority | `rollbackBackfill` | Append-only rewind; forbidden after cutover |
| Gate | `enableAuthority(ledger, { registry, clean_plan, … })` | Exact-command replay/conflict first; new commands recompute `proveLegacyNewParity` over live ledger+registry (optional `expected_parity` audit copy must match exactly); quarantine ⇒ Ordering stays disabled |
| Post-authority | `applyOperatorRevision` / `revokeEquivalence` | New immutable versions only; incomplete discovery returns typed `blocked` without mutating identity |

## Safe cutover checklist

1. Plan against a **named production registry snapshot** (digest-pinned).
2. Apply; inspect `reconciliationReportOf` (quarantine/blocked lines).
3. Resolve quarantines (curation / operator ratification) until a clean plan.
4. `proveLegacyNewParity` must `pass` against the **live** `lookupExactDeployment` path
   (dry-run / inspection).
5. `enableAuthority` with the clean plan + the **same registry snapshot** — a
   new command re-invokes the parity proof over live reads; an optional
   `expected_parity` audit copy must equal that recomputed report exactly and
   is never the authority source. Identical accepted-command retries return
   the current ledger without recomputing parity (later revisions stay).
6. Only then may downstream Ordering consume new-key authority —
   `isProductionOrderingEnabled(ledger)`.

## Impact sets (CR-012A)

```ts
{
  schema_version: 1,
  coverage: "explicit_references_only",
  enumeration_ref: "ordering-walk:…", // REQUIRED even when empty
  discovery_complete: false | true,
  work_rows: […],          // explicit refs only — never invented here
  issued_artifacts: […],
}
```

Empty lists never mean “proven none.” `discovery_complete: false` means the
named walk did not finish — post-authority revision/revocation returns
`{ status: "blocked", reason_code: "discovery_incomplete" }` and leaves
authoritative identity unchanged. `discovery_complete: true` means that walk
returned the listed refs (possibly none) — still not a global proof of absence.

## External blockers (honest)

| Claim | This code proves? |
|-------|-------------------|
| Production collections migrated | **No** — needs a real production snapshot + apply evidence |
| Downstream Ordering disabled/enabled | **No** — Inventory exposes the gate; Ordering must integrate |
| Gate G2B released | **No** — needs downstream integration evidence |

## CR-105 boundary

`decodeDeploymentReference` / `lookupExactDeployment` remain the single
deployment-reference and clone-on-read enrichment boundary. Backfill reuses
them; it does not fork digest or decode semantics.
