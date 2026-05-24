import * as sonarClient from "./sonar-client.js";
import * as codexClient from "./codex-client.js";
import * as liveSonar from "./live-sonar.js";
import { codexToNFT, codexToMetadataDocument } from "./transform.js";
import { buildEnvelope, buildEnvelopeLive } from "./completeness.js";
import { applyPagination } from "./pagination.js";
import { toChecksumAddress, isValidAddress } from "./address.js";
import { ValidationError, NotFoundError } from "./errors.js";
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
  // from the belt-gateway. tokenIds await the sonar per-token ownership index —
  // see docs/sonar-ownership-gap.md (per ADR-008, that index is sonar's to publish).
  if (liveSonar.isLiveMode()) {
    const completeness = await buildEnvelopeLive(
      MIBERA_CONTRACT,
      MIBERA_CHAIN_ID,
      MIBERA_COLLECTION_KEY
    );
    const liveHoldings: ContractHolding[] = [];
    for (const contractAddress of targetContracts) {
      const chainId = options.chains?.[0] ?? MIBERA_CHAIN_ID;
      const count = await liveSonar.liveHolderTokenCount(
        checksummedAddress,
        MIBERA_COLLECTION_KEY
      );
      if (count === 0) continue;
      liveHoldings.push({ contractAddress, chainId, tokenCount: count, tokenIds: [] });
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

export async function getNftsForOwner(
  address: string,
  contract: string,
  options: GetNftsForOwnerOptions = {}
): Promise<NFTCollection> {
  const checksummedAddress = validateAddress(address, "address");
  const checksummedContract = validateAddress(contract, "contract");
  const chainId = MIBERA_CHAIN_ID;

  const tokens = sonarClient.getTokensByOwner(
    checksummedAddress,
    checksummedContract,
    chainId
  );

  const { page, nextPageKey } = applyPagination(
    tokens,
    options.pageSize ?? 100,
    options.pageKey
  );

  const nfts = page.map((token) => {
    const record = codexClient.getToken(token.tokenId);
    if (!record) {
      // Minimal fallback if codex record is missing
      return {
        tokenId: token.tokenId,
        name: `Mibera #${token.tokenId}`,
        description: "Unknown",
        imageUrl: "",
        contentType: "image/png",
        attributes: [],
      };
    }
    const imageUrl = codexClient.getImageUrl(token.tokenId) ?? "";
    const grailRecord = codexClient.getGrailRecord(token.tokenId);
    return codexToNFT(
      token.tokenId,
      record,
      imageUrl,
      codexClient.isGrail(token.tokenId),
      grailRecord
    );
  });

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
  validateAddress(contract, "contract");
  if (!/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }

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
