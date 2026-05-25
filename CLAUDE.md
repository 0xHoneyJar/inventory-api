@.claude/loa/CLAUDE.loa.md

# inventory-api — Cell Instructions

> This file is project-specific. The framework layer lives in `.claude/loa/CLAUDE.loa.md`.
> Project rules take precedence over framework defaults.

## What this cell is

`inventory-api` is a **building** on the freeside platform per [ADR-008](https://github.com/0xHoneyJar/loa-freeside/blob/main/decisions/008-freeside-as-factory.md). It is a sovereign, read-side inventory/collections API — an Alchemy/Zapper/DeBank replacement for **our own** assets. It joins on-chain holdings (from `freeside-sonar`) with metadata we own (the Mibera codex) and returns a verifiable result attached to an **ACVP completeness envelope** (`{ as_of_block, holder_count, source, complete }`).

- **L4 PRODUCTION** — owns Mibera contract holdings reads for `0x6666397DFe9a8c469BF65dc744CB1C733416c420` (chain 80094).
- npm package name: `@freeside/inventory` (library — no service entry).
- Package manager: **npm** (`package-lock.json` present; no bun/pnpm lockfiles).

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
| `src/inventory.ts` | Main composition. The `MIBERA_CONTRACT` constant lives at line 18. Switches hermetic vs live mode based on `liveSonar.isLiveMode()`. |
| `src/sonar-client.ts` | Upstream sonar consumer (fixture-backed in hermetic mode) |
| `src/codex-client.ts` | Upstream codex consumer (metadata + grail) |
| `src/live-sonar.ts` | Live belt-gateway client (`SONAR_GRAPHQL_ENDPOINT`) |
| `src/completeness.ts` | ACVP completeness envelope construction |
| `src/transform.ts` | `codexToNFT` / `codexToMetadataDocument` — honeyroad-shape mappers |
| `src/pagination.ts`, `src/address.ts`, `src/errors.ts` | Support |
| `types.ts`, `src/types-internal.ts` | Public + internal type contracts |
| `fixtures/` | Hermetic-mode test data (real Mibera codex schema; regenerate via `fixtures/generate-fixtures.py`) |
| `.well-known/beacon.json` | **Cell's contract surface** — schema v2 BeaconV3 declaration. DO NOT modify without BeaconV3 governance. |
| `docs/sonar-ownership-gap.md` | Canonical open issue (see "Known gaps" below) |

## Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| Hermetic (default) | `SONAR_GRAPHQL_ENDPOINT` unset | All reads come from `fixtures/`. Test suite runs fully offline (`npm test`). |
| Live | `SONAR_GRAPHQL_ENDPOINT=https://<belt-gateway-host>/v1/graphql` | `getHoldings` returns real holder counts + real ACVP envelope from the live belt. Fail-soft: unreachable → fixture + `degraded`. |

## Known gaps

**Per-token current ownership** (`owner → tokenIds`) is not yet published by the sonar belt — `Token` entity is empty for Mibera. Per ADR-008's belt model that index is **sonar's to publish**, not inventory's to derive. Until it lands:

- live `getHoldings` returns real `tokenCount` with `tokenIds: []`.
- `getNftsForOwner` stays on fixtures.

This gap is canonical work for upstream sonar; do NOT attempt to derive ownership inside inventory-api. See `docs/sonar-ownership-gap.md`.

## Tooling

| Tool | Use |
|------|-----|
| `br` (beads_rust) | Task tracking for this cell. Initialized with `issue_prefix: inventory-api`. See `.beads/`. |
| `ck` (seek) | Code search — preferred over `grep` (per Loa framework rules) |
| `npm` | Package manager — `npm install`, `npm test`, `npm run build`, `npm run typecheck` |
| `vitest` | Test runner (`npm test` → `vitest run`) |
| `tsc` | Type check (`npm run typecheck` → `tsc --noEmit`) |

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
