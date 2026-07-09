@.claude/loa/CLAUDE.loa.md

# inventory-api — Cell Instructions

> This file is project-specific. The framework layer lives in `.claude/loa/CLAUDE.loa.md`.
> Project rules take precedence over framework defaults.

## What this cell is

`inventory-api` is a **building** on the freeside platform per [ADR-008](https://github.com/0xHoneyJar/loa-freeside/blob/main/decisions/008-freeside-as-factory.md). It is a sovereign, read-side inventory/collections API — an Alchemy/Zapper/DeBank replacement for **our own** assets. It joins on-chain holdings (from `freeside-sonar`) with metadata we own (the Mibera codex) and returns a verifiable result attached to an **ACVP completeness envelope** (`{ as_of_block, holder_count, source, complete }`).

- **L4 PRODUCTION** — owns Mibera contract holdings reads for `0x6666397DFe9a8c469BF65dc744CB1C733416c420` (chain 80094).
- Hyper (hyperjs.ai) service on Bun — consumed over HTTP + MCP, **not** an npm package (DEP-2; see `.well-known/beacon.json`).
- Package manager: **bun** (`bun.lock` present; `package-lock.json` was removed in `355446b`, so `npm ci` fails). Use `bun install`, `bun run test`, `bun run typecheck`.

## Place in the hexagonal federation (ADR-009)

inventory-api is a **closer-to-meaning** consumer in the buildings DAG:

```
freeside-sonar  (raw indexed reads — holder counts, chain head)
freeside-storage / mibera-codex  (metadata: image URLs, traits, grail data)
        │
        ▼
   inventory-api  (joins holdings ⨝ metadata; ACVP envelope; honeyroad-shaped output)
        │
        ▼
   downstream readers  (e.g. mibera-honeyroad UI)
```

Belts run one direction (raw → derived → integrated → presented). inventory-api **never** publishes upstream. When unsure which arrow points where: closer-to-raw publishes, closer-to-meaning consumes.

## Key files

| File | Purpose |
|------|---------|
| `index.ts` | Public exports — `getHoldings`, `getNftsForOwner`, `getNftMetadata` + types |
| `src/inventory.ts` | Main composition. Switches hermetic vs live **ownership** based on `liveSonar.isLiveMode()`. Metadata always resolves via the collection's `metadataStrategy`. |
| `src/collection-registry.ts` | Source of truth for collection identity + `metadataStrategy`. `MIBERA_CONTRACT` lives here (line 60). |
| `src/sonar-client.ts` | Upstream sonar consumer (fixture-backed in hermetic mode) |
| `src/codex-client.ts` | Legacy codex consumer. Reads a **55-token sample fixture** — only used for contracts whose strategy is `{kind:"codex"}`. |
| `src/concurrency.ts` | `mapWithConcurrency` — bounds metadata fan-out (a page is up to 100 tokens) |
| `src/live-sonar.ts` | Live belt-gateway client (`SONAR_GRAPHQL_ENDPOINT`) |
| `src/completeness.ts` | ACVP completeness envelope construction |
| `src/transform.ts` | `codexToNFT` / `codexToMetadataDocument` — honeyroad-shape mappers |
| `src/pagination.ts`, `src/address.ts`, `src/errors.ts` | Support |
| `types.ts`, `src/types-internal.ts` | Public + internal type contracts |
| `fixtures/` | Test data (real Mibera codex schema; regenerate via `fixtures/generate-fixtures.py`). `sonar-trackedholders.json` intentionally holds one token (`8485`) absent from `codex-tokens.json` — the orphan that keeps the sovereign metadata path exercised. |
| `.well-known/beacon.json` | **Cell's contract surface** — schema v2 BeaconV3 declaration. DO NOT modify without BeaconV3 governance. |
| `docs/sonar-ownership-gap.md` | **STALE** — the gap it describes is closed (see "Known gaps" below) |

## Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| Hermetic (default) | `SONAR_GRAPHQL_ENDPOINT` unset | **Ownership** reads come from `fixtures/`. |
| Live | `SONAR_GRAPHQL_ENDPOINT=https://<belt-gateway-host>/v1/graphql` | `getHoldings` returns real holder counts + real ACVP envelope from the live belt. Fail-soft: unreachable → fixture + `degraded`. |

**Metadata is not hermetic in either mode.** Per-token metadata for every registered sovereign
collection resolves from `metadata.0xhoneyjar.xyz` — on the single-token route (`getNftMetadata`,
since PR #16) and the owner-list route (`getNftsForOwner`, since bug `20260709-499c5a`). The bundled
codex fixture carries 55 of 10,000 tokens and must never be used as a metadata source in production.

The test suite still runs **fully offline** because every test that touches those routes stubs
`fetch` (see `tests/support/sovereign-cdn-stub.ts`, backed by `fixtures/sovereign-mibera-metadata.json`).
Verify with: block `globalThis.fetch` in a vitest `setupFiles` and run `bun run test` — zero failures.

Per-token resolution fans out one fetch per token, bounded by `METADATA_FETCH_CONCURRENCY` (default 8)
and `METADATA_FETCH_TIMEOUT_MS` (default 8000). An upstream 403/404 fail-softs silently (token absent);
any other failure fail-softs **with a `console.warn`** — a degraded origin must never look like an
absent token, because that is exactly what `20260709-499c5a` was.

## Known gaps

**Per-token current ownership is RESOLVED** (verified against production 2026-07-08 and 2026-07-09). The
sonar belt now publishes the `Token` entity for Mibera: `GET /holdings/0x15b3…2f38` returns 66 populated
`tokenIds` with envelope `{"source":"sonar","complete":true}` — not a degraded fixture fallback.

The ADR-008 rule still stands: **do NOT derive ownership inside inventory-api.** It is sonar's to publish.

`docs/sonar-ownership-gap.md` and issue #27 are **stale** — both still assert the empty `Token` entity, and
issue #27 misattributes the profile-picture defect to it. The actual defect was the metadata join
(bug `20260709-499c5a`); ownership was healthy throughout. Neither artifact has been corrected yet.

## Tooling

| Tool | Use |
|------|-----|
| `br` (beads_rust) | Task tracking for this cell. Initialized with `issue_prefix: inventory-api`. See `.beads/`. |
| `ck` (seek) | Code search — preferred over `grep` (per Loa framework rules) |
| `bun` | Package manager + runtime — `bun install`, `bun run test`, `bun run typecheck` (`npm ci` fails: no `package-lock.json`) |
| `vitest` | Test runner (`bun run test` → `vitest run`) |
| `tsc` | Type check (`bun run typecheck` → `tsc --noEmit`) |

## Runtime invariants

- **DO NOT mint, burn, or initiate transfers.** This cell is read-side only.
- **DO NOT proxy chain RPC.** Read traffic goes through `freeside-sonar`.
- **DO NOT own metadata.** Metadata is the codex's job today, `freeside-storage`'s at sovereign cutover.
- **DO NOT change the public API shape without bumping** `.well-known/beacon.json` per BeaconV3 governance. The honeyroad UI consumes these exact shapes (`getHoldings` returns `HoldingsResponse`, `getNftsForOwner` returns `NFTCollection`, `getNftMetadata` returns `MetadataDocument`).
- **All on-chain identifiers MUST be EIP-55 checksummed** before composition. See `src/address.ts` (`validateAddress` is the gate).

## Compose / framework

For framework-level instructions (workflow gates, skill conventions, beads protocol, hooks, safety, Loa's three-zone model), see `.claude/loa/CLAUDE.loa.md`. Cell-specific guidance in this file takes precedence on conflict.

## Mount provenance

This cell was built **pre-Loa-introduction** (commits `ad65891` → `6733467`). The Loa harness was mounted on **2026-05-25** via the cluster-meta remediation cycle per [ADR-009 D-4](https://github.com/0xHoneyJar/loa-freeside/blob/feat/identity-api/decisions/009-freeside-hexagonal-federation.md) — *"Agents need to be able to run beads/cycles. We mount if not already mounted."* Mount branch: `cluster-meta/loa-mount-2026-05-25`. No `src/` files were modified during mount.
