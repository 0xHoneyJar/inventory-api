# Collection registry v2

> **Coord task INV-1** — member-pfp cluster / Issue #19 foundation.  
> Implementation: `src/collection-registry.ts` · address gates: `src/address.ts`

inventory-api routes NFT reads by a `:contract` path parameter. Registry v2 is the single source of truth for how that parameter resolves: chain family, sonar `collection_key`, sovereign metadata world + slug, and wallet address validation rules.

## Row shape

```typescript
interface CollectionRegistryEntry {
  id: string;                    // primary route key
  chain: "evm" | "svm";
  chainId: number;               // EVM chain id or 101 for Solana mainnet-beta
  collectionKey: string;         // belt-gateway sonar key (TrackedHolder / svm_collection_nft)
  worldSlug: string;             // metadata.0xhoneyjar.xyz/{worldSlug}/…
  metadataSlug: string | null;   // null → world namesake route (no slug segment)
  name: string;
  symbol: string;
  totalSupply: number;
  aliases: readonly string[];    // alternate :contract values (e.g. "pythians", "pythenians")
  metadataStrategy: MetadataStrategy;
  external: boolean;             // true → community path (not legacy mibera codex gallery)
  enabled: boolean;              // false → registered but getNftsForOwner rejects until upstream lands
  evmContracts?: readonly string[];
  svmCollectionMint?: string;
}
```

### Metadata strategy (mibera sovereign only today)

| `kind` | Sovereign URL shape | Example |
|--------|---------------------|---------|
| `sovereign-world` | `/{worldSlug}/{tokenId}` | Mibera-main → `/mibera/7702` |
| `sovereign` | `/{worldSlug}/{metadataSlug}/{tokenId}` | MST → `/mibera/mst/234` |
| `codex` | (fallback) legacy codex fixture path | unregistered EVM contract |

External collections use sovereign URLs under their own `worldSlug` (see below); metadata strategy on the row documents the slug for `fetchSovereignMetadata`.

## Registered collections (2026-07-01)

### Mibera sovereign (EVM · chain 80094)

| collection_key | world_slug | metadata_slug | Route `:contract` | Notes |
|----------------|------------|---------------|-------------------|-------|
| `mibera` | `mibera` | *(null — namesake)* | `0x6666…c420` | 10k ERC-721 |
| `mst` | `mibera` | `mst` | `0x0483…c008` | Mibera Shadow |
| `candies` | `mibera` | `candies` | `0xecA0…c40c` | ERC-1155 |
| `tarot` | `mibera` | `tarot` | `0x4B08…4684` | Archetype / quiz |
| `gif` | `mibera` | `gif` | `0x2309…D8D8` | 347 reveal GIFs |
| `fractures` | `mibera` | `fractures` | any of 10 fracture contracts | one slug, ten contracts |

Fracture contract addresses are listed in `FRACTURED_ADDRESSES` inside `collection-registry.ts` (mirrors honeyroad `FRACTURED_ADDRESSES`).

### External / community placeholders (Issue #19)

| collection_key | chain | world_slug | metadata_slug | Route `:contract` | enabled |
|----------------|-------|------------|---------------|-------------------|---------|
| `pythians` | `svm` | `pythenians` | `pythians` | collection mint **or** alias `pythians` / `pythenians` | yes (hermetic fixtures) |
| `purupuru` | `evm` (8453) | `purupuru` | `genesis` | `0x6CfB…fc75` **or** alias `purupuru` | yes (empty holdings until sonar indexes Base) |

Set `enabled: false` on a row to keep registry documentation without serving the external path (awaiting STOR-1 sovereign host + live sonar index).

## `:contract` route param mapping

### EVM collections

- **Accepted forms:** EIP-55 checksummed `0x…` address, lowercase hex (normalized to checksum), or registered alias string (`mibera`, `purupuru`, …).
- **Response identity:** checksummed contract address for mibera sovereign rows; primary `id` for external EVM rows.
- **Sonar queries:** contract address lowercased for `Token` / `CandiesHolderBalance` filters (existing live-sonar convention).

### SVM collections

- **Accepted forms:** Metaplex collection mint (base58, case-sensitive), sonar `collection_key` (`pythians`), or community slug alias (`pythenians`).
- **Response identity:** collection mint (`id` on the registry row) — not the alias.
- **Token identity:** NFT mint address (base58 string), not a numeric token id.
- **Sonar queries:** `svm_collection_nft` filtered by `collection_key` + owner (INV-2); owner address is **verbatim base58** — never lowercased.

## Address validation rules

Implemented in `validateWalletAddress(chain, address, field)` (`src/address.ts`).

| Chain | Input | Validation | Normalization |
|-------|-------|------------|---------------|
| `evm` | wallet or contract | `^0x[0-9a-fA-F]{40}$` | EIP-55 checksum via keccak |
| `svm` | wallet (owner) | base58 `[1-9A-HJ-NP-Za-km-z]{32,44}` | **none** — return verbatim |

Existing EVM-only call sites use `validateEvmAddress` (alias for `validateWalletAddress("evm", …)`).

**Invariants (unchanged from pre-v2):**

- All EVM contract comparisons use checksum form after validation.
- SVM owner strings must not be case-normalized (mint addresses are case-sensitive).
- External SVM metadata fetch uses mint string token ids (`numericTokenId: false`).

## Resolution API (module exports)

| Function | Purpose |
|----------|---------|
| `resolveCollectionRouteParam(param)` | Any `:contract` value → full registry row or null |
| `resolveMetadataStrategy(checksummedContract)` | EVM contract → metadata strategy (mibera sovereign) |
| `isRegisteredMiberaContract(checksummedContract)` | Registered non-external mibera row |
| `resolveExternalCollection(param)` | Enabled external row → `ExternalCollection` view |
| `listCollectionRegistry()` | All rows |
| `listExternalCollections()` | External rows only |

## SVM ownership (INV-2)

| Function | Role |
|----------|------|
| `liveSvmNftsForOwner(owner, collectionKey)` | Live belt `svm_collection_nft` query — owner is **verbatim base58** |
| `getSvmNftsByOwner(owner, collectionKey)` | Hermetic fixture mirror of the same filter (`fixtures/sonar-svm-collection-nft.json`) |

`getNftsForOwner` external SVM path: live query when `SONAR_GRAPHQL_ENDPOINT` is set. On live failure, **non-production** environments (`NODE_ENV !== "production"`) or explicit `SONAR_FIXTURE_FALLBACK=1` may fall back to the hermetic fixture; **production** returns empty holdings and logs a warning (never synthetic fixture rows). Tests: `tests/live-svm-ownership.test.ts`, `tests/svm-sonar-client.test.ts`, `tests/sonar-fallback.test.ts`.

## Profile picture (INV-3)

`getProfilePicture(address, { contract })` resolves the first renderable NFT image for a wallet in a registered collection.

| Community | `contract` query param | Address form | Notes |
|-----------|---------------------|--------------|-------|
| Mibera (default) | *(omit)* or mibera contract | EVM `0x…` | Existing codex/sovereign path |
| Pythenians | `pythians` or collection mint | SVM base58 (case-sensitive) | Ownership via `svm_collection_nft`; image via sovereign `pythenians/pythians/{mint}` |
| Purupuru | `purupuru` or genesis contract | EVM `0x…` (Base) | Empty until sonar indexes Base + STOR-1 metadata lands |

HTTP: `GET /profile/:address?contract=pythians` · MCP tool `getProfilePicture`.

## Out of scope (follow-on coord tasks)

| Task | Scope |
|------|-------|
| **DASH-1** | freeside-dashboard BFF batch attach + wire `roles.ts` member rows |
| **STOR-1+** | Sovereign metadata host cutover for pythenians / purupuru worlds (spec landed storage-api#23) |

## Adding a collection

1. Add one `CollectionRegistryEntry` row in `src/collection-registry.ts`.
2. For mibera sovereign: set `evmContracts`, `metadataStrategy`, `collectionKey`, slugs.
3. For external SVM: set `svmCollectionMint`, `aliases` including sonar key, `external: true`.
4. Document the row in this file.
5. Do **not** add a new metadata fetch function — use `fetchSovereignMetadata(worldSlug, metadataSlug, …)` from `sovereign-metadata.ts`.
