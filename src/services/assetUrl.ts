import { environment } from "@env";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};

function normalizeBaseUrl(rawValue: string | undefined): string {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value.endsWith("/") ? value : `${value}/`;
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeAssetPath(assetPath: string): string {
  return assetPath.replace(/^\.?\//, "").replace(/^\/+/, "");
}

function buildDefaultBasePath(): string {
  const viteBase = typeof import.meta.env.BASE_URL === "string" ? import.meta.env.BASE_URL : "./";
  return viteBase.endsWith("/") ? viteBase : `${viteBase}/`;
}

export function getAssetBaseUrl(): string {
  const configured = normalizeBaseUrl(environment.assetBaseUrl);
  if (configured) {
    return configured;
  }
  return buildDefaultBasePath();
}

export function resolveAssetUrl(assetPath: string): string {
  if (/^https?:\/\//i.test(assetPath)) {
    return assetPath;
  }
  const normalizedPath = normalizeAssetPath(assetPath);
  const base = getAssetBaseUrl();
  if (/^https?:\/\//i.test(base)) {
    return new URL(normalizedPath, base).toString();
  }
  return `${base}${normalizedPath}`;
}

export function getThemeAssetBase(themeName: string): string {
  return resolveAssetUrl(`assets/themes/${themeName}`);
}

export function getThemeConfigUrl(themeName: string): string {
  return resolveAssetUrl(`assets/themes/${themeName}/theme.config.json`);
}

export function getRulesMarkdownUrl(): string {
  const override = env.VITE_RULES_URL?.trim();
  if (override) {
    return override;
  }
  return resolveAssetUrl("rules.md");
}

export function getUpdatesFeedUrl(): string {
  const override = env.VITE_UPDATES_URL?.trim();
  if (override) {
    return override;
  }
  return resolveAssetUrl("updates.json");
}

export function getBrandLogoUrl(): string {
  const override = env.VITE_BRAND_LOGO_URL?.trim();
  if (override) {
    return override;
  }
  return resolveAssetUrl("assets/logos/Biscuits_logo.png");
}

export function getGameMusicUrl(): string {
  const override = env.VITE_GAME_MUSIC_URL?.trim();
  if (override) {
    return override;
  }
  return resolveAssetUrl("assets/music/game music.mp3");
}
