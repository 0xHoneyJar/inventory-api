export interface HoldingsResponse {
  holdings: ContractHolding[];
  completeness: CompletenessEnvelope;
}

export interface ContractHolding {
  contractAddress: string;
  chainId: number;
  tokenCount: number;
  tokenIds: string[];
}

export interface CompletenessEnvelope {
  as_of_block: number;
  holder_count: number;
  source: "sonar";
  complete: true | "degraded";
}

export interface NFTCollection {
  contractAddress: string;
  name: string;
  symbol: string;
  totalSupply: number;
  nfts: NFT[];
  pageKey?: string;
}

export interface NFT {
  tokenId: string;
  name: string;
  description: string;
  imageUrl: string;
  /** Canonical upstream metadata pointer when the source publishes one. Never rehosted implicitly. */
  metadataUri?: string;
  contentType: string;
  attributes: Attribute[];
}

export interface MetadataDocument {
  name: string;
  description: string;
  image: string;
  attributes: Attribute[];
}

export interface Attribute {
  trait_type: string;
  value: string;
}

export interface GetHoldingsOptions {
  chains?: number[];
  contracts?: string[];
}

export interface GetNftsForOwnerOptions {
  pageSize?: number;
  pageKey?: string;
  /**
   * INTERNAL — used by `getProfilePicture` only; no route ever sets this
   * (routes.ts's zod query schema for both `/nfts/:contract/owner/:address`
   * and `/profile/:address` has no such field, so an inbound request can
   * never populate it). Sorts tokenIds ascending (numeric compare for
   * decimal ids) before pagination, so `pageSize: 1` resolves the LOWEST
   * held token deterministically instead of "whatever the indexer/fixture
   * returned first."
   */
  sortTokenIds?: "ascending";
}
