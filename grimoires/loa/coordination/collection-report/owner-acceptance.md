# Inventory boundary owner acceptance

**Dispatch:** `ACCEPT-INVENTORY` (`collection-report-coordinator-f09.52`)
**Owner boundary:** `inventory-api`
**Audited baseline:** `origin/main` at `5f2b8f59f85fd74b2da72160e328ebf89c3b01bd` (fetched 2026-07-16)
**Coordinator source snapshot:** `collection-report-coordinator` at `f3b1b8ed616836c586545bceb5618507bc0f4e14`
**Coordinator artifacts:** PRD v0.3 (`sha256:4866ca1ccb580e7743a6f3523e73249d4ade13b0931424df1be782f644247f0c`), SDD v0.5 (`sha256:255ec5874f944b9c255ba7d9b58d1abe073c1989aded55a39483b23d73cd0f09`), Sprint Plan v0.6 (`sha256:682368e29051309c4d0c16e457a14127f207f9824b58ac75138f96fcbb1ed04e`)
**Document version:** `1.0`
**Accepted by:** Inventory boundary owner role under the `ACCEPT-INVENTORY` dispatch (technical acceptance only)
**Recorded by:** `@zkSoju`, as the dispatch operator and PR author; this records provenance, not human production approval. A role rotation may replace the recorder only through a later dispatch-referenced acceptance record.
**Independent owner attestation:** `pending` — no independent Inventory boundary owner or reviewer has signed this record. This PR prepares the conditional technical record; it does not close human owner acceptance or authorize production.
**Acceptance recorded at:** `2026-07-16T01:36:54-07:00`
**Verdict:** `conditional`
**Supersession:** Only a later, dispatch-referenced revision of this file carrying a new document version, acceptance record, and source snapshots may replace this verdict. Evidence invalidation, a failed required re-audit, or withdrawal of a bound coordinator artifact immediately makes this record `stale / blocked` pending supersession; absence of a replacement never preserves usability.

## Call

Inventory accepts ownership of CR-105, CR-108, and its optional CR-405
participation within the boundaries below. This is not a production GO. CR-105
may become issue-ready after the shared deployment schema and exact lookup wire
shape are ratified. CR-108 and production resolver enablement remain blocked
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
Inventory baseline before CR-105 becomes issue-ready, before G2A, before G2B,
and whenever a file cited under **Evidence** changes from the pinned audited
baseline. A re-audit must record its new baseline and superseding document
version; until then, the findings apply only to the baseline named above and
must not be projected onto a newer `main`.

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

## Accepted interfaces

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

Those peer duties are acknowledged only through conditional technical owner
acceptances: Sonar `ACCEPT-SONAR` / `collection-report-coordinator-f09.40`
([PR #163](https://github.com/0xHoneyJar/sonar-api/pull/163) at
`87487d1d268b7299c7bd880cc8e328ad2e6e861f`), Storage `ACCEPT-STORAGE` /
`collection-report-coordinator-f09.55`
([PR #28](https://github.com/0xHoneyJar/storage-api/pull/28) at
`37c1c23e9fc5dc73025c4d37b91187829554047c`), and Loa/Ordering `ACCEPT-LOA` /
`collection-report-coordinator-f09.9`
([PR #473](https://github.com/0xHoneyJar/loa-freeside/pull/473) at
`9c22936c062b6491a50aeac4837d73f50ae0159a`). These references do not imply
human approval, production readiness, or closure of any referenced document's
conditions.

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

## Unresolved conditions

| Condition | Owner | Gate/effect |
|---|---|---|
| Ratify `CollectionDeploymentRef.v1`, canonical digest fixtures, and the exact enrichment response schema/transport. | Shared protocol + Inventory + Sonar | Blocks CR-105 unconditional acceptance and G0/G2A. |
| Add versioned provenance and rights assertion evidence; convert source comments into governed records. | Inventory + Storage/rights authority | Blocks production rights claims and optional CR-405. |
| Ratify Fractures and every multi-deployment grouping with explicit basis, exact set digest, evidence, authority, and revocation path. | Inventory equivalence authority | Blocks equivalence use in confirmation/work keys. |
| Name CR-108 source precedence, immutable storage/event owner, retention, quarantine disposition authority, and old/new authority selector. | Inventory + Sonar + Ordering + CR-209A owner | Blocks CR-108 issue-ready status and G2B. |
| Run production dry-run/backfill and publish counts, parity, collisions, quarantine, rollback, and revocation evidence. | Inventory owner | Blocks production resolver/equivalence enablement. |
| Prove process-level resolver/enrichment capacity and add aggregate control where metadata can fan out. | Inventory + Sonar + Operations | Blocks production traffic above the controlled fixture cohort. |
| Publish runbook, alerts, dashboards, on-call routing, and a successful synthetic reconciliation/revocation exercise. | Inventory + Operations + Ordering participant | Blocks G2B/CR-209B owner GO. |
| Confirm production SVM rows are populated after Sonar reindex; current source explicitly warns Pythenians images may remain empty until that happens. | Sonar + Inventory | Prevents treating code-correct SVM enrichment as production proof. |

## Strongest caveat

The current registry can make a multi-contract collection look explicit because
the contracts share one source-code row, but there is no production assertion or
backfill evidence proving why they are equivalent. Treating that row as
`collection_identity.v1` would silently promote curation into identity authority
and contaminate confirmations, shared-work keys, and issued artifacts. The gate
stays closed until CR-108 produces versioned equivalence plus reconciliation and
revocation proof.
