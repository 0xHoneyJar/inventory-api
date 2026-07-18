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

## Service (HTTP + MCP)

inventory-api is a **Hyper** (hyperjs.ai) service running on **Bun**, consumed
over the wire — **not an npm package** (honeyroad reads it over HTTP + MCP).
One route declaration per endpoint (`src/routes.ts`) generates the runtime,
the OpenAPI 3.1 document, and the MCP tool surface from a single source. The
route handlers are thin — they call the domain functions in `src/inventory.ts`
(the sonar ⨝ codex join + ACVP envelope), which remain the core.

```bash
bun run dev            # hot-reload dev server (PORT, default 8787)
bun run start          # production server
bun run openapi:emit   # writes openapi.json (the consumer's drift-CI anchor)
bun run mcp:emit       # writes mcp.json (MCP tool manifest)
bun run typecheck      # tsc --noEmit (Bun tsconfig)
npm test               # vitest — runs fully offline
```

| Route | Returns | Source | MCP tool |
|-------|---------|--------|----------|
| `GET /holdings/:address` | holdings (counts + tokenIds) + completeness envelope | sonar | `getHoldings` |
| `GET /nfts/:contract/owner/:address` | paginated NFTs w/ metadata | sonar ⨝ codex | `getNftsForOwner` |
| `GET /nfts/:contract/:tokenId` | single MetadataDocument | codex | `getNftMetadata` |

Discovery: `GET /openapi.json` (OpenAPI 3.1), `GET /docs` (Swagger UI),
`GET /.well-known/mcp.json` (MCP manifest), `POST /mcp` (MCP JSON-RPC 2.0),
`GET /health`.

The Hyper framework is **source-distributed** under `src/hyper/` (vendored via
`bun create hyper` + `hyper add openapi openapi-zod mcp` — yours to read/edit;
tracked in `hyper.lock.json`). The domain functions stay importable internally
via `index.ts` for the route handlers + tests.

### Topology — which host serves what (#25)

| Surface | Host | Audience |
|---------|------|----------|
| **HTTP (canonical)** | `https://inventory.0xhoneyjar.xyz` → Railway service `inventory-api` | dashboards, hovercards, honeyroad UI, any HTTP consumer |
| MCP / agent | same host — `POST /mcp` + `GET /.well-known/mcp.json` (`src/app.ts`) | agents; one service serves both surfaces |

> Note: `inventory-mcp-production.up.railway.app` (cited in #25's consumer report) is **not
> ours** — no such service exists in the workspace; the URL was pattern-guessed and answers
> from an unrelated Railway app. Do not document or depend on it.

The service deploys on **Railway** (`railway.toml`, Dockerfile, `bun src/app.ts`,
healthcheck `/health`). There is **no Vercel deployment** — the apex domain is a
Route53 CNAME to the Railway service. If the apex ever returns a Vercel error
page (`DEPLOYMENT_NOT_FOUND`), DNS has drifted back to a stale `cname.vercel-dns.com`
record: repoint the CNAME at the Railway domain (see issue #25).

Consumer smoke: `scripts/smoke-25.sh [--base URL]` — checks `/health`,
`/.well-known/beacon.json`, and the `getNftsForOwner` shape against the apex.

## Modes

- **Hermetic (default):** reads bundled fixtures — the test suite runs fully offline (`npm test`).
- **Live:** set `SONAR_GRAPHQL_ENDPOINT` (the eRPC belt-gateway) → `getHoldings` returns real
  holder counts + a real ACVP envelope from the live belt. Fail-soft: unreachable → fixture + `degraded`.

  ```bash
  SONAR_GRAPHQL_ENDPOINT=https://<belt-gateway-host>/v1/graphql npx vitest run live-smoke
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
