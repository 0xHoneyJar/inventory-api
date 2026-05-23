// Live sonar client — queries the belt-gateway GraphQL when SONAR_GRAPHQL_ENDPOINT
// is configured; otherwise the module stays in hermetic fixture mode (the default,
// which keeps the test suite offline). Fail-soft: callers fall back to fixture +
// a `degraded` completeness flag when the live endpoint is unreachable.
//
// Scope today = what the Mibera belt actually exposes: chain head (as_of_block)
// + holder counts (TrackedHolder). Per-token current ownership (owner -> tokenIds)
// is NOT yet published by the belt — see docs/sonar-ownership-gap.md. Per ADR-008's
// belt model, that index is sonar's to publish, not inventory's to derive.
//
// Current production endpoint (2026-05-23, not committed to the sonar repo):
//   https://<belt-gateway-host>/v1/graphql

/** Read the endpoint dynamically so tests can toggle live mode at runtime. */
function endpoint(): string | undefined {
  const e = process.env.SONAR_GRAPHQL_ENDPOINT;
  return e && e.length > 0 ? e : undefined;
}

export function isLiveMode(): boolean {
  return endpoint() !== undefined;
}

async function query<T>(gql: string): Promise<T> {
  const ep = endpoint();
  if (!ep) throw new Error("SONAR_GRAPHQL_ENDPOINT not set");
  const res = await fetch(ep, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql }),
  });
  if (!res.ok) throw new Error(`sonar HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors || body.data == null) {
    throw new Error(`sonar GraphQL error: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

/** Berachain (or given chain) head block — the ACVP `as_of_block` source. */
export async function liveChainHead(chainId: number): Promise<number> {
  const d = await query<{ chain_metadata: { latest_processed_block: number }[] }>(
    `{ chain_metadata(where: {chain_id: {_eq: ${Number(chainId)}}}) { latest_processed_block } }`
  );
  const row = d.chain_metadata[0];
  if (!row) throw new Error(`no chain_metadata for chain ${chainId}`);
  return row.latest_processed_block;
}

/** Distinct holders of a collection — the ACVP `holder_count`. */
export async function liveDistinctHolderCount(collectionKey: string): Promise<number> {
  const ck = JSON.stringify(collectionKey);
  const d = await query<{ TrackedHolder_aggregate: { aggregate: { count: number } } }>(
    `{ TrackedHolder_aggregate(where: {collectionKey: {_eq: ${ck}}}) { aggregate { count } } }`
  );
  return d.TrackedHolder_aggregate.aggregate.count;
}

/** A holder's current token count for a collection (TrackedHolder, summed). */
export async function liveHolderTokenCount(
  address: string,
  collectionKey: string
): Promise<number> {
  const addr = JSON.stringify(address.toLowerCase());
  const ck = JSON.stringify(collectionKey);
  const d = await query<{ TrackedHolder: { tokenCount: number }[] }>(
    `{ TrackedHolder(where: {collectionKey: {_eq: ${ck}}, address: {_eq: ${addr}}}) { tokenCount } }`
  );
  return d.TrackedHolder.reduce((sum, h) => sum + h.tokenCount, 0);
}
