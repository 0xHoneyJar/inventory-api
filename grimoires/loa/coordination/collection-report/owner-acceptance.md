---
document_type: boundary_owner_acceptance_record
document_version: "1.8"
dispatch: collection-report-coordinator-f09.52
technical_record_status: conditional
owner_attestation: pending
acceptance_effect: non_gating_conditional_record
acceptance_phase: technical_record_pending_owner_attestation
record_kind: conditional_technical_record
approval_effect: none
pending_independent_owner: true
production_go: false
recorded_at: "2026-07-16T01:36:54-07:00"
required_attestation_role: independent_inventory_boundary_owner
attestation_resolution_method: superseding_dispatch_referenced_revision
attestation_resolution_status: pending
pending_record_path: grimoires/loa/coordination/collection-report/owner-acceptance.md
future_attestation_artifact: null
audited_baseline: 5f2b8f59f85fd74b2da72160e328ebf89c3b01bd
coordinator_source:
  repository: collection-report-coordinator
  commit: f3b1b8ed616836c586545bceb5618507bc0f4e14
  artifacts:
    - path: grimoires/loa/prd.md
      version: "0.3"
      sha256: 4866ca1ccb580e7743a6f3523e73249d4ade13b0931424df1be782f644247f0c
    - path: grimoires/loa/sdd.md
      version: "0.5"
      sha256: 255ec5874f944b9c255ba7d9b58d1abe073c1989aded55a39483b23d73cd0f09
    - path: grimoires/loa/sprint.md
      version: "0.6"
      sha256: 682368e29051309c4d0c16e457a14127f207f9824b58ac75138f96fcbb1ed04e
validity_status: current_for_audited_baseline
validity_enforcement: consumer_recomputes_bound_digests
automated_state_mutation: false
validation_contract:
  name: inventory_boundary_acceptance_v1
  implementation: embedded_shell_under_evidence
  required_inputs: [inventory_checkout, coordinator_checkout]
  pass_output: "PASS inventory_boundary_acceptance_v1"
  failure_output_prefix: "FAIL inventory_boundary_acceptance_v1"
  consuming_pr_evidence: required_before_any_gate_transition
superseded_by: null
invalidated_at: null
invalidation_reason: null
required_reaudit_events:
  - before_cr_105_issue_ready
  - before_cr_108_issue_ready
  - before_g2a
  - before_g2b
  - audited_evidence_file_changed
  - coordinator_artifact_withdrawn
  - coordinator_artifact_superseded
  - coordinator_artifact_digest_mismatch
unresolved_conditions:
  - id: inventory_schema_transport_ratification
    owners: [shared_protocol, inventory, sonar]
    owner_display: "Shared protocol + Inventory + Sonar"
    gate_effect: blocks_cr_105_unconditional_acceptance_and_g0_g2a
  - id: inventory_rights_provenance
    owners: [inventory, storage_rights_authority]
    owner_display: "Inventory + Storage/rights authority"
    gate_effect: blocks_production_rights_claims_and_optional_cr_405
  - id: inventory_equivalence_ratification
    owners: [inventory_equivalence_authority]
    owner_display: "Inventory equivalence authority"
    gate_effect: blocks_equivalence_use_in_confirmation_and_work_keys
  - id: inventory_backfill_contract
    owners: [inventory, sonar, ordering, cr_209a_owner]
    owner_display: "Inventory + Sonar + Ordering + CR-209A owner"
    gate_effect: blocks_cr_108_issue_ready_and_g2b
  - id: inventory_backfill_evidence
    owners: [inventory]
    owner_display: "Inventory owner"
    gate_effect: blocks_production_resolver_and_equivalence_enablement
  - id: inventory_capacity_proof
    owners: [inventory, sonar, operations]
    owner_display: "Inventory + Sonar + Operations"
    gate_effect: blocks_production_traffic_above_controlled_fixture_cohort
  - id: inventory_operations_readiness
    owners: [inventory, operations, ordering]
    owner_display: "Inventory + Operations + Ordering participant"
    gate_effect: blocks_g2b_and_cr_209b_owner_go
  - id: inventory_svm_population
    owners: [sonar, inventory]
    owner_display: "Sonar + Inventory"
    gate_effect: prevents_code_correct_svm_enrichment_from_being_production_proof
non_gating_peer_references:
  - repository: 0xHoneyJar/sonar-api
    pull_request: 163
    dispatch: collection-report-coordinator-f09.40
    commit: 87487d1d268b7299c7bd880cc8e328ad2e6e861f
  - repository: 0xHoneyJar/storage-api
    pull_request: 28
    dispatch: collection-report-coordinator-f09.55
    commit: 37c1c23e9fc5dc73025c4d37b91187829554047c
  - repository: 0xHoneyJar/loa-freeside
    pull_request: 473
    dispatch: collection-report-coordinator-f09.9
    commit: 9c22936c062b6491a50aeac4837d73f50ae0159a
---

# Conditional Inventory boundary technical acceptance

**Dispatch:** `ACCEPT-INVENTORY` (`collection-report-coordinator-f09.52`)
**Owner boundary:** `inventory-api`
**Audited baseline:** `origin/main` at `5f2b8f59f85fd74b2da72160e328ebf89c3b01bd` (fetched 2026-07-16)
**Coordinator source snapshot:** `collection-report-coordinator` at `f3b1b8ed616836c586545bceb5618507bc0f4e14`
**Coordinator artifacts:** `grimoires/loa/prd.md` v0.3 (`sha256:4866ca1ccb580e7743a6f3523e73249d4ade13b0931424df1be782f644247f0c`), `grimoires/loa/sdd.md` v0.5 (`sha256:255ec5874f944b9c255ba7d9b58d1abe073c1989aded55a39483b23d73cd0f09`), `grimoires/loa/sprint.md` v0.6 (`sha256:682368e29051309c4d0c16e457a14127f207f9824b58ac75138f96fcbb1ed04e`). Reproduce each digest from a checkout of `collection-report-coordinator` with `git show f3b1b8ed616836c586545bceb5618507bc0f4e14:<path> | shasum -a 256`.
**Document version:** `1.8`
**Technical record status:** `conditional`
**Owner attestation status:** `pending`
**Accepted by:** No independent Inventory boundary owner yet. `ACCEPT-INVENTORY` records the dispatch's conditional technical assessment only.
**Recorded by:** `@zkSoju`, as the dispatch operator and PR author; this records provenance, not human production approval. A role rotation may replace the recorder only through a later dispatch-referenced acceptance record.
**Independent owner attestation:** `pending` — no independent Inventory boundary owner or reviewer has signed this record. This PR prepares the conditional technical record; it does not close human owner acceptance or authorize production.
**Acceptance recorded at:** `2026-07-16T01:36:54-07:00`
**Verdict:** `conditional`
**Supersession:** Only a later, dispatch-referenced revision of this file carrying a new document version, acceptance record, and source snapshots may replace this verdict. Evidence invalidation, a failed required re-audit, or withdrawal of a bound coordinator artifact immediately makes this record `stale / blocked` pending supersession; absence of a replacement never preserves usability.

No watcher mutates this file when an invalidating event occurs. The structured
`validity_enforcement` field makes the contract consumer-enforced: before using
the record, consumers must run the named `inventory_boundary_acceptance_v1`
check embedded under **Evidence** against both required checkouts and attach its
output to any PR proposing a gate transition. Missing objects or digest
mismatches fail closed. A mismatch, withdrawal, or supersession is
`stale / blocked` even if the checked-in `validity_status` has not yet been
updated by a superseding record.

## Call

The `ACCEPT-INVENTORY` dispatch conditionally records Inventory's technical
ownership of CR-105, CR-108, and its optional CR-405 participation within the
boundaries below. Independent owner attestation remains pending; this is not a
production GO. For issue creation only, CR-105 may become issue-ready after the
shared deployment schema and exact lookup wire shape are ratified. That narrow
threshold does not make owner acceptance unconditional: the provenance, rights,
and equivalence conditions below still block unconditional acceptance and
production use. CR-108 and production resolver enablement remain blocked
until the backfill, equivalence, reconciliation, rollback, and operating evidence
listed here exists. No report order or shared-work key may trust today's registry
shape directly.

The current service is a useful seed, not the requested contract. It has a
rights-aware cross-VM registry and bounded metadata resolution, but its public
`GET /collections` projection is discovery-oriented, unversioned, and
alias-addressable. It does not accept a shared `CollectionDeploymentRef`, emit
metadata provenance, publish explicit equivalence evidence, or provide a
production backfill/reconciliation path.

This record is a point-in-time technical acceptance, not human or operator
approval and not a production GO. Re-audit the facts below against the then-current
Inventory baseline before CR-105 becomes issue-ready, before CR-108 becomes
issue-ready, before G2A, before G2B, and whenever a file cited under
**Evidence** changes from the pinned audited baseline. Withdrawal,
supersession, or digest mismatch of any bound coordinator artifact invalidates
this record immediately and also requires re-audit. A re-audit must record its
new baseline and superseding document version; until then, the findings apply
only to the baseline named above and must not be projected onto a newer `main`.

## Identifier glossary

| Identifier | Meaning in this acceptance | Coordinator sprint anchor |
|---|---|---|
| G0 | Cross-VM deployment identity fixtures pass in every consumer. | Sprint §4, §6 |
| G2A | Resolver and enrichment fixtures prove honest single, multiple, partial, and empty outcomes for the initial EVM-plus-Solana matrix. | Sprint §4, §7 |
| G2B | Production identity backfill/parity and every additional enabled network's recognition packet pass. | Sprint §4, §7 |
| CR-001 | Shared cross-VM collection identity contract and fixtures. | Sprint §6 |
| CR-105 | Exact Inventory enrichment contract. | Sprint §7 |
| CR-108 | Existing collection identity and equivalence backfill. | Sprint §7 |
| CR-209A | Mixed-version rollout and cutover plan. | Sprint §8 |
| CR-209B | Production cutover rehearsal. | Sprint §8 |
| CR-404 | Capacity dashboard and operations runbook. | Sprint §10 |
| CR-405 | Optional metadata snapshot capability. | Sprint §10 |

## Current `origin/main` audit

| Area | Current fact | Acceptance consequence |
|---|---|---|
| Collection enrichment | The registry records chain, numeric `chainId`, collection key, display fields, aliases, metadata strategy, optional image hosts, rights policy, and EVM/SVM addresses. `GET /collections` exposes only `id`, aliases, chain/chainId, display fields, strategy, effective rights policy, and optional image hosts. The Beacon capabilities/transport declaration does not advertise `listCollections` or `/collections`. | Useful compatibility surface, but not CR-105. The exact internal lookup must be a separate versioned contract and must include collection key and provenance. Contract publication must follow Beacon governance rather than treating the route's existence as adoption. |
| Exact identity | Route lookup accepts primary IDs, every EVM contract, SVM mint, and case-folded aliases. The public projection has no `deployment_id` or network namespace/reference pair. | Alias lookup must not be reused as exact enrichment. Exact lookup accepts only the shared chain-qualified deployment reference and returns empty on a miss. |
| Metadata provenance and rights | `rehost_policy` defaults to `proxy`; module-load validation refuses mirror-hosted strategies without explicit `mirror` and refuses `mirror` on non-mirroring strategies. EVM proxy (`tokenuri`) and SVM pointer pass-through (`sonar-image`) are mechanically separate from sovereign mirror paths. | Rights posture is accepted as the implementation seed. It still needs a versioned policy assertion with source/evidence, authority, and effective time; source comments are not production provenance. |
| Explicit equivalence | One registry row may cover several contracts (the Fractures row covers ten), but the row carries no `equivalence_basis`, evidence reference/digest, assertion version, exact deployment-set digest, ratifier, or revocation event. | Current grouping may seed a quarantined backfill candidate only. It is forbidden as production equivalence until ratified and versioned. |
| Production backfill | Registry state is static source code. There is no dry-run migrator, conflict quarantine, source-precedence report, old/new dual-read parity, new-key authority step, immutable revocation, or downstream invalidation evidence. | G2B remains closed. Production Ordering stays disabled from trusting new identity/equivalence keys. |
| Capacity | Metadata pages are capped at 100 tokens, per-request fan-out defaults to 8, page budget defaults to 15s and is capped at 25s under the 30s request timeout. The source explicitly states there is no process-global semaphore, inbound rate limit, or metadata cache. | Exact enrichment must remain local/no-fanout. Existing metadata fetch bounds do not establish aggregate production capacity for resolver traffic. |
| Operations | Railway supplies `/health`, restart-on-failure, and three retries. Metadata degradation is aggregated to one warning per page. No registry/backfill parity metrics, quarantine dashboard, rights/equivalence audit stream, safe-stop runbook, or reconciliation job exists. | Operational acceptance is conditional on the runbook, metrics, alerts, and named on-call split below. |

## Conditionally accepted interface boundaries

These are technical boundary constraints for subsequent work, not independently
attested owner acceptance or authorization to enable them in production.

### Existing compatibility surface

- Preserve `GET /collections` and current NFT/profile routes during the entire
  expand/deploy/constrain window.
- Treat `GET /collections` as presentation discovery only. It is not an identity
  authority, an exact deployment lookup, or equivalence evidence.
- Existing aliases remain presentation/routing compatibility. They never enter a
  deployment ID, equivalence digest, work key, or report input digest.

### CR-105 exact enrichment contract

The shared protocol owns `CollectionDeploymentRef.v1`. Inventory consumes that
exact type and returns either no match or one versioned enrichment assertion.
Transport may be internal HTTP or a generated client, but the following semantic
shape is required before owner acceptance becomes unconditional:

| Field group | Required semantics |
|---|---|
| Envelope | schema major/minor, producer version, Inventory registry/assertion version, generated/effective time |
| Exact deployment | the full input `CollectionDeploymentRef.v1`, including namespace, network reference, normalized address, and `deployment_id`; no address-only key |
| Curated display | collection ID/key when present, name, symbol, aliases, image and exact image hosts when present; every value carries a source/provenance class |
| Metadata posture | mechanically distinct strategy (`mirror`, EVM external pointer, SVM Sonar pointer, unresolved/excluded as applicable), metadata quality, canonical source/pointer when publishable, retrieval/observation time when externally observed |
| Rights | effective `proxy|mirror|excluded` policy, policy/assertion version, evidence reference/digest, authority/actor, effective time, and revocation state |
| Equivalence | absent, `single_deployment`, or an explicit assertion containing basis, immutable assertion version, exact sorted deployment-set digest, evidence reference/digest, and revocation state |

Rules:

1. Unknown exact deployment returns empty. It does not fall back to aliases,
   symbol, name, image, deployer, metadata URI, or another network.
2. Solana identity stays case-sensitive. New wire contracts use namespace plus
   string network reference; they do not require a numeric `chainId` for every
   VM. Numeric `chainId` remains only on the legacy compatibility surface.
3. Inventory does no live chain fanout for enrichment. Sonar owns probing,
   observed deployment identity, proxy implementation evidence, and index
   readiness. Inventory joins exact observed identity to curated assertions.
4. Missing display metadata remains a valid exact match. Metadata is evidence
   and presentation, never identity or equivalence authority.
5. Additive optional fields require a supported minor. Changed normalization,
   field meaning, or digest preimage requires a new major/domain.

### CR-108 backfill outputs

CR-108 must produce durable, machine-readable artifacts rather than a one-time
source edit:

- immutable source snapshot and source-precedence version;
- idempotent dry-run and apply modes over the same canonical input;
- per-row disposition: migrated, unchanged, quarantined, or rejected, with typed
  reason;
- counts and digests for every disposition plus a reproducible reconciliation
  report;
- old/new exact-read parity and collision report;
- explicit new-key authority receipt;
- pre-authority rollback receipt;
- post-authority immutable equivalence-revocation event that enumerates affected
  deployments and is consumable by Ordering's reverse-dependency quarantine.

## Authority boundaries and forbidden inferences

Inventory owns:

- curated collection display assertions and collection keys;
- exact deployment-to-curated-entry enrichment;
- rights-aware metadata strategy and the evidence for that rights assertion;
- registry/protocol-link equivalence assertions and operator-ratified assertions
  only through the authorized, audited mutation contract;
- registry versioning, reconciliation, and revocation publication.

Inventory does not own:

- chain probing, RPC/DAS fanout, current ownership, index readiness, finality, or
  proxy implementation observation (Sonar);
- resolution sessions, confirmation, admission, work keys, order lifecycle, or
  downstream quarantine execution (Ordering);
- metadata bytes or storage retention (Codex/Storage/source owner);
- Dashboard candidate ranking or chain guessing;
- report/gate policy, community mapping, identity links, or restricted evidence.

Forbidden inferences:

- no equivalence from name, symbol, image, aliases, metadata URI, deployer, same
  address on another network, or shared metadata strategy;
- no mirror rights from possession of a URL, existing cached bytes, community
  familiarity, or an unversioned source comment;
- no network from an address alone and no lowercasing of Solana identifiers;
- no readiness from registry presence, metadata success, or RPC reachability;
- no silent winner when curated Inventory, observed Sonar identity, proxy
  implementation, or operator-ratified evidence conflicts;
- no ad-hoc mutation of a live equivalence edge after new-key authority.

Conflicts, incomplete network identity, code/proxy drift, missing authority, and
ambiguous grouping quarantine the row. They do not degrade into a guessed match.

## Bottom-up capacity and headcount estimate

This is a planning estimate, not a delivery promise. It assumes CR-001 publishes
the shared identity types and digest fixtures before CR-105 integration starts,
the current registry remains small enough for a local exact index, and no new
persistent service is introduced solely for CR-105.

| Work package | Effort | Staffing |
|---|---:|---|
| CR-105 shared-schema adoption, exact index/contract, version envelope | 3-5 engineer-days | Inventory maintainer; shared-protocol review |
| CR-105 provenance/rights/equivalence assertion model and fixtures | 4-6 engineer-days | Inventory maintainer; Storage/rights reviewer part-time |
| CR-105 compatibility, load/negative tests, deploy/runbook evidence | 3-4 engineer-days | Inventory maintainer; Sonar consumer reviewer part-time |
| CR-108 source adapters, precedence, dry-run/apply, quarantine | 6-9 engineer-days | Inventory maintainer plus Sonar participant |
| CR-108 versioning, parity/collision, rollback, revocation publication | 7-11 engineer-days | Inventory maintainer plus shared-protocol/Ordering participant |
| Production rehearsal, reconciliation, dashboards, handoff | 4-7 engineer-days | Inventory maintainer plus Operations; Ordering/Sonar at gates |

Each row's effort range is Inventory-owner engineer time. The peer roles named
under Staffing identify coordination needs; their review and integration effort
is counted only in the separate participant range below.

**Total:** 27-42 engineer-days, plus 5-9 participant review/integration days.
Minimum viable staffing is one dedicated Inventory maintainer, approximately
0.5 shared across Sonar/Ordering/shared-protocol, and approximately 0.2
Operations/Storage-rights review. Peak coordinated headcount is 2-3 people.
Dependency latency and production data conflicts create high schedule
uncertainty; estimate range is roughly -20%/+50% until the CR-108 dry run reports
real row and quarantine counts.

Service-capacity acceptance is separate from staffing. CR-105 exact lookup must
have no external fetch and must be benchmarked against the ratified production
deployment count and resolver concurrency. The current 8-per-request metadata
bound is not a process capacity limit. Any metadata path used by a report must
add aggregate admission/rate control or remain outside the interactive resolver.

## Mixed version, flags, deploy, and rollback

1. **Expand:** land shared `CollectionDeploymentRef.v1` fixtures, then deploy an
   additive Inventory exact-enrichment v1 endpoint/port. Keep all old routes and
   registry fields readable. Inventory writes no new production authority yet.
2. **Deploy reader dark:** deploy Sonar's adapter while server-side
   `collection_resolver_enabled` remains off. Shadow exact lookups on controlled
   fixtures; aliases and legacy `/collections` are not fallback identity paths.
3. **Backfill:** run CR-108 dry-run/apply, quarantine conflicts, and compare old
   and new reads. The authority selector/flag for old versus new Inventory
   identity reads is not named in the current coordinator flag list; CR-209A must
   name its owner and exact key before production backfill starts.
4. **Enable recognition:** only after G2A and CR-105 compatibility evidence.
   Production use of equivalence/shared-work identity remains off until G2B
   backfill parity and closure.
5. **Constrain:** disable legacy writers only after every consumer supports v1,
   parity is clean, quarantine is dispositioned, and CR-209A records the
   rollback boundary. Remove no legacy read during the initial release.

Mixed-version behavior:

- new Sonar with old Inventory uses no v1 enrichment and may return chain-probed
  candidates without registry enrichment; it must not synthesize equivalence;
- old Sonar ignores the additive endpoint and current products remain deployable;
- unsupported major/minor, missing required evidence, or revoked assertion is a
  typed enrichment miss/compatibility failure, never alias fallback;
- durable confirmations retain the exact Inventory assertion/equivalence version
  they used; a later revocation makes unresolved confirmations stale and causes
  downstream quarantine without rewriting historical bytes.

Rollback:

- before new-key authority, disable the consumer flag/reader and return to old
  reads; retain the backfill report and quarantine records;
- after new-key authority, binary rollback is allowed only to a version that can
  read and preserve v1 assertions. A wrong edge is corrected by immutable
  revocation/supersession, never destructive rollback or live-key surgery;
- disable new resolver/order admission before accepting work with unavailable
  enrichment. Existing accepted orders remain in their declared state and are
  handled by Ordering's typed compatibility/quarantine rules.

## Operations

Inventory on-call owns:

- exact-lookup availability, latency, miss rate, and incompatible-version rate;
- registry version publication and deployment/equivalence assertion audit;
- rights-policy invariant failures and rights-evidence expiry/revocation;
- CR-108 dry-run/apply, quarantine, parity, collision, and reconciliation;
- publishing revocation events and proving delivery to the Ordering boundary.

Sonar owns probe/index health and observed identity drift. Ordering owns admission
shutdown, reverse-dependency enumeration, work/artifact quarantine, and accepted
order truth. Storage owns mirrored bytes, retention, and pointer flips. CR-404's
report-wide capacity dashboard remains the operations owner's surface; Inventory
must export its boundary metrics into it but must not redefine report lifecycle.

The following peer acceptance records are non-gating references that describe
where adjacent conditional technical assessments were recorded; they do not
acknowledge, satisfy, or authorize the peer duties named above: Sonar
`ACCEPT-SONAR` / `collection-report-coordinator-f09.40`
([PR #163](https://github.com/0xHoneyJar/sonar-api/pull/163) at
`87487d1d268b7299c7bd880cc8e328ad2e6e861f`), Storage `ACCEPT-STORAGE` /
`collection-report-coordinator-f09.55`
([PR #28](https://github.com/0xHoneyJar/storage-api/pull/28) at
`37c1c23e9fc5dc73025c4d37b91187829554047c`), and Loa/Ordering `ACCEPT-LOA` /
`collection-report-coordinator-f09.9`
([PR #473](https://github.com/0xHoneyJar/loa-freeside/pull/473) at
`9c22936c062b6491a50aeac4837d73f50ae0159a`). These references do not imply
human approval, production readiness, or closure of any referenced document's
conditions. They are cross-boundary context, not inputs to this record's
reproducible evidence bundle; their PR numbers and SHAs identify what was
consulted but do not independently verify or satisfy Inventory's gates.
No condition, verdict, or validity transition in this Inventory record depends
on the contents of those peer records. Their removal, supersession, or
unavailability does not change this record's status; only the structured
invalidation and re-audit events above, Inventory-owned evidence, or an explicit
superseding Inventory acceptance may do so.

Required runbook procedures:

- halt new-key authority on any parity/collision drift and preserve both source
  snapshots;
- disable resolver consumption on sustained exact-lookup errors without taking
  legacy NFT/profile routes down;
- expire or revoke a rights/equivalence assertion, enumerate impacted
  deployments, and confirm the downstream quarantine receipt;
- resume only from a named registry/assertion version after reconciliation;
- distinguish metadata-source degradation, expected metadata absence, registry
  miss, rights-policy refusal, and equivalence quarantine in alerts;
- rehearse deploy, pre-authority rollback, post-authority revocation, and backlog
  reconciliation before G2B opens.

## Evidence

Coordinator requirements:

- PRD `grimoires/loa/prd.md:67-82,127-184,329-388,390-434` — recognition truth,
  explicit grouping evidence, capacity, and Inventory's non-fanout boundary.
- SDD `grimoires/loa/sdd.md:141-188,240-250,327-407,2133-2152,2246-2262,
  2506-2564,2604-2609` — cross-VM identity, exact enrichment join, metadata
  provenance/egress, wire compatibility, deploy/rollback, and rights limits.
- Sprint `grimoires/loa/sprint.md:23-38,59-131,1134-1187,1718-1768,
  2018-2087,2136-2150` — audited baseline, G2A/G2B, CR-105/108, cutover,
  optional snapshots, capacity/operations, and owner-acceptance fields.

`origin/main` implementation evidence at `5f2b8f59`:

- `src/collection-registry.ts:6-103,170-395` — registry model, strategies,
  rights policy, and current rows.
- `src/collection-registry.ts:305-309` — the source-level PYTH-2 caveat that
  production Pythenians images remain empty until the post-PYTH-1 reindex.
- `src/collection-registry.ts:415-455` — effective proxy default and module-load
  mirror/proxy invariant.
- `src/collection-registry.ts:458-475,567-575` — aliases participate in current
  route lookup; this is not exact deployment matching.
- `src/collection-registry.ts:498-565` and `src/routes.ts:339-381` — current
  unversioned public discovery projection.
- `.well-known/beacon.json:1-29` — the current declared capability/transport
  surface does not publish collection discovery or exact enrichment.
- `src/inventory.ts:316-458` — EVM/SVM ownership is consumed from Sonar and
  metadata strategies remain distinct.
- `src/sovereign-metadata.ts:53-89` and `src/inventory.ts:169-280` — current
  per-request concurrency and page budgets.
- `tests/collection-registry.test.ts:86-256` — current proxy/mirror and SVM proxy
  fixtures; no explicit equivalence/backfill fixture exists.
- `railway.toml:1-10` — current health/restart posture.

The audited commit is the source-tree boundary for these claims. Line ranges
above are reader navigation only; the following content digests bind the exact
files inspected at that commit independently of later line movement:

| Evidence path | SHA-256 at `5f2b8f59f85fd74b2da72160e328ebf89c3b01bd` |
|---|---|
| `.well-known/beacon.json` | `79f8e6f56baf34adac50d42f28421b1dce6307539f1c033aa37bfb2b81bc540a` |
| `railway.toml` | `cdf6a2c4fe807263e2bc3450507112eadda1163a7ce176e726e18af0124967cf` |
| `src/collection-registry.ts` | `e44ed63d960d4af57e465d3c420650c23bd566ef46ec715866b1192e7befb2a1` |
| `src/inventory.ts` | `dc6f716675a25ed0b5a25423b4822d61254b060d6db1bd05d5a04fafaec82b18` |
| `src/routes.ts` | `2d4d69f998a0ba22d80a89e34bd5b0d486de108aa29274afb331f551099d6ede` |
| `src/sovereign-metadata.ts` | `055a5981f2e461129cde1db9284512374fe869d8cf8a0c571a87da43f872e34a` |
| `tests/collection-registry.test.ts` | `97780a5f487a79f9cff3cce2baf1d47a09243803856d2c9c74a6bab2b5ea45a9` |

Run the versioned validation contract below from any checkout. Set
`INVENTORY_REPO` and `COORDINATOR_REPO` to the two local repositories. It emits
one path-labeled content-digest result per bound blob, fails closed on a missing
object or mismatch, and emits the named final PASS line only when every blob
matches. A PR proposing any gate transition must attach this output.

```sh
CHECK=inventory_boundary_acceptance_v1
INVENTORY_REPO="${INVENTORY_REPO:-.}"
COORDINATOR_REPO="${COORDINATOR_REPO:?set COORDINATOR_REPO to its checkout}"
INVENTORY_BASE=5f2b8f59f85fd74b2da72160e328ebf89c3b01bd
COORDINATOR_BASE=f3b1b8ed616836c586545bceb5618507bc0f4e14
failed=0

verify_blob() {
  scope="$1"
  repository="$2"
  commit="$3"
  expected="$4"
  evidence_path="$5"

  if ! git -C "$repository" cat-file -e "$commit:$evidence_path" 2>/dev/null
  then
    printf 'FAIL %s missing_object %s %s:%s\n' \
      "$CHECK" "$scope" "$commit" "$evidence_path" >&2
    failed=1
    return
  fi

  actual="$(
    git -C "$repository" cat-file blob "$commit:$evidence_path" \
      | shasum -a 256 \
      | awk '{ print $1 }'
  )"
  if [ "$actual" != "$expected" ]
  then
    printf 'FAIL %s digest_mismatch %s %s %s expected=%s actual=%s\n' \
      "$CHECK" "$scope" "$commit" "$evidence_path" "$expected" "$actual" >&2
    failed=1
    return
  fi
  printf 'PASS %s content_digest %s %s %s\n' \
    "$CHECK" "$scope" "$actual" "$evidence_path"
}

verify_blob coordinator "$COORDINATOR_REPO" "$COORDINATOR_BASE" 4866ca1ccb580e7743a6f3523e73249d4ade13b0931424df1be782f644247f0c grimoires/loa/prd.md
verify_blob coordinator "$COORDINATOR_REPO" "$COORDINATOR_BASE" 255ec5874f944b9c255ba7d9b58d1abe073c1989aded55a39483b23d73cd0f09 grimoires/loa/sdd.md
verify_blob coordinator "$COORDINATOR_REPO" "$COORDINATOR_BASE" 682368e29051309c4d0c16e457a14127f207f9824b58ac75138f96fcbb1ed04e grimoires/loa/sprint.md
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" 79f8e6f56baf34adac50d42f28421b1dce6307539f1c033aa37bfb2b81bc540a .well-known/beacon.json
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" cdf6a2c4fe807263e2bc3450507112eadda1163a7ce176e726e18af0124967cf railway.toml
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" e44ed63d960d4af57e465d3c420650c23bd566ef46ec715866b1192e7befb2a1 src/collection-registry.ts
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" dc6f716675a25ed0b5a25423b4822d61254b060d6db1bd05d5a04fafaec82b18 src/inventory.ts
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" 2d4d69f998a0ba22d80a89e34bd5b0d486de108aa29274afb331f551099d6ede src/routes.ts
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" 055a5981f2e461129cde1db9284512374fe869d8cf8a0c571a87da43f872e34a src/sovereign-metadata.ts
verify_blob inventory "$INVENTORY_REPO" "$INVENTORY_BASE" 97780a5f487a79f9cff3cce2baf1d47a09243803856d2c9c74a6bab2b5ea45a9 tests/collection-registry.test.ts

if [ "$failed" -ne 0 ]
then
  printf 'FAIL %s validation_failed\n' "$CHECK" >&2
  exit 1
fi
printf 'PASS %s\n' "$CHECK"
```

## Unresolved conditions

The IDs below mirror the structured frontmatter for automation. They describe
open work and its current blocking effect; they do not confer authority, close a
gate, or substitute for the independent owner attestation that remains pending.

| ID | Condition | Owner | Gate/effect |
|---|---|---|---|
| `inventory_schema_transport_ratification` | Ratify `CollectionDeploymentRef.v1`, canonical digest fixtures, and the exact enrichment response schema/transport. | Shared protocol + Inventory + Sonar | Blocks CR-105 unconditional acceptance and G0/G2A. |
| `inventory_rights_provenance` | Add versioned provenance and rights assertion evidence; convert source comments into governed records. | Inventory + Storage/rights authority | Blocks production rights claims and optional CR-405. |
| `inventory_equivalence_ratification` | Ratify Fractures and every multi-deployment grouping with explicit basis, exact set digest, evidence, authority, and revocation path. | Inventory equivalence authority | Blocks equivalence use in confirmation/work keys. |
| `inventory_backfill_contract` | Name CR-108 source precedence, immutable storage/event owner, retention, quarantine disposition authority, and old/new authority selector. | Inventory + Sonar + Ordering + CR-209A owner | Blocks CR-108 issue-ready status and G2B. |
| `inventory_backfill_evidence` | Run production dry-run/backfill and publish counts, parity, collisions, quarantine, rollback, and revocation evidence. | Inventory owner | Blocks production resolver/equivalence enablement. |
| `inventory_capacity_proof` | Prove process-level resolver/enrichment capacity and add aggregate control where metadata can fan out. | Inventory + Sonar + Operations | Blocks production traffic above the controlled fixture cohort. |
| `inventory_operations_readiness` | Publish runbook, alerts, dashboards, on-call routing, and a successful synthetic reconciliation/revocation exercise. | Inventory + Operations + Ordering participant | Blocks G2B/CR-209B owner GO. |
| `inventory_svm_population` | Confirm production SVM rows are populated after Sonar reindex; `src/collection-registry.ts:305-309` explicitly warns Pythenians images may remain empty until that happens. | Sonar + Inventory | Prevents treating code-correct SVM enrichment as production proof. |

## Strongest caveat

The current registry can make a multi-contract collection look explicit because
the contracts share one source-code row, but there is no production assertion or
backfill evidence proving why they are equivalent. Treating that row as
`collection_identity.v1` would silently promote curation into identity authority
and contaminate confirmations, shared-work keys, and issued artifacts. The gate
stays closed until CR-108 produces versioned equivalence plus reconciliation and
revocation proof.
