# freeside-inventory

> A **building** on the freeside platform (ADR-008). Sovereign, read-side
> inventory/collections API — an Alchemy/Zapper/DeBank replacement for **our own**
> assets. Joins on-chain holdings (freeside-sonar) with metadata we own (the Mibera
> codex) and returns a verifiable result. No Alchemy, no Dune.

## Is

- Resolve a wallet's holdings + NFT metadata for registered collections (Mibera first).
- Return honeyroad's exact shapes so `mibera-honeyroad` can drop `lib/alchemy.ts` with zero UI change.
- Attach an **ACVP completeness envelope** — `{ as_of_block, holder_count, source, complete }` — a "provably complete as of block N" guarantee Alchemy structurally cannot make.

## Is not

- Does **NOT** mint, burn, or initiate transfers.
- Does **NOT** proxy chain RPC — it consumes `freeside-sonar` for indexed reads.
- Does **NOT** own metadata — that's the codex (today) / `freeside-storage` (sovereign target).

## API

```ts
import { getHoldings, getNftsForOwner, getNftMetadata } from "@freeside/inventory";
```

| Method | Returns | Source |
|--------|---------|--------|
| `getHoldings(address)` | holdings + completeness envelope | sonar (counts) |
| `getNftsForOwner(address, contract)` | paginated NFTs w/ metadata | sonar ⨝ codex |
| `getNftMetadata(contract, tokenId)` | single MetadataDocument | codex |

## Modes

- **Hermetic (default):** reads bundled fixtures — the test suite runs fully offline (`npm test`).
- **Live:** set `SONAR_GRAPHQL_ENDPOINT` (the eRPC belt-gateway) → `getHoldings` returns real
  holder counts + a real ACVP envelope from the live belt. Fail-soft: unreachable → fixture + `degraded`.

  ```bash
  SONAR_GRAPHQL_ENDPOINT=https://<belt-gateway-host>/v1/graphql npm test -- live-smoke
  ```

## Known gap

Per-token current ownership (`owner → tokenIds`) is not yet published by the sonar belt
(`Token` entity empty for Mibera). Per ADR-008's belt model that index is **sonar's to publish**,
not inventory's to derive. Until it lands, live `getHoldings` returns real `tokenCount` with
`tokenIds: []`, and `getNftsForOwner` stays on fixtures. See [`docs/sonar-ownership-gap.md`](docs/sonar-ownership-gap.md).

## Provenance

Built 2026-05-23: cycle-1 skeleton via the `/spiral` autonomous harness → real Mibera codex schema
+ fixtures → live belt-gateway wiring. `cycle_state: candidate`. The Mibera codex schema and grail
data are real (`mibera-codex`); regenerate fixtures with `fixtures/generate-fixtures.py`.
