import { logger } from "../utils/logger.js";
import { resolveAssetUrl } from "./assetUrl.js";

const log = logger.create("BotMemeAvatar");

const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
const DEFAULT_MEME_API_URLS = ["https://api.humorapi.com/memes/random", "https://meme-api.com/gimme"];
const API_FAILURE_COOLDOWN_MS = 60_000;
const AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000;
const HUMOR_API_KEY_QUERY_PARAM = "api-key";

type MemeApiProvider = "apileague" | "humorapi" | "generic";

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

function parsePositiveInt(rawValue: string | undefined, fallback: number, min: number, max: number): number {
  if (typeof rawValue !== "string") {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue.trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  items.forEach((item) => {
    if (!item || seen.has(item)) {
      return;
    }
    seen.add(item);
    ordered.push(item);
  });
  return ordered;
}

function normalizeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) {
    return undefined;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://localhost";
    const parsed = new URL(trimmed, base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeApiKeyHeader(rawHeader: string | undefined): string {
  if (typeof rawHeader !== "string") {
    return "x-api-key";
  }
  const trimmed = rawHeader.trim().toLowerCase();
  if (!trimmed) {
    return "x-api-key";
  }
  return trimmed.replace(/[^a-z0-9-]/g, "") || "x-api-key";
}

export interface BotMemeAvatarRequestOptions {
  excludeUrls?: Iterable<string>;
}

class BotMemeAvatarService {
  private readonly enabled: boolean;
  private readonly apiUrlCandidates: string[];
  private readonly apiKey: string;
  private readonly apiKeyHeader: string;
  private readonly requestTimeoutMs: number;
  private readonly rotationIntervalMs: number;
  private readonly fallbackImageUrls: string[];
  private readonly recentUrls: string[] = [];
  private readonly maxRecentUrls = 20;
  private apiDisabledUntil = 0;
  private missingApiKeyLoggedProviders = new Set<MemeApiProvider>();

  constructor() {
    const configuredApiUrl = normalizeImageUrl(env.VITE_BOT_MEME_API_URL);
    this.apiUrlCandidates = dedupe(
      [
        configuredApiUrl,
        ...DEFAULT_MEME_API_URLS.map((url) => normalizeImageUrl(url)),
      ].filter((value): value is string => typeof value === "string")
    );
    this.apiKey = typeof env.VITE_BOT_MEME_API_KEY === "string" ? env.VITE_BOT_MEME_API_KEY.trim() : "";
    this.apiKeyHeader = normalizeApiKeyHeader(env.VITE_BOT_MEME_API_KEY_HEADER);
    this.enabled = parseBooleanFlag(env.VITE_BOT_MEME_AVATARS_ENABLED, true);
    this.requestTimeoutMs = parsePositiveInt(env.VITE_BOT_MEME_FETCH_TIMEOUT_MS, 5000, 1200, 15000);
    this.rotationIntervalMs = parsePositiveInt(env.VITE_BOT_MEME_ROTATION_MS, 38000, 10000, 120000);
    this.fallbackImageUrls = dedupe(
      [
        resolveAssetUrl("assets/ads/betahelp_ad.png"),
        resolveAssetUrl("assets/logos/Biscuits_logo.png"),
        resolveAssetUrl("assets/game-textures/biscuits_felt_table_texture_darker.jpg"),
      ]
        .map((candidate) => normalizeImageUrl(candidate))
        .filter((candidate): candidate is string => typeof candidate === "string")
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getRotationIntervalMs(): number {
    return this.rotationIntervalMs;
  }

  async getMemeAvatarUrl(options: BotMemeAvatarRequestOptions = {}): Promise<string | undefined> {
    if (!this.enabled) {
      return undefined;
    }

    const excludedUrls = this.normalizeExcludedUrls(options.excludeUrls);
    const fromApi = await this.fetchFromApi(excludedUrls);
    if (fromApi) {
      this.rememberUrl(fromApi);
      return fromApi;
    }

    const fromFallback = this.pickFallbackUrl(excludedUrls);
    if (fromFallback) {
      this.rememberUrl(fromFallback);
      return fromFallback;
    }

    return undefined;
  }

  private normalizeExcludedUrls(excludeUrls: Iterable<string> | undefined): Set<string> {
    const normalized = new Set<string>();
    if (!excludeUrls) {
      return normalized;
    }
    for (const url of excludeUrls) {
      const candidate = normalizeImageUrl(url);
      if (candidate) {
        normalized.add(candidate);
      }
    }
    return normalized;
  }

  private async fetchFromApi(excludedUrls: Set<string>): Promise<string | undefined> {
    if (Date.now() < this.apiDisabledUntil) {
      return undefined;
    }

    for (const apiUrl of this.apiUrlCandidates) {
      if (!this.canCallApiUrl(apiUrl)) {
        continue;
      }

      const candidate = await this.fetchFromSingleApiUrl(apiUrl, excludedUrls);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  private canCallApiUrl(apiUrl: string): boolean {
    const provider = this.detectProvider(apiUrl);
    if (provider === "generic") {
      return true;
    }

    if (this.apiKey || this.apiUrlHasInlineApiKey(apiUrl)) {
      return true;
    }

    if (!this.missingApiKeyLoggedProviders.has(provider)) {
      this.missingApiKeyLoggedProviders.add(provider);
      if (provider === "humorapi") {
        log.info("Skipping HumorAPI meme endpoint because no API key is configured.");
      } else {
        log.info("Skipping APILayer meme endpoint because no API key is configured.");
      }
    }

    return false;
  }

  private async fetchFromSingleApiUrl(
    apiUrl: string,
    excludedUrls: Set<string>
  ): Promise<string | undefined> {
    const requestUrl = this.buildRequestUrl(apiUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (this.apiKey) {
        headers[this.apiKeyHeader] = this.apiKey;
      }

      const response = await fetch(requestUrl, {
        method: "GET",
        cache: "no-store",
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this.apiDisabledUntil = Date.now() + AUTH_FAILURE_COOLDOWN_MS;
        } else if (response.status === 429 || response.status >= 500) {
          this.apiDisabledUntil = Date.now() + API_FAILURE_COOLDOWN_MS;
        }
        return undefined;
      }

      const payload = (await response.json()) as unknown;
      const urls = this.extractCandidateUrls(payload);
      return this.selectUrl(urls, excludedUrls);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractCandidateUrls(payload: unknown): string[] {
    const candidates: string[] = [];
    const append = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach((entry) => append(entry));
        return;
      }
      const normalized = normalizeImageUrl(value);
      if (normalized) {
        candidates.push(normalized);
      }
    };

    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      append(record.url);
      append(record.image);
      append(record.imageUrl);
      append(record.memeUrl);
      append(record.photoUrl);
      append(record.src);
      append(record.preview);
      if (record.data && typeof record.data === "object") {
        const data = record.data as Record<string, unknown>;
        append(data.url);
        append(data.image);
        append(data.imageUrl);
        append(data.src);
        append(data.preview);
      }
      if (record.meme && typeof record.meme === "object") {
        const meme = record.meme as Record<string, unknown>;
        append(meme.url);
        append(meme.imageUrl);
      }
    } else {
      append(payload);
    }

    return dedupe(candidates);
  }

  private detectProvider(apiUrl: string): MemeApiProvider {
    if (/apileague\.com/i.test(apiUrl)) {
      return "apileague";
    }
    if (/humorapi\.com/i.test(apiUrl)) {
      return "humorapi";
    }
    return "generic";
  }

  private apiUrlHasInlineApiKey(apiUrl: string): boolean {
    try {
      const parsed = new URL(apiUrl);
      const key =
        parsed.searchParams.get(HUMOR_API_KEY_QUERY_PARAM) ??
        parsed.searchParams.get("apikey") ??
        parsed.searchParams.get("api_key") ??
        parsed.searchParams.get("x-api-key");
      return typeof key === "string" && key.trim().length > 0;
    } catch {
      return false;
    }
  }

  private buildRequestUrl(apiUrl: string): string {
    const provider = this.detectProvider(apiUrl);
    if (provider !== "humorapi" || !this.apiKey) {
      return apiUrl;
    }

    try {
      const parsed = new URL(apiUrl);
      if (!parsed.searchParams.has(HUMOR_API_KEY_QUERY_PARAM)) {
        parsed.searchParams.set(HUMOR_API_KEY_QUERY_PARAM, this.apiKey);
      }
      return parsed.toString();
    } catch {
      return apiUrl;
    }
  }

  private selectUrl(candidates: string[], excludedUrls: Set<string>): string | undefined {
    const fromApi = candidates.find(
      (candidate) => !excludedUrls.has(candidate) && !this.recentUrls.includes(candidate)
    );
    if (fromApi) {
      return fromApi;
    }
    return candidates.find((candidate) => !excludedUrls.has(candidate));
  }

  private pickFallbackUrl(excludedUrls: Set<string>): string | undefined {
    if (this.fallbackImageUrls.length === 0) {
      return undefined;
    }

    const shuffled = [...this.fallbackImageUrls];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const swapIndex = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[i]];
    }

    const nonRecent = shuffled.find(
      (candidate) => !excludedUrls.has(candidate) && !this.recentUrls.includes(candidate)
    );
    if (nonRecent) {
      return nonRecent;
    }
    return shuffled.find((candidate) => !excludedUrls.has(candidate));
  }

  private rememberUrl(url: string): void {
    const normalized = normalizeImageUrl(url);
    if (!normalized) {
      return;
    }
    const existingIndex = this.recentUrls.indexOf(normalized);
    if (existingIndex >= 0) {
      this.recentUrls.splice(existingIndex, 1);
    }
    this.recentUrls.push(normalized);
    while (this.recentUrls.length > this.maxRecentUrls) {
      this.recentUrls.shift();
    }
  }
}

export const botMemeAvatarService = new BotMemeAvatarService();
