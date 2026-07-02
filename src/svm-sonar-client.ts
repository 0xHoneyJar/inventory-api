import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FixtureLoadError } from "./errors.js";
import type { SvmOwnedNft } from "./live-sonar.js";

interface SvmSonarFixtureRow {
  collectionKey: string;
  owner: string;
  nftMint: string;
  name: string | null;
}

interface SvmSonarFixture {
  nfts: SvmSonarFixtureRow[];
}

function assertFixtureRow(row: unknown, filePath: string, index: number): SvmSonarFixtureRow {
  if (typeof row !== "object" || row === null) {
    throw new FixtureLoadError(filePath, new Error(`nfts[${index}] must be an object`));
  }
  const r = row as Record<string, unknown>;
  for (const key of ["collectionKey", "owner", "nftMint"] as const) {
    if (typeof r[key] !== "string" || r[key].length === 0) {
      throw new FixtureLoadError(
        filePath,
        new Error(`nfts[${index}].${key} must be a non-empty string`)
      );
    }
  }
  if (r.name !== null && typeof r.name !== "string") {
    throw new FixtureLoadError(
      filePath,
      new Error(`nfts[${index}].name must be a string or null`)
    );
  }
  return {
    collectionKey: r.collectionKey as string,
    owner: r.owner as string,
    nftMint: r.nftMint as string,
    name: (r.name ?? null) as string | null,
  };
}

function loadFixture(filePath: string): SvmSonarFixture {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new FixtureLoadError(filePath, err);
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.nfts)) {
    throw new FixtureLoadError(filePath, new Error("Missing nfts array"));
  }
  return {
    nfts: r.nfts.map((row, index) => assertFixtureRow(row, filePath, index)),
  };
}

const FIXTURE_PATH = fileURLToPath(
  new URL("../fixtures/sonar-svm-collection-nft.json", import.meta.url)
);
const _fixture = loadFixture(FIXTURE_PATH);

export function getSvmNftsByOwner(owner: string, collectionKey: string): SvmOwnedNft[] {
  return _fixture.nfts
    .filter((n) => n.collectionKey === collectionKey && n.owner === owner)
    .map((n) => ({ nftMint: n.nftMint, name: n.name }));
}
