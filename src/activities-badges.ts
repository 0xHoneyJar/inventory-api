/**
 * Federate activities-api grant authority into inventory holdings shape.
 *
 * activities-api remains the grant / verification SoR (BadgeIssued /
 * ActivityCompleted). inventory-api is the holdings projector: wallet →
 * identity resolve → earned badges → Alchemy/SimpleHash-class NFT rows
 * (collection + id + image + attributes + provenance fidelity).
 *
 * Fail-soft at every seam: missing env, resolve miss, transport error → [].
 * Never throw into the owner-list path for config/upstream gaps.
 */

import { badgeFamilyLabel } from "./badge-families.js";
import { DEFAULT_CONTENT_TYPE } from "./transform.js";
import type { NFT } from "../types.js";

const DEFAULT_ACTIVITIES_API_URL = "https://activities.0xhoneyjar.xyz";
const RESOLVE_TIMEOUT_MS = 10_000;

/** Wire shape from activities-api `projectEarnedBadges` read plane. */
export interface EarnedBadgeWire {
  readonly badge_family_id: string;
  readonly activity_id: string;
  readonly identity_id: string;
  readonly source: "badge-issued" | "activity-completed";
  readonly event_id: string;
  readonly issued_at: string;
  readonly uri: string | null;
  readonly snapshot_id: string | null;
}

const SPINE_USER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY_ID_PATTERN = /^id_[a-z0-9]{1,128}$/;

/** Deterministic spine UUID → activities identity id (`id_` + hex). */
export function spineUserIdToIdentityId(spineUserId: string): string | null {
  const trimmed = spineUserId.trim();
  if (IDENTITY_ID_PATTERN.test(trimmed)) return trimmed;
  if (!SPINE_USER_UUID_PATTERN.test(trimmed)) return null;
  const candidate = `id_${trimmed.replace(/-/g, "").toLowerCase()}`;
  return IDENTITY_ID_PATTERN.test(candidate) ? candidate : null;
}

type ActivitiesReadConfig = {
  readonly activitiesBaseUrl: string;
  readonly activitiesToken: string;
  readonly identityBaseUrl: string;
  readonly identityToken: string | null;
};

/** Typed federation config — any missing required piece → null (hermetic empty). */
export function resolveBadgeFederationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ActivitiesReadConfig | null {
  const activitiesToken = env.ACTIVITIES_READ_TOKEN?.trim();
  const identityBaseUrl = env.IDENTITY_API_URL?.trim()?.replace(/\/$/, "");
  if (!activitiesToken || !identityBaseUrl) return null;

  const activitiesBaseUrl = (
    env.ACTIVITIES_API_URL?.trim() || DEFAULT_ACTIVITIES_API_URL
  ).replace(/\/$/, "");
  if (!activitiesBaseUrl) return null;

  const identityToken = env.LINK_SERVICE_TOKEN?.trim() || null;
  return {
    activitiesBaseUrl,
    activitiesToken,
    identityBaseUrl,
    identityToken,
  };
}

export function isBadgeFederationConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveBadgeFederationConfig(env) !== null;
}

async function resolveWalletUserId(
  wallet: string,
  config: ActivitiesReadConfig,
): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.identityToken) {
    headers["x-service-token"] = config.identityToken;
  }

  try {
    const res = await fetch(
      `${config.identityBaseUrl}/v1/resolve/wallet/${encodeURIComponent(wallet)}`,
      {
        headers,
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      },
    );
    if (res.status === 404 || !res.ok) return null;
    const body = (await res.json()) as { user_id?: unknown };
    return typeof body.user_id === "string" && body.user_id.length > 0
      ? body.user_id
      : null;
  } catch {
    return null;
  }
}

function parseBadgesResponse(raw: unknown): EarnedBadgeWire[] {
  if (typeof raw !== "object" || raw === null) return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  const out: EarnedBadgeWire[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const b = item as Record<string, unknown>;
    if (typeof b.badge_family_id !== "string" || b.badge_family_id.length === 0) {
      continue;
    }
    const source =
      b.source === "badge-issued" || b.source === "activity-completed"
        ? b.source
        : null;
    if (!source) continue;
    out.push({
      badge_family_id: b.badge_family_id,
      activity_id: typeof b.activity_id === "string" ? b.activity_id : "",
      identity_id: typeof b.identity_id === "string" ? b.identity_id : "",
      source,
      event_id: typeof b.event_id === "string" ? b.event_id : "",
      issued_at: typeof b.issued_at === "string" ? b.issued_at : "",
      uri: typeof b.uri === "string" ? b.uri : null,
      snapshot_id: typeof b.snapshot_id === "string" ? b.snapshot_id : null,
    });
  }
  return out;
}

async function fetchBadgesForIdentity(
  identityId: string,
  config: ActivitiesReadConfig,
): Promise<EarnedBadgeWire[]> {
  try {
    const res = await fetch(
      `${config.activitiesBaseUrl}/v1/identities/${encodeURIComponent(identityId)}/badges`,
      {
        headers: {
          Accept: "application/json",
          "x-service-token": config.activitiesToken,
        },
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    return parseBadgesResponse(await res.json());
  } catch {
    return [];
  }
}

/**
 * Wallet → spine user_id → activities identity_id → earned badges.
 * Returns [] when federation is unconfigured or any seam fails.
 */
export async function fetchEarnedBadgesForWallet(
  wallet: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EarnedBadgeWire[]> {
  const config = resolveBadgeFederationConfig(env);
  if (!config) return [];

  const address = wallet.trim();
  if (!address) return [];

  const userId = await resolveWalletUserId(address, config);
  if (!userId) return [];

  const identityId = spineUserIdToIdentityId(userId);
  if (!identityId) return [];

  return fetchBadgesForIdentity(identityId, config);
}

/**
 * Project a grant into an Alchemy/SimpleHash-class NFT row.
 * `tokenId` = stable badge_family_id (off-chain until mint-api lands).
 * Provenance fidelity is an attribute (`granted`), not a separate type.
 */
export function earnedBadgeToNFT(badge: EarnedBadgeWire): NFT {
  const name = badgeFamilyLabel(badge.badge_family_id);
  return {
    tokenId: badge.badge_family_id,
    name,
    description: `${name} recognition badge`,
    imageUrl: badge.uri ?? "",
    contentType: DEFAULT_CONTENT_TYPE,
    attributes: [
      { trait_type: "kind", value: "badge" },
      { trait_type: "fidelity", value: "granted" },
      { trait_type: "badge_family_id", value: badge.badge_family_id },
      { trait_type: "issued_at", value: badge.issued_at },
      { trait_type: "source", value: badge.source },
      { trait_type: "activity_id", value: badge.activity_id },
    ],
  };
}
