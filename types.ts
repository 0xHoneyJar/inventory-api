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
}
