import { environment } from "@env";

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const HTTP_URL_REGEX = /^https?:\/\//i;

function isHttpUrl(value: string): boolean {
  return HTTP_URL_REGEX.test(value);
}

function normalizeBaseUrl(rawValue: string | undefined): string {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) {
    return "";
  }
  if (isHttpUrl(value)) {
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

function buildAssetUrlFromBase(base: string, assetPath: string): string {
  if (isHttpUrl(base)) {
    return new URL(assetPath, base).toString();
  }
  return `${base}${assetPath}`;
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  urls.forEach((url) => {
    const value = url.trim();
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    ordered.push(value);
  });

  return ordered;
}

function getConfiguredAssetBaseUrl(): string {
  return normalizeBaseUrl(environment.assetBaseUrl);
}

function getLocalAssetBaseUrl(): string {
  return buildDefaultBasePath();
}

export function getAssetUrlCandidates(assetPath: string): string[] {
  const normalizedPath = normalizeAssetPath(assetPath);
  const configuredBase = getConfiguredAssetBaseUrl();
  const localBase = getLocalAssetBaseUrl();

  if (configuredBase && configuredBase !== localBase) {
    return dedupeUrls([
      buildAssetUrlFromBase(configuredBase, normalizedPath),
      buildAssetUrlFromBase(localBase, normalizedPath),
    ]);
  }

  const base = configuredBase || localBase;
  return [buildAssetUrlFromBase(base, normalizedPath)];
}

export function resolveAssetUrl(assetPath: string): string {
  if (isHttpUrl(assetPath)) {
    return assetPath;
  }
  return getAssetUrlCandidates(assetPath)[0];
}

export function getThemeAssetBase(themeName: string): string {
  return getThemeAssetBaseCandidates(themeName)[0];
}

export function getThemeAssetBaseCandidates(themeName: string): string[] {
  return getAssetUrlCandidates(`assets/themes/${themeName}`);
}

export function getThemeConfigUrlCandidates(themeName: string): string[] {
  return getAssetUrlCandidates(`assets/themes/${themeName}/theme.config.json`);
}

function getOverrideUrlCandidates(overrideUrl: string | undefined, fallbackAssetPath: string): string[] {
  const fallbackCandidates = getAssetUrlCandidates(fallbackAssetPath);
  const override = typeof overrideUrl === "string" ? overrideUrl.trim() : "";
  if (!override) {
    return fallbackCandidates;
  }
  if (isHttpUrl(override)) {
    return dedupeUrls([override, ...fallbackCandidates]);
  }
  return dedupeUrls([resolveAssetUrl(override), ...fallbackCandidates]);
}

export function getRulesMarkdownUrlCandidates(): string[] {
  return getOverrideUrlCandidates(env.VITE_RULES_URL, "rules.md");
}

export function getUpdatesFeedUrlCandidates(): string[] {
  return getOverrideUrlCandidates(env.VITE_UPDATES_URL, "updates.json");
}

export function getBrandLogoUrl(): string {
  return getBrandLogoUrlCandidates()[0];
}

export function getBrandLogoUrlCandidates(): string[] {
  return getOverrideUrlCandidates(env.VITE_BRAND_LOGO_URL, "assets/logos/Biscuits_logo.png");
}

export function getGameMusicUrlCandidates(): string[] {
  return getOverrideUrlCandidates(env.VITE_GAME_MUSIC_URL, "assets/music/game music.mp3");
}
