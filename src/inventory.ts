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

// Mibera Reveal GIF — chain 80094. Metadata resolves via the SOVEREIGN storage-api
// route under the "gif" slug (tokenId === gif_metadata.tokenid; 347 tokens). The
// sovereign JSON carries { name, description, image } with NO attributes — the GIF
// has none — so the generic resolver's mapAttributes naturally yields []. The image
// is the sovereign host (https://assets.0xhoneyjar.xyz/Mibera/gif/{tokenId}.gif),
// normalized off the legacy d163 CloudFront the old gif metadata stored.
const GIF_CONTRACT = "0x230945E0Ed56EF4dE871a6c0695De265DE23D8D8";

// Contract → metadata resolution strategy. Keyed by EIP-55 checksum address so the
// lookup is checksum-consistent (never raw-case string compare). A sovereign
// collection is `{ kind: "sovereign", slug }` — adding one is a single registry
// row (slug + contract), NOT a new strategy variant or function.
type MetadataStrategy =
  | { kind: "codex" }
  | { kind: "sovereign"; slug: string };
const METADATA_REGISTRY: Record<string, MetadataStrategy> = {
  [toChecksumAddress(MIBERA_CONTRACT)]: { kind: "codex" },
  [toChecksumAddress(MST_CONTRACT)]: { kind: "sovereign", slug: "mst" },
  [toChecksumAddress(CANDIES_CONTRACT)]: { kind: "sovereign", slug: "candies" },
  [toChecksumAddress(GIF_CONTRACT)]: { kind: "sovereign", slug: "gif" },
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
      let tokenIds: string[] = [];
      try {
        tokenIds = await liveSonar.liveOwnerTokenIds(checksummedAddress, contractAddress);
      } catch {
        // Per-token index unavailable (older belt / transient) — keep the real
        // count, leave tokenIds empty. Never let this fail the whole response.
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

  // Branch on the (checksummed) contract: Mibera-main resolves from the codex,
  // sovereign collections (MST, Candies, …) from the storage-api route under their
  // slug. Unknown contracts default to the codex path (preserves prior behavior:
  // codex miss => NotFoundError).
  const strategy = METADATA_REGISTRY[checksummedContract] ?? { kind: "codex" };

  if (strategy.kind === "sovereign") {
    return fetchSovereignMetadata(strategy.slug, checksummedContract, tokenId);
  }

  // Mibera-main codex path (unchanged).
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
