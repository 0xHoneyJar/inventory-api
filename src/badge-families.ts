/**
 * Known activities-api badge family labels for inventory projection.
 * Art URIs come from the grant response (activities-api STATIC_BADGE_REGISTRY);
 * Kindling's CDN URI is only a local fallback for hermetic/fixture paths.
 */

export const KINDLING_BADGE_FAMILY = {
  id: "kindling",
  label: "Kindling",
  uri: "https://assets.0xhoneyjar.xyz/mibera/badges/kindling.png",
} as const;

const FAMILY_LABELS: Readonly<Record<string, string>> = {
  [KINDLING_BADGE_FAMILY.id]: KINDLING_BADGE_FAMILY.label,
  verify: "Verified",
  "donation-raffle": "Donation raffle",
};

/** Operator-facing label for a badge_family_id (known map, else title-case). */
export function badgeFamilyLabel(familyId: string): string {
  const known = FAMILY_LABELS[familyId];
  if (known) return known;
  return familyId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
