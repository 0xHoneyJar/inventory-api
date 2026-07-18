import { toChecksumAddress, isValidAddress, type ChainType } from "./address.js";

/** @deprecated Prefer ChainType from address.js */
export type CollectionVm = ChainType;

export type MetadataStrategy =
  | { kind: "codex" }
  | { kind: "sovereign"; slug: string }
  | { kind: "sovereign-world" }
  // Third-party / "proxy" resolution (INV-A) — points at the collection's OWN
  // tokenURI + metadata host (src/tokenuri-metadata.ts) instead of our CDN.
  // Used for collections whose license forbids us from re-hosting their art.
  // EVM ONLY: it resolves `tokenURI(uint256)` via `eth_call`. There is no SVM
  // equivalent here (a Metaplex mint's JSON lives on its metadata account, not
  // behind an EVM call) — see `unresolved` below.
  | { kind: "tokenuri" }
  // Pass-through to sonar's OWN resolved image URL (PYTH-2). sonar's
  // `svm_collection_nft` now publishes `image` (Helius DAS
  // `content.links.image`) + `uri` (json_uri) directly — inventory-api does
  // ZERO network fetch for this strategy: no RPC, no Metaplex
  // metadata-account read, no IPFS call of its own. It returns whatever
  // image URL sonar already resolved (or no image, if sonar has none for
  // that mint yet). SVM-only today (Pythenians) — sonar is the one that
  // reads Helius DAS; inventory only consumes what it publishes, per the
  // belt model (closer-to-raw publishes, closer-to-meaning consumes).
  | { kind: "sonar-image" }
  // Off-chain badge factory (br-badges-as-inventory-bzi.1) — federates
  // activities-api grant authority into Alchemy/SimpleHash-class NFT rows.
  // No EVM contract until mint-api + Sonar graduate the factory on-chain
  // (`evmContracts` omitted; route id is the alias, e.g. `mibera-badges`).
  | { kind: "badge-grant" }
  // NO WORKING METADATA SOURCE — declared, not pretended (INV-A).
  //
  // A row lands here when we cannot mirror the art (no rights) AND cannot point
  // at it either (no resolver we can actually run). Resolution returns the
  // tokens with their real ids and real names but NO image, and says so in the
  // log — which is what the code ALREADY did for such a row, except silently
  // and after burning a 404 round-trip per token against a CDN that holds
  // nothing. An honest broken row beats a silently wrong one.
  //
  // `reason` is required: a row cannot enter this state without stating why,
  // so the next person finds the actual blocker instead of re-deriving it.
  | { kind: "unresolved"; reason: string };

/**
 * Legal/rights gate on how a collection's art may be served (INV-A).
 *
 * - `"mirror"` — we hold the rights and copy the art onto OUR storage-api CDN
 *   (`metadataStrategy: "sovereign" | "sovereign-world"`). Must be set
 *   EXPLICITLY, by a human, per collection — never inferred.
 * - `"proxy"` — we do NOT hold the rights; we point at the collection's own
 *   metadata source instead (`metadataStrategy: "tokenuri"`). This is the
 *   DEFAULT (see `effectiveRehostPolicy`) — every future onboard is proxy
 *   unless a human explicitly flips it, which is the point: a collection must
 *   be MECHANICALLY INCAPABLE of entering the mirror (re-hosted) path without
 *   that explicit flag. See `assertRehostPolicyInvariant` below, which is the
 *   enforcement site (runs at module load against the real registry).
 * - `"excluded"` — no metadata resolution offered (reserved; unused today).
 */
export type RehostPolicy = "mirror" | "proxy" | "excluded";

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
  /** Sovereign metadata host world segment (`metadata.0xhoneyjar.xyz/{worldSlug}/…`). Unused by `metadataStrategy: "tokenuri"` rows. */
  worldSlug: string;
  /** Sovereign metadata slug; `null` = world namesake route (`/{world}/{tokenId}`). Unused by `metadataStrategy: "tokenuri"` rows. */
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
  /**
   * Rehost/rights policy (INV-A). Omit to get the default (`"proxy"`) — see
   * `effectiveRehostPolicy`. Set explicitly to `"mirror"` ONLY when a human
   * has confirmed we hold the rights to re-host this collection's art.
   */
  rehost_policy?: RehostPolicy;
  /**
   * Hostname(s) this collection's resolved images are served from (PYTH-2) —
   * the seam a dashboard image-optimizer allowlists (e.g. Next's
   * `images.remotePatterns`). `undefined` when a row has not published one —
   * and the `/collections` projection then OMITS the key entirely (never
   * emits an explicit `null`; see `CollectionSummary.imageHost`). This is a
   * STATIC per-row value — it does not fit a collection whose gateway host is
   * environment-driven at runtime (e.g. Azuki's `IPFS_GATEWAY_HOST`); such
   * rows are left unset here rather than baking in a value that can drift from
   * the actual env var.
   */
  imageHost?: readonly string[];
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
  metadataStrategy: MetadataStrategy;
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

/** Mad Lads — SVM external collection. Sonar collection_key is "mad_lads". */
export const MAD_LADS_COLLECTION_MINT =
  "J1S9H3QjnRtBbbuD4HjPV6RpRhwuk4zKbxsnCHuTgh9w";
export const MAD_LADS_COLLECTION_KEY = "mad_lads";

/** Purupuru — EVM on Base (8453). */
export const PURUPURU_CONTRACT = "0x6CfB9280767a3596Ee6af887D900014a755ffc75";

/** Azuki — third-party (proxy). EVM on Ethereum mainnet (1). INV-A. */
export const AZUKI_CONTRACT = "0xED5AF388653567Af2F388E6224dC7C4b3241C544";
export const AZUKI_CHAIN_ID = 1;

/** Off-chain badge factory alias — address null until mint-api lands. */
export const MIBERA_BADGES_COLLECTION_ID = "mibera-badges";
export const MIBERA_BADGES_COLLECTION_KEY = "mibera-badges";
// Verified against sonar's src/handlers/tracked-erc721/constants.ts on
// origin/main (2026-07-13) — the local sonar-api checkout was stale and
// showed an older doc revision; grounded against origin/main, not the
// working tree, per this cycle's stale-checkout lesson.
export const AZUKI_COLLECTION_KEY = "azuki";

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
    rehost_policy: "mirror",
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
    rehost_policy: "mirror",
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
    rehost_policy: "mirror",
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
    rehost_policy: "mirror",
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
    rehost_policy: "mirror",
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
    rehost_policy: "mirror",
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
    // RESOLVED via sonar pass-through (PYTH-2, 2026-07-13).
    //
    // History: this row declared `{ kind: "sovereign", slug: "pythians" }`
    // since INV-3 — fiction, the sovereign host 404s on every pythenians path
    // (probed live). INV-A (same day) flipped it to `{ kind: "unresolved" }`:
    // we do not hold the rights to mirror it (operator: "Mibera is our
    // community and Purupuru as well, we own these. Pythenians and future
    // ones, unless I ask to flag it, we don't own"), and at the time sonar's
    // `svm_collection_nft` published no `uri`/`image` to proxy to either —
    // only { collection_key, collection_mint, compressed, delegate, id, name,
    // nft_mint, owner, slot, source, updated_at }.
    //
    // PYTH-1 closed that gap upstream: sonar now reads Helius DAS
    // (`content.links.image` / `content.json_uri`) into `svm_collection_nft`
    // as `image` / `uri` — option (a) from the INV-A comment ("sonar adds
    // `uri`/`image` ... this row becomes a real SVM proxy arm"). inventory-api
    // is a PURE pass-through of `image`: no RPC, no Metaplex read, no IPFS
    // fetch of its own (see `getExternalNftsForOwner`'s `sonar-image` arm).
    // `rehost_policy` stays "proxy" — we still do not own this art, we just
    // point at sonar's already-resolved pointer instead of re-deriving it.
    //
    // CAVEAT (2026-07-13, PYTH-2): sonar's `image` column is empty in
    // PRODUCTION until the operator re-runs the indexer post-PYTH-1-merge —
    // this row is code-correct but will not show real images live until that
    // reindex lands (see PYTH-2 handoff for the verification curl to run
    // once it does).
    metadataStrategy: { kind: "sonar-image" },
    external: true,
    enabled: true,
    svmCollectionMint: PYTHIANS_COLLECTION_MINT,
    rehost_policy: "proxy",
    // The seam a dashboard image-optimizer allowlists (e.g. Next's
    // images.remotePatterns) — sonar's `image` values are all
    // ipfs.pythenians.xyz URLs (Pythenians' own IPFS gateway, per the DAS
    // fixture this row was verified against).
    imageHost: ["ipfs.pythenians.xyz"],
  },
  {
    id: MAD_LADS_COLLECTION_MINT,
    chain: "svm",
    chainId: 101,
    collectionKey: MAD_LADS_COLLECTION_KEY,
    worldSlug: "mad-lads",
    metadataSlug: "mad-lads",
    name: "Mad Lads",
    symbol: "",
    totalSupply: 10_000,
    aliases: ["mad_lads", "mad-lads", "madlads"],
    // Third-party art: pass through Sonar's DAS-resolved pointer only. The
    // ownership query is constrained by both owner + collection_key before
    // this strategy sees a token, so Inventory never becomes a public mirror.
    metadataStrategy: { kind: "sonar-image" },
    external: true,
    enabled: true,
    svmCollectionMint: MAD_LADS_COLLECTION_MINT,
    rehost_policy: "proxy",
    // Published for Dashboard's build-time next/image allowlist. Exact host
    // observed on every row in the live Mad Lads DAS snapshot.
    imageHost: ["madlads.s3.us-west-2.amazonaws.com"],
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
    // Ours (operator: "Mibera is our community and Purupuru as well, we own
    // these"), and the sovereign route genuinely serves it — verified live:
    // /purupuru/genesis/1 -> 200. Note it is a PARTIAL mirror: we host the
    // JSON, but its `image` points at ipfs.io, so the art itself was never
    // mirrored. That is fine (we hold the rights either way) — just don't read
    // "mirror" as "every byte is on our CDN".
    rehost_policy: "mirror",
  },
  {
    id: AZUKI_CONTRACT,
    chain: "evm",
    chainId: AZUKI_CHAIN_ID,
    collectionKey: AZUKI_COLLECTION_KEY,
    // worldSlug/metadataSlug are unused by the "tokenuri" strategy (no
    // sovereign-CDN route exists for this row) — kept populated for shape
    // parity with other ExternalCollection rows, never dereferenced.
    worldSlug: "azuki",
    metadataSlug: null,
    name: "Azuki",
    symbol: "AZUKI",
    totalSupply: 10_000,
    aliases: ["azuki"],
    metadataStrategy: { kind: "tokenuri" },
    external: true,
    enabled: true,
    evmContracts: [AZUKI_CONTRACT],
    // rehost_policy intentionally omitted — proves the "proxy" DEFAULT
    // (effectiveRehostPolicy) rather than setting it explicitly. We do not
    // hold rights to Azuki's art; see src/tokenuri-metadata.ts.
  },
  // Badge factory — off-chain grants first (activities-api), on-chain later
  // (mint-api + Sonar). No evmContracts until the factory address exists;
  // route id / alias is `mibera-badges` (dashboard Kitchen sibling card).
  {
    id: MIBERA_BADGES_COLLECTION_ID,
    chain: "evm",
    chainId: MIBERA_CHAIN_ID,
    collectionKey: MIBERA_BADGES_COLLECTION_KEY,
    worldSlug: "mibera",
    metadataSlug: "badges",
    name: "Mibera Badges",
    symbol: "BADGE",
    totalSupply: 0,
    aliases: [MIBERA_BADGES_COLLECTION_KEY, "mibera-badge"],
    metadataStrategy: { kind: "badge-grant" },
    external: false,
    enabled: true,
    // Art lives on assets.0xhoneyjar.xyz (we hold rights); federation points
    // at the grant URI rather than re-hosting — proxy posture is correct.
  },
];

// Fail-safe: a collection must be MECHANICALLY INCAPABLE of entering the
// mirror (our-CDN, re-hosted) path without an explicit `rehost_policy:
// "mirror"` flag. Runs at import time against the real registry — a bad row
// breaks the module load rather than silently shipping a legal exposure.
assertRehostPolicyInvariant(COLLECTION_REGISTRY);

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
    metadataStrategy: entry.metadataStrategy,
    evmContract: entry.evmContracts?.[0],
    svmCollectionMint: entry.svmCollectionMint,
  };
}

/** The rehost policy that actually governs a row — `"proxy"` when unset. */
export function effectiveRehostPolicy(entry: CollectionRegistryEntry): RehostPolicy {
  return entry.rehost_policy ?? "proxy";
}

/**
 * Fail-safe enforcement (INV-A): a row whose `metadataStrategy` mirror-hosts
 * art on OUR CDN (`"sovereign"` / `"sovereign-world"`) MUST carry an explicit
 * `rehost_policy: "mirror"` — the default (`"proxy"`) is refused. Symmetric
 * check the other way too: `"mirror"` must describe a strategy that actually
 * mirrors, so the field can't be set to paper over a proxy/pointer row.
 *
 * Exported (not just called at module load) so tests can prove the refusal
 * directly against a hand-built row, without needing to corrupt the real
 * private registry array to do it.
 */
export function assertRehostPolicyInvariant(
  entries: readonly CollectionRegistryEntry[]
): void {
  for (const entry of entries) {
    const mirrorHosted =
      entry.metadataStrategy.kind === "sovereign" ||
      entry.metadataStrategy.kind === "sovereign-world";
    const policy = effectiveRehostPolicy(entry);

    if (mirrorHosted && policy !== "mirror") {
      throw new Error(
        `collection registry row "${entry.id}" (${entry.collectionKey}) uses a mirror-hosted ` +
          `metadataStrategy ("${entry.metadataStrategy.kind}") but rehost_policy is "${policy}", ` +
          `not explicit "mirror". A collection must be mechanically incapable of entering the ` +
          `mirror (re-hosted, our-CDN) path without an explicit human-set rehost_policy: "mirror".`
      );
    }
    if (!mirrorHosted && policy === "mirror") {
      throw new Error(
        `collection registry row "${entry.id}" (${entry.collectionKey}) sets rehost_policy: ` +
          `"mirror" but its metadataStrategy ("${entry.metadataStrategy.kind}") does not mirror-host ` +
          `anything — "mirror" must describe what the code actually does.`
      );
    }
  }
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

/**
 * Public, dashboard-facing projection of ONE registry row (the `GET /collections`
 * shape). The dashboard resolves each community's contract from this — so `id`
 * is the primary route key (EVM checksum contract, or SVM collection mint), and
 * `aliases` carries the alternate keys (`"azuki"`, `"pythians"`, …). No internal
 * fields (worldSlug/metadataSlug/evmContracts) — just what a consumer needs to
 * address a collection and know its rendering posture.
 */
export interface CollectionSummary {
  /** Primary route key: EVM checksum contract, or SVM collection mint. */
  id: string;
  aliases: readonly string[];
  chain: ChainType;
  chainId: number;
  name: string;
  symbol: string;
  /** Metadata resolution posture (sovereign/tokenuri/sonar-image/unresolved/…). */
  metadataStrategy: MetadataStrategy["kind"];
  /** EFFECTIVE rights policy — always concrete ("proxy" when unset), never undefined. */
  rehost_policy: RehostPolicy;
  /**
   * Hostname(s) this collection's resolved images are served from (PYTH-2) —
   * the seam a dashboard image-optimizer allowlists. OPTIONAL: a row without
   * one OMITS the key entirely — it is NEVER serialized as an explicit
   * `null`.
   *
   * This is a hard cross-repo wire contract, not a style choice. The
   * dashboard's PYTH-3 schema decodes `/collections` with
   * `Schema.optionalWith(Schema.Array(...), { default })`, which tolerates the
   * key being ABSENT but REJECTS an explicit `null`. Because effect Schema
   * decodes the whole array, a single `null` row throws the ENTIRE decode →
   * `loadCollectionRegistry()` returns `[]` → every community's PFP path
   * (slug→contract) blanks to identicons — not just the null row. So the
   * omit-not-null shape here is what keeps the whole roster rendering. The
   * `imageHost?` optionality (vs `| null`) makes that omission type-enforced,
   * not merely a runtime convention.
   */
  imageHost?: readonly string[];
}

function entryToSummary(entry: CollectionRegistryEntry): CollectionSummary {
  return {
    id: entry.id,
    aliases: entry.aliases,
    chain: entry.chain,
    chainId: entry.chainId,
    name: entry.name,
    symbol: entry.symbol,
    metadataStrategy: entry.metadataStrategy.kind,
    rehost_policy: effectiveRehostPolicy(entry),
    // OMIT the key when the row has no imageHost — do NOT emit `null`. See the
    // CollectionSummary.imageHost doc: an explicit `null` throws PYTH-3's whole
    // /collections decode and blanks EVERY community's avatars, not just this
    // row. Present-with-array or absent — never present-with-null.
    ...(entry.imageHost && entry.imageHost.length > 0
      ? { imageHost: entry.imageHost }
      : {}),
  };
}

/**
 * The `GET /collections` projection — every ENABLED registry row as a
 * `CollectionSummary`. Disabled rows are withheld (a consumer must not resolve
 * against a collection the service will reject). Stable order = registry order.
 */
export function listPublicCollections(): CollectionSummary[] {
  return COLLECTION_REGISTRY.filter((e) => e.enabled).map(entryToSummary);
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
