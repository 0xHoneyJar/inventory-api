import { toChecksumAddress, isValidAddress, type ChainType } from "./address.js";

/** @deprecated Prefer ChainType from address.js */
export type CollectionVm = ChainType;

export type MetadataStrategy =
  | { kind: "codex" }
  | { kind: "sovereign"; slug: string }
  | { kind: "sovereign-world" };

/**
 * Collection registry v2 row — one logical collection in inventory-api.
 * Issue #19 / member-pfp cluster: chain type, sonar collection_key, sovereign
 * world + metadata slugs, and how `:contract` route params resolve.
 */
export interface CollectionRegistryEntry {
  /** Primary `:contract` route key (EVM checksum or SVM collection mint). */
  id: string;
  chain: ChainType;
  chainId: number;
  /** Belt-gateway TrackedHolder / svm_collection_nft collection_key. */
  collectionKey: string;
  /** Sovereign metadata host world segment (`metadata.0xhoneyjar.xyz/{worldSlug}/…`). */
  worldSlug: string;
  /** Sovereign metadata slug; `null` = world namesake route (`/{world}/{tokenId}`). */
  metadataSlug: string | null;
  name: string;
  symbol: string;
  totalSupply: number;
  aliases: readonly string[];
  metadataStrategy: MetadataStrategy;
  /** When true, holdings resolve via external/community path (not legacy mibera codex). */
  external: boolean;
  /** When false, route resolves in registry but getNftsForOwner rejects until upstream lands. */
  enabled: boolean;
  /** Registered EVM contract address(es) — checksum form at rest. */
  evmContracts?: readonly string[];
  /** SVM Metaplex collection mint when chain === "svm". */
  svmCollectionMint?: string;
}

/** External/community collection shape consumed by getNftsForOwner external path. */
export interface ExternalCollection {
  id: string;
  aliases: readonly string[];
  vm: CollectionVm;
  chainId: number;
  name: string;
  symbol: string;
  totalSupply: number;
  sonarCollectionKey: string;
  metadataWorld: string;
  metadataSlug: string;
  evmContract?: string;
  svmCollectionMint?: string;
}

// ── Mibera sovereign (Berachain 80094) ─────────────────────────────────────

export const MIBERA_CONTRACT = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
export const MIBERA_CHAIN_ID = 80094;
export const MIBERA_COLLECTION_KEY = "mibera";

export const MST_CONTRACT = "0x048327a187b944ddac61c6e202bfccd20d17c008";
export const CANDIES_CONTRACT = "0xecA03517c5195F1edD634DA6D690D6c72407c40c";
export const TAROT_CONTRACT = "0x4B08a069381EfbB9f08C73D6B2e975C9BE3c4684";
export const GIF_CONTRACT = "0x230945E0Ed56EF4dE871a6c0695De265DE23D8D8";

export const FRACTURED_ADDRESSES = [
  "0x86Db98cf1b81E833447b12a077ac28c36b75c8E1",
  "0x8D4972bd5D2df474e71da6676a365fB549853991",
  "0x144B27b1A267eE71989664b3907030Da84cc4754",
  "0x72DB992E18a1bf38111B1936DD723E82D0D96313",
  "0x3A00301B713be83EC54B7B4Fb0f86397d087E6d3",
  "0x419F25C4f9A9c730AAcf58b8401B5b3e566Fe886",
  "0x81A27117bd894942BA6737402fB9e57e942C6058",
  "0xaaB7b4502251aE393D0590bAB3e208E2d58F4813",
  "0xc64126EA8dC7626c16daA2A29D375C33fcaa4C7c",
  "0x24F4047d372139de8DACbe79e2fC576291Ec3ffc",
] as const;

// ── External / community (Issue #19 placeholders — enabled when sonar + STOR-1 land) ──

/** Pythenians — SVM. Gateway collection_key is the legacy soju key "pythians". */
export const PYTHIANS_COLLECTION_MINT =
  "pyTh2UtBKfuDW6KCdT3swospYeoLmmKaGujWA91Moru";

/** Purupuru — EVM on Base (8453). */
export const PURUPURU_CONTRACT = "0x6CfB9280767a3596Ee6af887D900014a755ffc75";

const COLLECTION_REGISTRY: CollectionRegistryEntry[] = [
  {
    id: MIBERA_CONTRACT,
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: MIBERA_COLLECTION_KEY,
    worldSlug: "mibera",
    metadataSlug: null,
    name: "Mibera",
    symbol: "MIBERA",
    totalSupply: 10_000,
    aliases: [MIBERA_COLLECTION_KEY],
    metadataStrategy: { kind: "sovereign-world" },
    external: false,
    enabled: true,
    evmContracts: [MIBERA_CONTRACT],
  },
  {
    id: MST_CONTRACT,
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: "mst",
    worldSlug: "mibera",
    metadataSlug: "mst",
    name: "Mibera Shadow",
    symbol: "MST",
    totalSupply: 10_000,
    aliases: ["mst"],
    metadataStrategy: { kind: "sovereign", slug: "mst" },
    external: false,
    enabled: true,
    evmContracts: [MST_CONTRACT],
  },
  {
    id: CANDIES_CONTRACT,
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: "candies",
    worldSlug: "mibera",
    metadataSlug: "candies",
    name: "Candies",
    symbol: "CANDY",
    totalSupply: 10_000,
    aliases: ["candies"],
    metadataStrategy: { kind: "sovereign", slug: "candies" },
    external: false,
    enabled: true,
    evmContracts: [CANDIES_CONTRACT],
  },
  {
    id: TAROT_CONTRACT,
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: "tarot",
    worldSlug: "mibera",
    metadataSlug: "tarot",
    name: "Tarot",
    symbol: "TAROT",
    totalSupply: 10_000,
    aliases: ["tarot"],
    metadataStrategy: { kind: "sovereign", slug: "tarot" },
    external: false,
    enabled: true,
    evmContracts: [TAROT_CONTRACT],
  },
  {
    id: GIF_CONTRACT,
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: "gif",
    worldSlug: "mibera",
    metadataSlug: "gif",
    name: "Mibera GIF",
    symbol: "GIF",
    totalSupply: 347,
    aliases: ["gif"],
    metadataStrategy: { kind: "sovereign", slug: "gif" },
    external: false,
    enabled: true,
    evmContracts: [GIF_CONTRACT],
  },
  {
    id: FRACTURED_ADDRESSES[0],
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: "fractures",
    worldSlug: "mibera",
    metadataSlug: "fractures",
    name: "Fractures",
    symbol: "FRAC",
    totalSupply: 10_000,
    aliases: ["fractures"],
    metadataStrategy: { kind: "sovereign", slug: "fractures" },
    external: false,
    enabled: true,
    evmContracts: [...FRACTURED_ADDRESSES],
  },
  {
    id: PYTHIANS_COLLECTION_MINT,
    chain: "svm",
    chainId: 101,
    collectionKey: "pythians",
    worldSlug: "pythenians",
    metadataSlug: "pythians",
    name: "Pythenians",
    symbol: "PTN",
    totalSupply: 3682,
    aliases: ["pythians", "pythenians"],
    metadataStrategy: { kind: "sovereign", slug: "pythians" },
    external: true,
    enabled: true,
    svmCollectionMint: PYTHIANS_COLLECTION_MINT,
  },
  {
    id: PURUPURU_CONTRACT,
    chain: "evm",
    chainId: 8453,
    collectionKey: "purupuru",
    worldSlug: "purupuru",
    metadataSlug: "genesis",
    name: "Purupuru",
    symbol: "PURU",
    totalSupply: 29,
    aliases: ["purupuru"],
    metadataStrategy: { kind: "sovereign", slug: "genesis" },
    external: true,
    enabled: true,
    evmContracts: [PURUPURU_CONTRACT],
  },
];

function entryToExternal(entry: CollectionRegistryEntry): ExternalCollection {
  return {
    id: entry.id,
    aliases: entry.aliases,
    vm: entry.chain,
    chainId: entry.chainId,
    name: entry.name,
    symbol: entry.symbol,
    totalSupply: entry.totalSupply,
    sonarCollectionKey: entry.collectionKey,
    metadataWorld: entry.worldSlug,
    metadataSlug: entry.metadataSlug ?? entry.collectionKey,
    evmContract: entry.evmContracts?.[0],
    svmCollectionMint: entry.svmCollectionMint,
  };
}

function buildRouteIndex(): Map<string, CollectionRegistryEntry> {
  const map = new Map<string, CollectionRegistryEntry>();
  for (const entry of COLLECTION_REGISTRY) {
    map.set(entry.id, entry);
    if (entry.evmContracts) {
      for (const addr of entry.evmContracts) {
        map.set(toChecksumAddress(addr), entry);
      }
    }
    if (entry.svmCollectionMint) {
      map.set(entry.svmCollectionMint, entry);
    }
    for (const alias of entry.aliases) {
      map.set(alias, entry);
      map.set(alias.toLowerCase(), entry);
    }
  }
  return map;
}

function buildMetadataIndex(): Map<string, MetadataStrategy> {
  const map = new Map<string, MetadataStrategy>();
  for (const entry of COLLECTION_REGISTRY) {
    if (entry.evmContracts) {
      for (const addr of entry.evmContracts) {
        map.set(toChecksumAddress(addr), entry.metadataStrategy);
      }
    }
  }
  return map;
}

const _byRoute = buildRouteIndex();
const _metadataByContract = buildMetadataIndex();

/** All v2 registry rows (mibera sovereign + external placeholders). */
export function listCollectionRegistry(): readonly CollectionRegistryEntry[] {
  return COLLECTION_REGISTRY;
}

/** Resolve any `:contract` route param to a registry row, if known. */
export function resolveCollectionRouteParam(param: string): CollectionRegistryEntry | null {
  if (_byRoute.has(param)) {
    return _byRoute.get(param)!;
  }
  if (isValidAddress(param)) {
    return _byRoute.get(toChecksumAddress(param)) ?? null;
  }
  return _byRoute.get(param.toLowerCase()) ?? null;
}

/** Metadata strategy for a checksummed EVM contract (mibera sovereign path). */
export function resolveMetadataStrategy(
  checksummedContract: string
): MetadataStrategy | null {
  return _metadataByContract.get(checksummedContract) ?? null;
}

/** True when the contract is a registered mibera sovereign collection (not external). */
export function isRegisteredMiberaContract(checksummedContract: string): boolean {
  const entry = resolveCollectionRouteParam(checksummedContract);
  return entry !== null && !entry.external && entry.enabled;
}

/** Resolve a `:contract` route param to an enabled external collection. */
export function resolveExternalCollection(contractOrAlias: string): ExternalCollection | null {
  const entry = resolveCollectionRouteParam(contractOrAlias);
  if (!entry || !entry.external || !entry.enabled) {
    return null;
  }
  return entryToExternal(entry);
}

export function listExternalCollections(): readonly ExternalCollection[] {
  return COLLECTION_REGISTRY.filter((e) => e.external && e.enabled).map(entryToExternal);
}
