import {
  assertGameBrandConfig,
  defaultGameBrandConfig,
  type GameBrandConfig,
} from "./game-brand.config.js";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};

function parseBooleanFlag(rawValue: string | undefined, fallback: boolean): boolean {
  if (typeof rawValue !== "string") {
    return fallback;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseContentRatingNotes(rawValue: string | undefined): string[] {
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    return [];
  }
  return rawValue
    .split("|")
    .map((entry) => entry.trim())
    .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
}

export function resolveGameBrandConfig(): GameBrandConfig {
  const productName =
    typeof env.VITE_BRAND_PRODUCT_NAME === "string" && env.VITE_BRAND_PRODUCT_NAME.trim().length > 0
      ? env.VITE_BRAND_PRODUCT_NAME.trim()
      : defaultGameBrandConfig.productName;

  const resolved: GameBrandConfig = {
    productName,
    logoUrl:
      typeof env.VITE_BRAND_LOGO_URL === "string" && env.VITE_BRAND_LOGO_URL.trim().length > 0
        ? env.VITE_BRAND_LOGO_URL.trim()
        : defaultGameBrandConfig.logoUrl,
    ogTitle:
      typeof env.VITE_BRAND_OG_TITLE === "string" && env.VITE_BRAND_OG_TITLE.trim().length > 0
        ? env.VITE_BRAND_OG_TITLE.trim()
        : `${productName} - Push Your Luck Dice Game`,
    ogDescription:
      typeof env.VITE_BRAND_OG_DESCRIPTION === "string" &&
      env.VITE_BRAND_OG_DESCRIPTION.trim().length > 0
        ? env.VITE_BRAND_OG_DESCRIPTION.trim()
        : `Roll low, score lower, and challenge friends in ${productName}.`,
    ageGateRequired: parseBooleanFlag(
      env.VITE_BRAND_AGE_GATE_REQUIRED,
      defaultGameBrandConfig.ageGateRequired
    ),
    contentRatingNotes:
      parseContentRatingNotes(env.VITE_BRAND_CONTENT_RATING_NOTES).length > 0
        ? parseContentRatingNotes(env.VITE_BRAND_CONTENT_RATING_NOTES)
        : defaultGameBrandConfig.contentRatingNotes,
  };

  assertGameBrandConfig(resolved);
  return Object.freeze(resolved);
}

export const gameBrand = resolveGameBrandConfig();

export function applyBrandMetadataToDocument(): void {
  if (typeof document === "undefined") {
    return;
  }

  document.title = gameBrand.ogTitle;

  const descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (descriptionMeta) {
    descriptionMeta.content = gameBrand.ogDescription;
  }

  const appleTitleMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-title"]'
  );
  if (appleTitleMeta) {
    appleTitleMeta.content = gameBrand.productName;
  }
}
