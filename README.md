# inventory-api

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

## API (library)

```ts
import { getHoldings, getNftsForOwner, getNftMetadata } from "@0xhoneyjar/inventory";
```

| Method | Returns | Source |
|--------|---------|--------|
| `getHoldings(address)` | holdings (counts + tokenIds) + completeness envelope | sonar |
| `getNftsForOwner(address, contract)` | paginated NFTs w/ metadata | sonar ⨝ codex |
| `getNftMetadata(contract, tokenId)` | single MetadataDocument | codex |

## Service transport (HTTP + MCP)

Consumers (e.g. a Next.js frontend) use this building over **HTTP + MCP**, not
as an npm import. A thin Bun transport (`src/server/`) exposes the library
functions as routes and emits an OpenAPI 3.1 spec + an MCP tool manifest from a
single route table. The library stays the core — the server only calls it.

```bash
bun run serve            # GET /holdings/:address, /nfts/:contract/owner/:address, /nfts/:contract/:tokenId
bun run openapi:emit     # writes openapi.json (the consumer's drift-CI anchor)
```

Discovery: `GET /openapi.json` (OpenAPI 3.1) and `GET /.well-known/mcp.json`
(MCP tools). Full Hyper (hyperjs.ai) adoption was deferred in favor of a
minimal `Bun.serve` to keep the library Node-pure — see
[`src/server/README.md`](src/server/README.md) for the rationale.

## Modes

- **Hermetic (default):** reads bundled fixtures — the test suite runs fully offline (`npm test`).
- **Live:** set `SONAR_GRAPHQL_ENDPOINT` (the eRPC belt-gateway) → `getHoldings` returns real
  holder counts + a real ACVP envelope from the live belt. Fail-soft: unreachable → fixture + `degraded`.

  ```bash
  SONAR_GRAPHQL_ENDPOINT=https://<belt-gateway-host>/v1/graphql npm test -- live-smoke
  ```

## Ownership activation (DEP-2)

Per-token current ownership (`owner → tokenIds`) is now wired to the sonar belt's
`Token` index (ERC-721) + `CandiesHolderBalance` (ERC-1155 Candies), merged to sonar's
`cycle/sonar-belt-factory` branch. Live `getHoldings` populates real `tokenIds` and
`getNftsForOwner` joins live ownership with codex metadata; both fail-soft to fixtures
when the index is unreachable. **Not yet verified against a live endpoint** — the belt
branch is merged but not yet deployed/reindexed, so the activation is covered hermetically
(`tests/live-ownership.test.ts` stubs the known belt schema shapes). Per ADR-008's belt
model that index is **sonar's to publish**, not inventory's to derive. See
[`docs/sonar-ownership-gap.md`](docs/sonar-ownership-gap.md).

## Provenance

Built 2026-05-23: cycle-1 skeleton via the `/spiral` autonomous harness → real Mibera codex schema
+ fixtures → live belt-gateway wiring. `cycle_state: candidate`. The Mibera codex schema and grail
data are real (`mibera-codex`); regenerate fixtures with `fixtures/generate-fixtures.py`.
