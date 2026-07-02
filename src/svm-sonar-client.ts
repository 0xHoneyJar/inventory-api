import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FixtureLoadError } from "./errors.js";
import type { SvmOwnedNft } from "./live-sonar.js";

interface SvmSonarFixture {
  nfts: { collectionKey: string; owner: string; nftMint: string; name: string | null }[];
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
  return raw as SvmSonarFixture;
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
