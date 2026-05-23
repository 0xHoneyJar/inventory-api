import type { CompletenessEnvelope } from "../types.js";
import * as sonarClient from "./sonar-client.js";
import * as liveSonar from "./live-sonar.js";

/** Hermetic (fixture) envelope. */
export function buildEnvelope(
  contractAddress: string,
  chainId: number
): CompletenessEnvelope {
  return {
    as_of_block: sonarClient.getMaxBlockNumber(contractAddress, chainId),
    holder_count: sonarClient.getDistinctHolderCount(contractAddress, chainId),
    source: "sonar",
    complete: true,
  };
}

/**
 * Live envelope from the belt-gateway: real chain head (as_of_block) + real
 * distinct holder count. Fail-soft — if the live endpoint is unreachable, fall
 * back to fixture values and mark the envelope `degraded` (a degraded proof must
 * never claim `complete: true`).
 */
export async function buildEnvelopeLive(
  contractAddress: string,
  chainId: number,
  collectionKey: string
): Promise<CompletenessEnvelope> {
  try {
    const [as_of_block, holder_count] = await Promise.all([
      liveSonar.liveChainHead(chainId),
      liveSonar.liveDistinctHolderCount(collectionKey),
    ]);
    return { as_of_block, holder_count, source: "sonar", complete: true };
  } catch {
    return { ...buildEnvelope(contractAddress, chainId), complete: "degraded" };
  }
}
