import * as sonarClient from "./sonar-client.js";
import * as codexClient from "./codex-client.js";
import * as liveSonar from "./live-sonar.js";
import * as svmSonarClient from "./svm-sonar-client.js";
import {
  codexToMetadataDocument,
  metadataDocumentToNFT,
  DEFAULT_CONTENT_TYPE,
} from "./transform.js";
import { buildEnvelope, buildEnvelopeLive } from "./completeness.js";
import { applyPagination } from "./pagination.js";
import {
  toChecksumAddress,
  isValidAddress,
  validateWalletAddress,
  validateEvmAddress,
} from "./address.js";
import {
  shouldUseSonarFixtureFallback,
  warnSonarLiveEmpty,
} from "./sonar-fallback.js";
import { ValidationError, NotFoundError } from "./errors.js";
import {
  fetchSovereignMetadata,
  warnSovereignMetadataDegraded,
  METADATA_FETCH_CONCURRENCY,
  METADATA_PAGE_BUDGET_MS,
} from "./sovereign-metadata.js";
import {
  fetchTokenUriMetadata,
  warnTokenUriMetadataDegraded,
} from "./tokenuri-metadata.js";
import { mapWithConcurrency } from "./concurrency.js";
import {
  resolveExternalCollection,
  resolveCollectionRouteParam,
  resolveMetadataStrategy,
  isRegisteredMiberaContract,
  MIBERA_CONTRACT,
  MIBERA_CHAIN_ID,
  MIBERA_COLLECTION_KEY,
  type ExternalCollection,
} from "./collection-registry.js";
import type {
  HoldingsResponse,
  ContractHolding,
  NFTCollection,
  MetadataDocument,
  NFT,
  GetHoldingsOptions,
  GetNftsForOwnerOptions,
} from "../types.js";

export async function getHoldings(
  address: string,
  options: GetHoldingsOptions = {}
): Promise<HoldingsResponse> {
  const checksummedAddress = validateEvmAddress(address, "address");

  if (options.contracts) {
    for (const c of options.contracts) {
      if (!isValidAddress(c)) {
        throw new ValidationError("contracts", c, "0x-prefixed 40-char hex string");
      }
    }
  }

  if (options.chains) {
    for (const c of options.chains) {
      if (!Number.isInteger(c) || c <= 0) {
        throw new ValidationError("chains", c, "positive integer");
      }
    }
  }

  const targetContracts = options.contracts
    ? options.contracts.map((c) => toChecksumAddress(c))
    : [MIBERA_CONTRACT];

  if (liveSonar.isLiveMode()) {
    const completeness = await buildEnvelopeLive(
      MIBERA_CONTRACT,
      MIBERA_CHAIN_ID,
      MIBERA_COLLECTION_KEY
    );
    const liveHoldings: ContractHolding[] = [];
    for (const contractAddress of targetContracts) {
      const chainId = options.chains?.[0] ?? MIBERA_CHAIN_ID;

      let count: number;
      try {
        count = await liveSonar.liveHolderTokenCount(
          checksummedAddress,
          MIBERA_COLLECTION_KEY
        );
      } catch {
        const tokens = sonarClient.getTokensByOwner(
          checksummedAddress,
          contractAddress,
          chainId
        );
        if (tokens.length === 0) continue;
        liveHoldings.push({
          contractAddress,
          chainId,
          tokenCount: tokens.length,
          tokenIds: tokens.map((t) => t.tokenId),
        });
        continue;
      }

      if (count === 0) continue;
      let tokenIds: string[] = [];
      try {
        tokenIds = await liveSonar.liveOwnerTokenIds(checksummedAddress, contractAddress);
      } catch {
        tokenIds = [];
      }
      liveHoldings.push({ contractAddress, chainId, tokenCount: count, tokenIds });
    }
    return { holdings: liveHoldings, completeness };
  }

  const holdings: ContractHolding[] = [];

  for (const contractAddress of targetContracts) {
    const chainId = options.chains?.[0] ?? MIBERA_CHAIN_ID;
    const tokens = sonarClient.getTokensByOwner(checksummedAddress, contractAddress, chainId);
    if (tokens.length === 0) continue;

    holdings.push({
      contractAddress,
      chainId,
      tokenCount: tokens.length,
      tokenIds: tokens.map((t) => t.tokenId),
    });
  }

  const completeness = buildEnvelope(MIBERA_CONTRACT, MIBERA_CHAIN_ID);

  return { holdings, completeness };
}

interface SovereignTokenRef {
  /** Sovereign world segment (`metadata.0xhoneyjar.xyz/{world}/…`). */
  world: string;
  /** Collection slug; `null` resolves the world's namesake route. */
  slug: string | null;
  /** Carried only to populate NotFoundError with caller-facing identity. */
  contract: string;
  tokenId: string;
  numericTokenId: boolean;
  /** Name to present when metadata cannot be resolved. */
  fallbackName: string;
}

/** The fail-soft payload: a real tokenId with no renderable metadata. */
function imagelessNFT(ref: SovereignTokenRef): NFT {
  return {
    tokenId: ref.tokenId,
    name: ref.fallbackName,
    description: "",
    imageUrl: "",
    contentType: DEFAULT_CONTENT_TYPE,
    attributes: [],
  };
}

/**
 * Resolve one page of tokens against the sovereign storage-api.
 *
 * Fail-soft per token — one unresolvable token must not fail the whole page. The
 * two failure classes are NOT collapsed:
 *
 *   - `NotFoundError` (403 unminted / 404 absent) — the token legitimately has no
 *     metadata. Expected, and silent.
 *   - anything else (5xx, timeout, network) — upstream is degraded. Counted, and
 *     warned about exactly once for the page. Both return an imageless NFT, so
 *     that one log line is the only thing that tells the two apart.
 *
 * Bounded twice over: `METADATA_FETCH_CONCURRENCY` caps sockets opened at once,
 * and `METADATA_PAGE_BUDGET_MS` caps the page's total wall time. The per-fetch
 * timeout alone would not — 13 waves x 8s = 104s, past the 30s service timeout.
 */
async function resolveSovereignPage(
  refs: SovereignTokenRef[],
  label: string
): Promise<NFT[]> {
  if (refs.length === 0) return [];

  const pageBudget = AbortSignal.timeout(METADATA_PAGE_BUDGET_MS);
  let failed = 0;
  let skipped = 0;
  let firstError: unknown;

  const nfts = await mapWithConcurrency(refs, METADATA_FETCH_CONCURRENCY, async (ref) => {
    // The budget is already spent — don't open a socket just to have it aborted.
    if (pageBudget.aborted) {
      skipped += 1;
      return imagelessNFT(ref);
    }
    try {
      const doc = await fetchSovereignMetadata(
        ref.world,
        ref.slug,
        ref.contract,
        ref.tokenId,
        { numericTokenId: ref.numericTokenId, signal: pageBudget }
      );
      return metadataDocumentToNFT(ref.tokenId, doc);
    } catch (err) {
      if (err instanceof NotFoundError) return imagelessNFT(ref);
      failed += 1;
      if (firstError === undefined) firstError = err;
      return imagelessNFT(ref);
    }
  });

  if (failed > 0 || skipped > 0) {
    warnSovereignMetadataDegraded(label, { failed, skipped, total: refs.length }, firstError);
  }
  return nfts;
}

interface TokenUriRef {
  contract: string;
  chainId: number;
  tokenId: string;
  fallbackName: string;
}

function imagelessTokenUriNFT(ref: TokenUriRef): NFT {
  return {
    tokenId: ref.tokenId,
    name: ref.fallbackName,
    description: "",
    imageUrl: "",
    contentType: DEFAULT_CONTENT_TYPE,
    attributes: [],
  };
}

/**
 * Resolve one page of tokens against a third-party ("proxy") tokenURI source
 * (src/tokenuri-metadata.ts). Same fail-soft-per-token / bounded-concurrency /
 * page-budget contract as `resolveSovereignPage` above — see that function's
 * doc comment for the NotFoundError-vs-degraded distinction, which applies
 * identically here.
 */
async function resolveTokenUriPage(refs: TokenUriRef[], label: string): Promise<NFT[]> {
  if (refs.length === 0) return [];

  const pageBudget = AbortSignal.timeout(METADATA_PAGE_BUDGET_MS);
  let failed = 0;
  let skipped = 0;
  let firstError: unknown;

  const nfts = await mapWithConcurrency(refs, METADATA_FETCH_CONCURRENCY, async (ref) => {
    if (pageBudget.aborted) {
      skipped += 1;
      return imagelessTokenUriNFT(ref);
    }
    try {
      const doc = await fetchTokenUriMetadata(ref.contract, ref.chainId, ref.tokenId, {
        signal: pageBudget,
      });
      return metadataDocumentToNFT(ref.tokenId, doc);
    } catch (err) {
      if (err instanceof NotFoundError) return imagelessTokenUriNFT(ref);
      failed += 1;
      if (firstError === undefined) firstError = err;
      return imagelessTokenUriNFT(ref);
    }
  });

  if (failed > 0 || skipped > 0) {
    warnTokenUriMetadataDegraded(label, { failed, skipped, total: refs.length }, firstError);
  }
  return nfts;
}

/**
 * A collection has NO working metadata source and we know it (registry declared
 * `metadataStrategy: { kind: "unresolved" }`). Not a degradation — a standing,
 * declared defect. Says the `reason` every time so the blocker is in the log,
 * not just in a source comment nobody greps.
 */
function warnMetadataUnresolved(label: string, reason: string, tokenCount: number): void {
  if (tokenCount === 0) return;
  console.warn(
    `[inventory-api] metadata unresolved for ${label}; ` +
      `returning ${tokenCount} imageless NFT(s) (real ids + names, no art). ` +
      `This is a DECLARED defect, not an outage — reason: ${reason}`
  );
}

/**
 * Sort tokenIds ascending for "lowest token id held" selection
 * (getProfilePicture, INV-A) — but ONLY when EVERY id is a pure decimal
 * integer (true for every EVM tokenId in this registry, BigInt-safe against
 * arbitrarily large ids). SVM identifiers (e.g. Pythenians) are Metaplex
 * mint addresses, not ordinals — they have no "lowest" in any meaningful
 * sense, and sorting them lexicographically would silently change WHICH
 * token gets picked with no numeric-ID story behind it. A non-numeric (or
 * mixed) list is returned unchanged — same indexer/fixture order as before.
 */
function sortTokenIdsAscendingIfNumeric(tokenIds: string[]): string[] {
  if (!tokenIds.every((id) => /^\d+$/.test(id))) return tokenIds;
  return [...tokenIds].sort((a, b) => {
    const bigA = BigInt(a);
    const bigB = BigInt(b);
    return bigA < bigB ? -1 : bigA > bigB ? 1 : 0;
  });
}

async function getExternalNftsForOwner(
  address: string,
  col: ExternalCollection,
  options: GetNftsForOwnerOptions
): Promise<NFTCollection> {
  const owner = validateWalletAddress(col.vm, address, "address");

  let tokenIds: string[];
  let nameByTokenId = new Map<string, string | null>();
  // PYTH-2: sonar's resolved image URL, keyed by mint — populated only for
  // `col.vm === "svm"` rows. Passed straight through by the `sonar-image`
  // strategy arm below (zero fetch of our own).
  let imageByTokenId = new Map<string, string | null>();

  if (col.vm === "svm") {
    let rows: { nftMint: string; name: string | null; image: string | null }[] = [];
    if (liveSonar.isLiveMode()) {
      try {
        rows = await liveSonar.liveSvmNftsForOwner(owner, col.sonarCollectionKey);
      } catch (err) {
        if (shouldUseSonarFixtureFallback()) {
          rows = svmSonarClient.getSvmNftsByOwner(owner, col.sonarCollectionKey);
        } else {
          warnSonarLiveEmpty(`svm_collection_nft(${col.sonarCollectionKey})`, err);
        }
      }
    } else {
      rows = svmSonarClient.getSvmNftsByOwner(owner, col.sonarCollectionKey);
    }
    tokenIds = rows.map((r) => r.nftMint);
    nameByTokenId = new Map(rows.map((r) => [r.nftMint, r.name]));
    imageByTokenId = new Map(rows.map((r) => [r.nftMint, r.image]));
  } else {
    const evmContract = col.evmContract!;
    const checksummedContract = toChecksumAddress(evmContract);
    if (liveSonar.isLiveMode()) {
      try {
        tokenIds = await liveSonar.liveOwnerTokenIds(toChecksumAddress(owner), checksummedContract);
      } catch (err) {
        if (shouldUseSonarFixtureFallback()) {
          tokenIds = sonarClient
            .getTokensByOwner(toChecksumAddress(owner), checksummedContract, col.chainId)
            .map((t) => t.tokenId);
        } else {
          warnSonarLiveEmpty(`Token(${checksummedContract})`, err);
          tokenIds = [];
        }
      }
    } else {
      tokenIds = sonarClient
        .getTokensByOwner(toChecksumAddress(owner), checksummedContract, col.chainId)
        .map((t) => t.tokenId);
    }
  }

  // getProfilePicture-only: see GetNftsForOwnerOptions.sortTokenIds. Sorting
  // the FULL raw list before pagination — not the resolved page — is what
  // keeps this cheap: only the (already-bounded) page gets its metadata
  // resolved either way.
  if (options.sortTokenIds === "ascending") {
    tokenIds = sortTokenIdsAscendingIfNumeric(tokenIds);
  }

  const { page, nextPageKey } = applyPagination(
    tokenIds,
    options.pageSize ?? 100,
    options.pageKey
  );

  let nfts: NFT[];
  if (col.metadataStrategy.kind === "tokenuri") {
    nfts = await resolveTokenUriPage(
      page.map((tokenId) => ({
        contract: col.evmContract!,
        chainId: col.chainId,
        tokenId,
        fallbackName: nameByTokenId.get(tokenId) ?? tokenId,
      })),
      col.sonarCollectionKey
    );
  } else if (col.metadataStrategy.kind === "sovereign") {
    nfts = await resolveSovereignPage(
      page.map((tokenId) => ({
        world: col.metadataWorld,
        slug: col.metadataSlug,
        contract: col.id,
        tokenId,
        numericTokenId: col.vm === "evm",
        fallbackName: nameByTokenId.get(tokenId) ?? tokenId,
      })),
      col.metadataSlug ?? col.metadataWorld
    );
  } else if (col.metadataStrategy.kind === "sonar-image") {
    // PYTH-2: pure pass-through. sonar's svm_collection_nft already resolved
    // the image (Helius DAS content.links.image) — inventory-api does ZERO
    // network fetch here: no RPC, no Metaplex read, no IPFS call of its own.
    // Whatever sonar published for the mint IS the imageUrl; null/absent
    // stays imageless — same fail-soft floor as every other arm here (never
    // invent art sonar didn't hand us).
    nfts = page.map((tokenId) => ({
      tokenId,
      name: nameByTokenId.get(tokenId) ?? tokenId,
      description: "",
      imageUrl: imageByTokenId.get(tokenId) ?? "",
      contentType: DEFAULT_CONTENT_TYPE,
      attributes: [],
    }));
  } else if (col.metadataStrategy.kind === "unresolved") {
    // Declared-broken (Pythenians today). We know there is no metadata source
    // we can actually read, so DON'T pretend: skip the network entirely and
    // return the real tokenIds + real names (sonar publishes those) with no
    // image. Warned once per page — the visible outcome for a holder is what
    // it already was (no image), but it is now stated rather than arrived at
    // silently via a 404 per token against a CDN that holds nothing.
    warnMetadataUnresolved(col.sonarCollectionKey, col.metadataStrategy.reason, page.length);
    nfts = page.map((tokenId) => ({
      tokenId,
      name: nameByTokenId.get(tokenId) ?? tokenId,
      description: "",
      imageUrl: "",
      contentType: DEFAULT_CONTENT_TYPE,
      attributes: [],
    }));
  } else {
    // Unreachable today: no external row is "codex"/"sovereign-world".
    throw new Error(
      `external collection ${col.id} declares metadataStrategy "${col.metadataStrategy.kind}", ` +
        `unsupported by getExternalNftsForOwner`
    );
  }

  return {
    contractAddress: col.id,
    name: col.name,
    symbol: col.symbol,
    totalSupply: col.totalSupply,
    nfts,
    pageKey: nextPageKey,
  };
}

export async function getNftsForOwner(
  address: string,
  contract: string,
  options: GetNftsForOwnerOptions = {}
): Promise<NFTCollection> {
  const external = resolveExternalCollection(contract);
  if (external) {
    return getExternalNftsForOwner(address, external, options);
  }

  const checksummedAddress = validateEvmAddress(address, "address");
  const checksummedContract = validateEvmAddress(contract, "contract");
  if (!isRegisteredMiberaContract(checksummedContract)) {
    throw new ValidationError("contract", contract, "registered collection address");
  }
  // Guarded above: a registered contract always resolves to a registry row.
  const entry = resolveCollectionRouteParam(checksummedContract)!;
  const chainId = MIBERA_CHAIN_ID;

  let tokenIds: string[];
  if (liveSonar.isLiveMode()) {
    try {
      tokenIds = await liveSonar.liveOwnerTokenIds(checksummedAddress, checksummedContract);
    } catch {
      tokenIds = sonarClient
        .getTokensByOwner(checksummedAddress, checksummedContract, chainId)
        .map((t) => t.tokenId);
    }
  } else {
    tokenIds = sonarClient
      .getTokensByOwner(checksummedAddress, checksummedContract, chainId)
      .map((t) => t.tokenId);
  }

  // getProfilePicture-only: see GetNftsForOwnerOptions.sortTokenIds.
  if (options.sortTokenIds === "ascending") {
    tokenIds = sortTokenIdsAscendingIfNumeric(tokenIds);
  }

  const { page, nextPageKey } = applyPagination(
    tokenIds,
    options.pageSize ?? 100,
    options.pageKey
  );

  // Per-token metadata resolves through the SAME strategy resolver getNftMetadata
  // uses. The bundled codex fixture carries 55 of 10,000 tokens, so joining
  // against it silently blanked ~99.5% of real holdings (bug 20260709-499c5a).
  const strategy = entry.metadataStrategy;
  if (strategy.kind === "codex") {
    // Unreachable today: every registered non-external row is sovereign or
    // sovereign-world. Guard rather than fall through to the namesake route with the
    // wrong URL shape — and never resolve an owner-list against the codex fixture again.
    throw new Error(
      `registry row ${entry.id} declares metadataStrategy "codex", unsupported by getNftsForOwner`
    );
  }
  if (
    strategy.kind === "tokenuri" ||
    strategy.kind === "unresolved" ||
    strategy.kind === "sonar-image"
  ) {
    // Unreachable today: every registered "tokenuri" (Azuki) / "unresolved" /
    // "sonar-image" (Pythenians) row is external, handled by
    // getExternalNftsForOwner before this function is reached. Guard rather
    // than silently fall through to the sovereign URL shape.
    throw new Error(
      `registry row ${entry.id} declares metadataStrategy "${strategy.kind}", unsupported by ` +
        `getNftsForOwner's registered-collection path (external path only)`
    );
  }
  const slug = strategy.kind === "sovereign" ? strategy.slug : null;

  const nfts = await resolveSovereignPage(
    page.map((tokenId) => ({
      world: entry.worldSlug,
      slug,
      contract: checksummedContract,
      tokenId,
      numericTokenId: entry.chain === "evm",
      fallbackName: `${entry.name} #${tokenId}`,
    })),
    slug ?? entry.worldSlug
  );

  // Collection identity comes from the registry, not the codex fixture — whose
  // `collection` block only describes Mibera-main, so every other registered
  // sovereign collection previously threw a 400 here.
  return {
    contractAddress: checksummedContract,
    name: entry.name,
    symbol: entry.symbol,
    totalSupply: entry.totalSupply,
    nfts,
    pageKey: nextPageKey,
  };
}

export async function getProfilePicture(
  address: string,
  options: { contract?: string } = {}
): Promise<string | null> {
  const contract = options.contract ?? MIBERA_CONTRACT;
  // sortTokenIds: "ascending" + pageSize: 1 resolves the LOWEST held token
  // deterministically ("your Azuki #4442"), not whatever the indexer/fixture
  // happened to return first — see GetNftsForOwnerOptions.sortTokenIds.
  const collection = await getNftsForOwner(address, contract, {
    pageSize: 1,
    sortTokenIds: "ascending",
  });
  const first = collection.nfts[0];
  return first && first.imageUrl.length > 0 ? first.imageUrl : null;
}

export async function getNftMetadata(
  contract: string,
  tokenId: string
): Promise<MetadataDocument> {
  const checksummedContract = validateEvmAddress(contract, "contract");
  if (!/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }

  const entry = resolveCollectionRouteParam(checksummedContract);
  if (entry?.evmContracts?.length) {
    const strategy = entry.metadataStrategy;
    if (strategy.kind === "sovereign") {
      return fetchSovereignMetadata(
        entry.worldSlug,
        strategy.slug,
        checksummedContract,
        tokenId
      );
    }
    if (strategy.kind === "sovereign-world") {
      return fetchSovereignMetadata(
        entry.worldSlug,
        null,
        checksummedContract,
        tokenId
      );
    }
    if (strategy.kind === "tokenuri") {
      // Contain the error at this seam — the single-token path had no catch,
      // unlike the bulk owner-list path (resolveTokenUriPage). A NotFoundError
      // is the intentional 404; ANY other throw (RPC/network/parse) is
      // sanitized to a generic, detail-free error so nothing upstream — a
      // provider URL, an embedded API key — can ride a raw `.message` out
      // through toHyperError. fetchTokenUriMetadata already throws URL-free
      // after the RPC-leak fix; this is the same belt-and-suspenders the bulk
      // path has. (Deliberately NOT a blank-200 fail-soft: a single-token
      // lookup returning empty metadata would misreport a transient RPC blip as
      // "this token has no metadata"; the bulk path only fail-softs to protect
      // the OTHER tokens in a page, which does not apply to one token.)
      try {
        return await fetchTokenUriMetadata(checksummedContract, entry.chainId, tokenId);
      } catch (err) {
        if (err instanceof NotFoundError) throw err;
        throw new Error("token metadata resolution failed");
      }
    }
    if (strategy.kind === "unresolved") {
      // Declared-broken row. Not reachable for Pythenians (SVM — its mint is
      // not a valid EVM contract, so validateEvmAddress rejects it above), but
      // guard anyway: NEVER fall through to the codex fixture, which would
      // answer with Mibera metadata for someone else's collection.
      throw new NotFoundError(tokenId, contract);
    }
  }

  const strategy = resolveMetadataStrategy(checksummedContract) ?? { kind: "codex" };

  const record = codexClient.getToken(tokenId);
  if (!record) {
    throw new NotFoundError(tokenId, contract);
  }

  const imageUrl = codexClient.getImageUrl(tokenId) ?? "";
  const grailRecord = codexClient.getGrailRecord(tokenId);
  return codexToMetadataDocument(
    tokenId,
    record,
    imageUrl,
    codexClient.isGrail(tokenId),
    grailRecord
  );
}
