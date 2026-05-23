export interface TrackedHolder {
  collectionKey: string;
  chainId: number;
  contractAddress: string;
  address: string;
  tokenCount: number;
  blockNumber: number;
}

export interface Token {
  collectionKey: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  owner: string;
  blockNumber: number;
}

// Real Mibera codex schema (mibera-codex/_codex/data/miberas.jsonl) — fields
// verified consistent across all 10,000 records. `type` is a constant ("mibera")
// dropped at fixture-generation time.
export interface CodexRecord {
  id: number;
  archetype: string | null;
  ancestor: string | null;
  time_period: string | null;
  birthday: string | null;
  birth_coordinates: string | null;
  sun_sign: string | null;
  moon_sign: string | null;
  ascending_sign: string | null;
  element: string | null;
  swag_rank: string | null;
  swag_score: number | null;
  background: string | null;
  body: string | null;
  hair: string | null;
  eyes: string | null;
  eyebrows: string | null;
  mouth: string | null;
  shirt: string | null;
  hat: string | null;
  glasses: string | null;
  mask: string | null;
  earrings: string | null;
  face_accessory: string | null;
  tattoo: string | null;
  item: string | null;
  drug: string | null;
  description?: string | null;
}

// Real grail shape (grails.jsonl): the transform consumes only name + description.
export interface GrailRecord {
  id: number;
  name: string;
  description: string;
}

export interface CollectionMeta {
  contractAddress: string;
  name: string;
  symbol: string;
  totalSupply: number;
}
