// Live sonar client — queries the belt-gateway GraphQL when SONAR_GRAPHQL_ENDPOINT
// is configured; otherwise the module stays in hermetic fixture mode (the default,
// which keeps the test suite offline). Fail-soft: callers fall back to fixture +
// a `degraded` completeness flag when the live endpoint is unreachable.
//
// Scope: chain head (as_of_block) + holder counts (TrackedHolder) + per-token
// current ownership. The per-token owner index (`Token` for ERC-721,
// `CandiesHolderBalance` for ERC-1155) shipped to sonar's cycle/sonar-belt-factory
// branch (DEP-2 unblock, 2026-05-24) — owner→tokenIds is now queryable. Per
// ADR-008's belt model that index is sonar's to publish, not inventory's to derive;
// inventory only consumes it. See docs/sonar-ownership-gap.md.
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

/**
 * A holder's current ERC-721 tokenIds for a collection — the per-token owner
 * index that the sonar belt-factory branch now publishes (DEP-2 unblock).
 *
 * Query shape per the new `Token` entity (owner + collection are indexed):
 *   Token(where: { collection: {_eq: <contractLower>},
 *                  owner:      {_eq: <addrLower>},
 *                  isBurned:   {_eq: false} }) { tokenId }
 *
 * Returns the tokenIds as strings (matching ContractHolding.tokenIds). The
 * filter uses lowercased address + lowercased contract — sonar indexes both
 * lowercased (same convention as `liveHolderTokenCount`'s `address` filter).
 */
export async function liveOwnerTokenIds(
  address: string,
  contractLower: string
): Promise<string[]> {
  const addr = JSON.stringify(address.toLowerCase());
  const coll = JSON.stringify(contractLower.toLowerCase());
  const d = await query<{ Token: { tokenId: string }[] }>(
    `{ Token(where: {collection: {_eq: ${coll}}, owner: {_eq: ${addr}}, isBurned: {_eq: false}}) { tokenId } }`
  );
  return d.Token.map((t) => String(t.tokenId));
}

/** A single ERC-1155 (Candies) balance row for a holder. */
export interface LiveCandiesBalance {
  contract: string;
  tokenId: string;
  amount: string;
}

/**
 * A holder's current ERC-1155 (Candies) balances — the `CandiesHolderBalance`
 * entity from the belt-factory branch.
 *
 * Query shape (amount stored as a numeric string; filter `_gt: "0"` excludes
 * zero balances):
 *   CandiesHolderBalance(where: { holder_id: {_eq: <addrLower>},
 *                                 amount:    {_gt: "0"} })
 *     { contract tokenId amount }
 *
 * NOTE (unverified — sonar belt-factory not yet deployed/reindexed): the exact
 * holder filter field is the Hasura relationship key `holder_id` per the DEP-2
 * spec. If the deployed schema names it `holder` instead, change only
 * `CANDIES_HOLDER_FILTER_FIELD` below. The codebase's other live queries filter
 * scalar columns directly (e.g. `address`), so a relationship `_id` suffix is
 * the documented-but-unconfirmed shape.
 */
const CANDIES_HOLDER_FILTER_FIELD = "holder_id";

export async function liveCandiesBalances(
  address: string
): Promise<LiveCandiesBalance[]> {
  const addr = JSON.stringify(address.toLowerCase());
  const d = await query<{
    CandiesHolderBalance: { contract: string; tokenId: string; amount: string }[];
  }>(
    `{ CandiesHolderBalance(where: {${CANDIES_HOLDER_FILTER_FIELD}: {_eq: ${addr}}, amount: {_gt: "0"}}) { contract tokenId amount } }`
  );
  return d.CandiesHolderBalance.map((c) => ({
    contract: c.contract,
    tokenId: String(c.tokenId),
    amount: String(c.amount),
  }));
}
