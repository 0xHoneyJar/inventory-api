# Sonar ownership gap — belt change request

**Status:** open · **Owner:** sonar (freeside-sonar belt-factory) · **Filed:** 2026-05-23

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

## Inventory activation (no further inventory change needed)

`src/live-sonar.ts` already isolates the live queries. When the index lands, add
`liveOwnerTokenIds(address, collectionKey)` and populate `tokenIds` in the live
`getHoldings` branch + back `getNftsForOwner` with it. Until then, live `getHoldings`
returns real `tokenCount` with `tokenIds: []`, and `getNftsForOwner` stays on fixtures.
