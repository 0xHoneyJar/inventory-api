import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FixtureLoadError } from "./errors.js";
import type { SvmOwnedNft } from "./live-sonar.js";

interface SvmSonarFixtureRow {
  collectionKey: string;
  owner: string;
  nftMint: string;
  name: string | null;
  /** PYTH-2: sonar's resolved image URL (Helius DAS content.links.image). */
  image: string | null;
  /** PYTH-2: sonar's metadata json_uri (Helius DAS content.json_uri). */
  uri: string | null;
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
  if (r.name !== undefined && r.name !== null && typeof r.name !== "string") {
    throw new FixtureLoadError(
      filePath,
      new Error(`nfts[${index}].name must be a string or null`)
    );
  }
  if (r.image !== undefined && r.image !== null && typeof r.image !== "string") {
    throw new FixtureLoadError(
      filePath,
      new Error(`nfts[${index}].image must be a string or null`)
    );
  }
  if (r.uri !== undefined && r.uri !== null && typeof r.uri !== "string") {
    throw new FixtureLoadError(
      filePath,
      new Error(`nfts[${index}].uri must be a string or null`)
    );
  }
  return {
    collectionKey: r.collectionKey as string,
    owner: r.owner as string,
    nftMint: r.nftMint as string,
    name: r.name === undefined || r.name === null ? null : (r.name as string),
    image: r.image === undefined || r.image === null ? null : (r.image as string),
    uri: r.uri === undefined || r.uri === null ? null : (r.uri as string),
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
    .map((n) => ({ nftMint: n.nftMint, name: n.name, image: n.image, uri: n.uri }));
}
