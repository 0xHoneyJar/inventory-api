import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toChecksumAddress } from "./address.js";
import { FixtureLoadError } from "./errors.js";
import type { TrackedHolder, Token } from "./types-internal.js";

interface SonarFixture {
  trackedHolders: TrackedHolder[];
  tokens: Token[];
}

function loadAndValidateFixture(filePath: string): SonarFixture {
  let raw: unknown;
  try {
    const content = readFileSync(filePath, "utf-8");
    raw = JSON.parse(content);
  } catch (err) {
    throw new FixtureLoadError(filePath, err);
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).trackedHolders) ||
    !Array.isArray((raw as Record<string, unknown>).tokens)
  ) {
    throw new FixtureLoadError(filePath, new Error("Missing trackedHolders or tokens arrays"));
  }
  const fixture = raw as SonarFixture;
  // Validate at least 5 distinct addresses
  const addrs = new Set(fixture.trackedHolders.map((h) => h.address.toLowerCase()));
  if (addrs.size < 5) {
    throw new FixtureLoadError(
      filePath,
      new Error(`Expected at least 5 distinct addresses, got ${addrs.size}`)
    );
  }
  // Validate blockNumber present on all rows
  for (const h of fixture.trackedHolders) {
    if (typeof h.blockNumber !== "number") {
      throw new FixtureLoadError(filePath, new Error("TrackedHolder missing blockNumber"));
    }
  }
  for (const t of fixture.tokens) {
    if (typeof t.blockNumber !== "number") {
      throw new FixtureLoadError(filePath, new Error("Token missing blockNumber"));
    }
  }
  return fixture;
}

function buildIndexes(fixture: SonarFixture) {
  const holdersByContract = new Map<string, TrackedHolder[]>();
  const tokensByOwnerContract = new Map<string, Token[]>();
  const maxBlockByContract = new Map<string, number>();

  for (const h of fixture.trackedHolders) {
    const checksumContract = toChecksumAddress(h.contractAddress);
    const checksumAddress = toChecksumAddress(h.address);
    const contractKey = `${h.chainId}:${checksumContract}`;

    if (!holdersByContract.has(contractKey)) holdersByContract.set(contractKey, []);
    holdersByContract.get(contractKey)!.push({
      ...h,
      address: checksumAddress,
      contractAddress: checksumContract,
    });

    const cur = maxBlockByContract.get(contractKey) ?? 0;
    if (h.blockNumber > cur) maxBlockByContract.set(contractKey, h.blockNumber);
  }

  for (const t of fixture.tokens) {
    const checksumContract = toChecksumAddress(t.contractAddress);
    const checksumOwner = toChecksumAddress(t.owner);
    const ownerContractKey = `${t.chainId}:${checksumContract}:${checksumOwner}`;
    const contractKey = `${t.chainId}:${checksumContract}`;

    if (!tokensByOwnerContract.has(ownerContractKey)) {
      tokensByOwnerContract.set(ownerContractKey, []);
    }
    tokensByOwnerContract.get(ownerContractKey)!.push({
      ...t,
      owner: checksumOwner,
      contractAddress: checksumContract,
    });

    const cur = maxBlockByContract.get(contractKey) ?? 0;
    if (t.blockNumber > cur) maxBlockByContract.set(contractKey, t.blockNumber);
  }

  return { holdersByContract, tokensByOwnerContract, maxBlockByContract };
}

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/sonar-trackedholders.json", import.meta.url)
);
const _fixture = loadAndValidateFixture(FIXTURE_PATH);
const { holdersByContract, tokensByOwnerContract, maxBlockByContract } =
  buildIndexes(_fixture);

export function getHolders(contractAddress: string, chainId: number): TrackedHolder[] {
  const key = `${chainId}:${toChecksumAddress(contractAddress)}`;
  return holdersByContract.get(key) ?? [];
}

export function getTokensByOwner(
  owner: string,
  contractAddress: string,
  chainId: number
): Token[] {
  const key = `${chainId}:${toChecksumAddress(contractAddress)}:${toChecksumAddress(owner)}`;
  return tokensByOwnerContract.get(key) ?? [];
}

export function getMaxBlockNumber(contractAddress: string, chainId: number): number {
  const key = `${chainId}:${toChecksumAddress(contractAddress)}`;
  return maxBlockByContract.get(key) ?? 0;
}

export function getDistinctHolderCount(contractAddress: string, chainId: number): number {
  const key = `${chainId}:${toChecksumAddress(contractAddress)}`;
  const holders = holdersByContract.get(key) ?? [];
  const distinct = new Set(holders.map((h) => h.address.toLowerCase()));
  return distinct.size;
}
