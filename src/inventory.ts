import * as sonarClient from "./sonar-client.js";
import * as codexClient from "./codex-client.js";
import * as liveSonar from "./live-sonar.js";
import { codexToNFT, codexToMetadataDocument } from "./transform.js";
import { buildEnvelope, buildEnvelopeLive } from "./completeness.js";
import { applyPagination } from "./pagination.js";
import { toChecksumAddress, isValidAddress } from "./address.js";
import { ValidationError, NotFoundError } from "./errors.js";
import { fetchSovereignMetadata } from "./sovereign-metadata.js";
import type {
  HoldingsResponse,
  ContractHolding,
  NFTCollection,
  MetadataDocument,
  GetHoldingsOptions,
  GetNftsForOwnerOptions,
} from "../types.js";

const MIBERA_CONTRACT = "0x6666397DFe9a8c469BF65dc744CB1C733416c420";
const MIBERA_CHAIN_ID = 80094;
const MIBERA_COLLECTION_KEY = "mibera";

// Mibera Shadow (MST) — chain 80094. Metadata resolves via the SOVEREIGN
// storage-api route (src/sovereign-metadata.ts), NOT the Mibera-main codex.
const MST_CONTRACT = "0x048327a187b944ddac61c6e202bfccd20d17c008";

// Candies (Mibera "Drugs") — ERC-1155, chain 80094. Metadata resolves via the
// SOVEREIGN storage-api route under the "candies" slug (tokenId === honeyroad
// listings.id). Normalized off the legacy d163 CloudFront the old
// /api/metadata/drug/[id] route used; the sovereign host owns the JSON.
const CANDIES_CONTRACT = "0xecA03517c5195F1edD634DA6D690D6c72407c40c";

// Tarot / Archetype — chain 80094. Metadata resolves via the SOVEREIGN
// storage-api route under the "tarot" slug (tokenId === quiz_metadata.tokenid,
// the integer PK). The pre-formatted OpenSea-style doc comes from the
// quiz_metadata.metadata JSONB column (legacy route: app/api/quiz/[tokenId]).
// Images are already sovereign (S3 Mibera/quiz_archetypes/{tokenId}.webp); the
// sovereign host owns the normalized JSON.
const TAROT_CONTRACT = "0x4B08a069381EfbB9f08C73D6B2e975C9BE3c4684";

// Mibera Reveal GIF — chain 80094. Metadata resolves via the SOVEREIGN storage-api
// route under the "gif" slug (tokenId === gif_metadata.tokenid; 347 tokens). The
// sovereign JSON carries { name, description, image } with NO attributes — the GIF
// has none — so the generic resolver's mapAttributes naturally yields []. The image
// is the sovereign host (https://assets.0xhoneyjar.xyz/Mibera/gif/{tokenId}.gif),
// normalized off the legacy d163 CloudFront the old gif metadata stored.
const GIF_CONTRACT = "0x230945E0Ed56EF4dE871a6c0695De265DE23D8D8";

// Fractures (Mibera "Fractured" set) — chain 80094. TEN contracts (parcels,
// miladies, reveal_phase1..8 — see honeyroad lib/fractures.ts FRACTURED_ADDRESSES),
// ALL routed to the SINGLE sovereign slug "fractures" (10,000 tokens total). The
// canonical source is the Postgres fracture_expanded table (codex/Mibera shape:
// flattened trait columns → attributes), surfaced as the same sovereign JSON
// contract `{ name, description, image, attributes: [{ trait_type, value }] }`.
// Routing is by CONTRACT ADDRESS → one slug, so any of the ten contracts resolves
// to the same metadata.0xhoneyjar.xyz/mibera/fractures/{tokenId} path — no per-token
// phase resolution (fracture_expanded.image is always the phase-1 image hash).
const FRACTURED_ADDRESSES = [
  "0x86Db98cf1b81E833447b12a077ac28c36b75c8E1", // miparcels
  "0x8D4972bd5D2df474e71da6676a365fB549853991", // miladies
  "0x144B27b1A267eE71989664b3907030Da84cc4754", // mireveal #1.1
  "0x72DB992E18a1bf38111B1936DD723E82D0D96313", // mireveal #2.2
  "0x3A00301B713be83EC54B7B4Fb0f86397d087E6d3", // mireveal #3.3
  "0x419F25C4f9A9c730AAcf58b8401B5b3e566Fe886", // mireveal #4.20
  "0x81A27117bd894942BA6737402fB9e57e942C6058", // mireveal #5.5
  "0xaaB7b4502251aE393D0590bAB3e208E2d58F4813", // mireveal #6.9
  "0xc64126EA8dC7626c16daA2A29D375C33fcaa4C7c", // mireveal #7.7
  "0x24F4047d372139de8DACbe79e2fC576291Ec3ffc", // mireveal #8.8
];

// Contract → metadata resolution strategy. Keyed by EIP-55 checksum address so the
// lookup is checksum-consistent (never raw-case string compare). A sovereign
// collection is `{ kind: "sovereign", slug }` — adding one is a single registry
// row (slug + contract), NOT a new strategy variant or function.
type MetadataStrategy =
  | { kind: "codex" }
  | { kind: "sovereign"; slug: string }
  // The world's NAMESAKE collection (Mibera-main): sovereign storage-api under the
  // `/mibera/{tokenId}` shape (no slug segment). Mibera-main is fully migrated to
  // S3 (incl. grails, e.g. #7702 "Ethiopian"); the legacy codex was partial (404
  // on high token ids), so we route the namesake to sovereign, not codex.
  | { kind: "sovereign-world" };
const METADATA_REGISTRY: Record<string, MetadataStrategy> = {
  [toChecksumAddress(MIBERA_CONTRACT)]: { kind: "sovereign-world" },
  [toChecksumAddress(MST_CONTRACT)]: { kind: "sovereign", slug: "mst" },
  [toChecksumAddress(CANDIES_CONTRACT)]: { kind: "sovereign", slug: "candies" },
  [toChecksumAddress(TAROT_CONTRACT)]: { kind: "sovereign", slug: "tarot" },
  [toChecksumAddress(GIF_CONTRACT)]: { kind: "sovereign", slug: "gif" },
  // All ten Fractures contracts map to the SAME "fractures" slug — routing is by
  // contract address, the slug is shared (one sovereign collection, 10 contracts).
  ...Object.fromEntries(
    FRACTURED_ADDRESSES.map((addr) => [
      toChecksumAddress(addr),
      { kind: "sovereign", slug: "fractures" } as MetadataStrategy,
    ])
  ),
};

function validateAddress(address: string, field: string): string {
  if (!isValidAddress(address)) {
    throw new ValidationError(field, address, "0x-prefixed 40-char hex string");
  }
  return toChecksumAddress(address);
}

export async function getHoldings(
  address: string,
  options: GetHoldingsOptions = {}
): Promise<HoldingsResponse> {
  const checksummedAddress = validateAddress(address, "address");

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

  // Determine target contracts (default: Mibera main contract)
  const targetContracts = options.contracts
    ? options.contracts.map((c) => toChecksumAddress(c))
    : [MIBERA_CONTRACT];

  // Live mode (SONAR_GRAPHQL_ENDPOINT set): real holder counts + real completeness
  // from the belt-gateway, plus per-token ownership now that the sonar belt-factory
  // branch publishes the `Token` index (DEP-2 unblock — docs/sonar-ownership-gap.md).
  // Fail-soft throughout: count comes from TrackedHolder; tokenIds come from the
  // `Token` index but degrade to [] (not a crash) if that sub-query is unavailable,
  // so a partial belt still serves real counts.
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
        // Endpoint unreachable for the count query — the completeness envelope
        // is already `degraded` (buildEnvelopeLive caught the same outage).
        // Degrade this contract's holdings to the fixture instead of crashing
        // the whole response (README: unreachable -> fixture + degraded).
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
      // ERC-1155 collections (Candies) carry no rows in the 721 `Token` index;
      // their per-holder ownership lives in `CandiesHolderBalance` (sonar
      // candies_holder_balance, populated once the green-belt reindex backfills
      // it). Route candies to the balance query; everyone else uses the 721 path.
      const isCandies =
        contractAddress.toLowerCase() === CANDIES_CONTRACT.toLowerCase();
      let tokenIds: string[] = [];
      try {
        if (isCandies) {
          const balances = await liveSonar.liveCandiesBalances(checksummedAddress);
          tokenIds = balances
            .filter(
              (b) => b.contract.toLowerCase() === contractAddress.toLowerCase()
            )
            .map((b) => b.tokenId);
        } else {
          tokenIds = await liveSonar.liveOwnerTokenIds(
            checksummedAddress,
            contractAddress
          );
        }
      } catch {
        // Per-token index unavailable (older belt / transient) — keep the real
        // count, leave tokenIds empty. Never let this fail the whole response.
        tokenIds = [];
      }
      // For candies the held-token count IS the number of balance rows; the
      // Mibera-keyed `count` above is a 721 proxy that doesn't apply to 1155.
      const tokenCount = isCandies ? tokenIds.length : count;
      liveHoldings.push({ contractAddress, chainId, tokenCount, tokenIds });
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

/** Build a single NFT record from a tokenId by joining codex metadata. */
function tokenIdToNFT(tokenId: string) {
  const record = codexClient.getToken(tokenId);
  if (!record) {
    // Minimal fallback if codex record is missing
    return {
      tokenId,
      name: `Mibera #${tokenId}`,
      description: "Unknown",
      imageUrl: "",
      contentType: "image/png",
      attributes: [],
    };
  }
  const imageUrl = codexClient.getImageUrl(tokenId) ?? "";
  const grailRecord = codexClient.getGrailRecord(tokenId);
  return codexToNFT(
    tokenId,
    record,
    imageUrl,
    codexClient.isGrail(tokenId),
    grailRecord
  );
}

export async function getNftsForOwner(
  address: string,
  contract: string,
  options: GetNftsForOwnerOptions = {}
): Promise<NFTCollection> {
  const checksummedAddress = validateAddress(address, "address");
  const checksummedContract = validateAddress(contract, "contract");
  // A well-formed-but-unregistered contract is a client input error (400), not
  // an internal fault (500). Guard against METADATA_REGISTRY up front so the
  // request fails fast with a safe ValidationError message instead of surfacing
  // an internal "No collection meta for ..." down in getCollectionMeta.
  if (!METADATA_REGISTRY[checksummedContract]) {
    throw new ValidationError("contract", contract, "registered collection address");
  }
  const chainId = MIBERA_CHAIN_ID;

  // Resolve owner -> tokenIds. In live mode the sonar `Token` index is the
  // source of truth (DEP-2 unblock); fail-soft to fixtures if it is
  // unreachable so the gallery still renders something offline. In hermetic
  // mode the fixture sonar client is the only source.
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

  const { page, nextPageKey } = applyPagination(
    tokenIds,
    options.pageSize ?? 100,
    options.pageKey
  );

  const nfts = page.map(tokenIdToNFT);

  const collectionMeta = codexClient.getCollectionMeta(checksummedContract);

  return {
    contractAddress: checksummedContract,
    name: collectionMeta.name,
    symbol: collectionMeta.symbol,
    totalSupply: collectionMeta.totalSupply,
    nfts,
    pageKey: nextPageKey,
  };
}

/**
 * getProfilePicture(address) — best-available profile image for a wallet.
 *
 * Returns the imageUrl of the holder's first owned NFT (real Mibera artwork via
 * the codex), or null when they own none / ownership isn't resolvable yet.
 * Owner→tokenIds is fixture-backed today (the live sonar Token index is empty —
 * see docs/sonar-ownership-gap.md); this auto-upgrades to live-for-all the
 * moment sonar populates the per-token owner index, with NO change here.
 * Consumers (e.g. freeside-characters' resolvePfp) fall back to their own pfp
 * source on null — so the spotlight is never "an anonymous mibera" (Issue #87).
 */
export async function getProfilePicture(
  address: string,
  options: { contract?: string } = {}
): Promise<string | null> {
  const contract = options.contract ?? MIBERA_CONTRACT;
  const collection = await getNftsForOwner(address, contract, { pageSize: 1 });
  const first = collection.nfts[0];
  return first && first.imageUrl.length > 0 ? first.imageUrl : null;
}

export async function getNftMetadata(
  contract: string,
  tokenId: string
): Promise<MetadataDocument> {
  const checksummedContract = validateAddress(contract, "contract");
  if (!/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }

  // Branch on the (checksummed) contract: Mibera-main resolves from the sovereign
  // NAMESAKE route (`/mibera/{tokenId}`), sibling sovereign collections (MST,
  // Candies, …) from `/mibera/{slug}/{tokenId}`. Unknown contracts default to the
  // legacy codex path (preserves prior behavior: codex miss => NotFoundError).
  const strategy = METADATA_REGISTRY[checksummedContract] ?? { kind: "codex" };

  if (strategy.kind === "sovereign") {
    return fetchSovereignMetadata(strategy.slug, checksummedContract, tokenId);
  }

  // The world's namesake collection (Mibera-main): sovereign `/mibera/{tokenId}`
  // (null slug). Strictly better than the legacy codex, which 404'd on high token
  // ids and lacked grail metadata — the S3 sovereign source carries all 10k + grails.
  if (strategy.kind === "sovereign-world") {
    return fetchSovereignMetadata(null, checksummedContract, tokenId);
  }

  // Codex path — only for UNKNOWN contracts now (defaulted to { kind: "codex" }).
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
