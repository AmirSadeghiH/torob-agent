import type { ShopIdentity } from "../../shared/types";

/**
 * Shop identity rule (challenge dataset):
 * 6,364 of 6,476 shop names are synthetic placeholders, so a non-empty `name`
 * is not proof of a real business. Only shops that carry a registered website
 * or Instagram handle keep their recorded name — and even that is shown as
 * "recorded", never as independently verified.
 */

const NULLISH = new Set(["", "null", "none", "undefined"]);

export function hasRegistryRecord(
  website: string | null | undefined,
  instagram: string | null | undefined,
): boolean {
  const clean = (value: string | null | undefined) =>
    !NULLISH.has(String(value ?? "").trim().toLowerCase());
  return clean(website) || clean(instagram);
}

export function shopIdentity(website: string | null, instagram: string | null): ShopIdentity {
  return hasRegistryRecord(website, instagram) ? "registered" : "anonymized";
}

/** Stable, collision-free-enough short code derived from the dataset id. */
export function shopShortCode(shopId: string): string {
  return shopId.replace(/^shop_/i, "").slice(-7).toUpperCase();
}

export const ANONYMIZED_SHOP_PREFIX = "فروشگاه ناشناس‌شده";

export function shopDisplayName(
  shopId: string,
  recordedName: string | null | undefined,
  registered: boolean,
): string {
  const clean = String(recordedName ?? "").trim();
  if (registered && clean && !NULLISH.has(clean.toLowerCase())) return clean;
  return `${ANONYMIZED_SHOP_PREFIX} #${shopShortCode(shopId)}`;
}
