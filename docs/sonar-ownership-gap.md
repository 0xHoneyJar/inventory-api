# Sonar ownership gap — belt change request

**Status:** belt change MERGED (sonar `cycle/sonar-belt-factory`, 2026-05-24) — inventory
activation landed (DEP-2). Pending live verification once the belt is deployed + reindexed.
· **Owner:** sonar (freeside-sonar belt-factory) · **Filed:** 2026-05-23

## The gap

`freeside-inventory` needs **per-token current ownership** — given a holder address,
which `tokenId`s of a collection they currently own — to serve:

- `getNftsForOwner(address, contract)` → the token gallery / inventory view
- `getHoldings(address).holdings[].tokenIds` → the per-token id list

The live belt-gateway (`https://<belt-gateway-host>/v1/graphql`)
exposes, for Mibera (`collectionKey: "mibera"`, contract `0x6666…420`, chain 80094):

| Entity | Gives us | Enough for |
|--------|----------|-----------|
| `TrackedHolder` | address → `tokenCount` | counts ✅ |
| `chain_metadata` | `latest_processed_block` | ACVP `as_of_block` ✅ |
| `MiberaTransfer` | `from,to,tokenId,blockNumber` events | (raw history) |
| `Token` | per-token current owner | **EMPTY for Mibera** ❌ |

So counts + completeness are live today; **owner→tokenIds is not queryable**.

## Why inventory must NOT solve this itself

Per [ADR-008](../../../../decisions/008-freeside-as-factory.md) §D-3, belts run one
direction: sonar (raw→derived) **publishes** holdings; inventory (integrated)
**consumes**. Reconstructing current ownership by replaying ~40k `MiberaTransfer`
rows per request would (a) be slow, (b) push derived-holdings logic downstream
against belt direction, (c) duplicate state sonar already has. Bottleneck debugging
= "walk upstream" — the fix belongs upstream.

## The ask (sonar belt change)

Populate a **per-token current-owner index** for Mibera (and other ERC-721 belts):
either the existing `Token` entity (`{ collection, chainId, tokenId, owner, isBurned }`,
owner = `to` of the latest transfer, excluding burns) or a dedicated
`TrackedToken { collectionKey, chainId, contract, tokenId, owner }`.

Acceptance: `Token(where: {collection: {_eq: "0x6666…420"}, owner: {_eq: <addr>}})`
returns the holder's current tokenIds; counts reconcile with `TrackedHolder.tokenCount`.

## Inventory activation (DONE — DEP-2, 2026-05-24)

`src/live-sonar.ts` isolated the live queries; the activation is now wired:

- `liveOwnerTokenIds(address, contractLower)` queries the new `Token` index:
  `Token(where: {collection: {_eq}, owner: {_eq}, isBurned: {_eq: false}}) { tokenId }`.
- `liveCandiesBalances(address)` covers the ERC-1155 (Candies) case via
  `CandiesHolderBalance(where: {holder_id: {_eq}, amount: {_gt: "0"}}) { contract tokenId amount }`.
- The live `getHoldings` branch now populates real `tokenIds` (fail-soft: a missing
  `Token` sub-query degrades `tokenIds` to `[]` while keeping the real `tokenCount`;
  a fully-unreachable endpoint degrades to fixture holdings + a `degraded` envelope).
- `getNftsForOwner` is backed by `liveOwnerTokenIds` in live mode (joining codex
  metadata), and fail-softs to fixtures when the index is unreachable.

Hermetic coverage: `tests/live-ownership.test.ts` exercises these paths offline by
stubbing `fetch` with the known belt schema shapes (the belt-factory branch is not
yet deployed/reindexed, so no live endpoint exists to verify against yet).

### Unverified / open

- **Candies filter field.** The DEP-2 spec documents the holder filter as the Hasura
  relationship key `holder_id`; if the deployed schema names it `holder`, change only
  `CANDIES_HOLDER_FILTER_FIELD` in `src/live-sonar.ts`. `liveCandiesBalances` is wired
  and tested but NOT yet surfaced in `getHoldings`/`getNftsForOwner` (Candies is a
  distinct collection; surfacing it is a follow-up once the contract address +
  collectionKey are registered the way Mibera is).
- **Live reconciliation.** `tokenIds.length` should reconcile with
  `TrackedHolder.tokenCount`; confirm once the belt is live (`live-smoke` test).
