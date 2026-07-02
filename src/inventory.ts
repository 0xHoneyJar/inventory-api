import * as sonarClient from "./sonar-client.js";
import * as codexClient from "./codex-client.js";
import * as liveSonar from "./live-sonar.js";
import * as svmSonarClient from "./svm-sonar-client.js";
import { codexToNFT, codexToMetadataDocument, metadataDocumentToNFT } from "./transform.js";
import { buildEnvelope, buildEnvelopeLive } from "./completeness.js";
import { applyPagination } from "./pagination.js";
import {
  toChecksumAddress,
  isValidAddress,
  validateWalletAddress,
  validateEvmAddress,
} from "./address.js";
import { ValidationError, NotFoundError } from "./errors.js";
import { fetchSovereignMetadata } from "./sovereign-metadata.js";
import {
  resolveExternalCollection,
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

function tokenIdToNFT(tokenId: string) {
  const record = codexClient.getToken(tokenId);
  if (!record) {
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

async function externalTokenToNFT(
  col: ExternalCollection,
  tokenId: string,
  fallbackName: string | null
): Promise<NFT> {
  try {
    const doc = await fetchSovereignMetadata(
      col.metadataWorld,
      col.metadataSlug,
      col.id,
      tokenId,
      { numericTokenId: col.vm === "evm" }
    );
    return metadataDocumentToNFT(tokenId, doc);
  } catch {
    return {
      tokenId,
      name: fallbackName ?? tokenId,
      description: "",
      imageUrl: "",
      contentType: "image/png",
      attributes: [],
    };
  }
}

async function getExternalNftsForOwner(
  address: string,
  col: ExternalCollection,
  options: GetNftsForOwnerOptions
): Promise<NFTCollection> {
  const owner = validateWalletAddress(col.vm, address, "address");

  let tokenIds: string[];
  let nameByTokenId = new Map<string, string | null>();

  if (col.vm === "svm") {
    let rows;
    if (liveSonar.isLiveMode()) {
      try {
        rows = await liveSonar.liveSvmNftsForOwner(owner, col.sonarCollectionKey);
      } catch {
        rows = svmSonarClient.getSvmNftsByOwner(owner, col.sonarCollectionKey);
      }
    } else {
      rows = svmSonarClient.getSvmNftsByOwner(owner, col.sonarCollectionKey);
    }
    tokenIds = rows.map((r) => r.nftMint);
    nameByTokenId = new Map(rows.map((r) => [r.nftMint, r.name]));
  } else {
    const evmContract = col.evmContract!;
    const checksummedContract = toChecksumAddress(evmContract);
    if (liveSonar.isLiveMode()) {
      try {
        tokenIds = await liveSonar.liveOwnerTokenIds(toChecksumAddress(owner), checksummedContract);
      } catch {
        tokenIds = sonarClient
          .getTokensByOwner(toChecksumAddress(owner), checksummedContract, col.chainId)
          .map((t) => t.tokenId);
      }
    } else {
      tokenIds = sonarClient
        .getTokensByOwner(toChecksumAddress(owner), checksummedContract, col.chainId)
        .map((t) => t.tokenId);
    }
  }

  const { page, nextPageKey } = applyPagination(
    tokenIds,
    options.pageSize ?? 100,
    options.pageKey
  );

  const nfts = await Promise.all(
    page.map((tokenId) => externalTokenToNFT(col, tokenId, nameByTokenId.get(tokenId) ?? null))
  );

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
  const checksummedContract = validateEvmAddress(contract, "contract");
  if (!/^\d+$/.test(tokenId)) {
    throw new ValidationError("tokenId", tokenId, "numeric string");
  }

  const strategy = resolveMetadataStrategy(checksummedContract) ?? { kind: "codex" };

  if (strategy.kind === "sovereign") {
    return fetchSovereignMetadata("mibera", strategy.slug, checksummedContract, tokenId);
  }

  if (strategy.kind === "sovereign-world") {
    return fetchSovereignMetadata("mibera", null, checksummedContract, tokenId);
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
