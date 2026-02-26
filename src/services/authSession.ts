import { environment } from "@env";
import { logger } from "../utils/logger.js";

const log = logger.create("AuthSession");

const AUTH_STORAGE_KEY = `${environment.storage.prefix}-auth-session`;
const ACCESS_TOKEN_SKEW_MS = 15000;
const DEFAULT_REFRESH_TIMEOUT_MS = 8000;

export interface AuthTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
}

interface StoredAuthSession extends AuthTokenBundle {}

export interface RefreshAuthOptions {
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs?: number;
}

export class AuthSessionService {
  private state: StoredAuthSession | null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor() {
    this.state = this.load();
  }

  getAccessToken(): string | null {
    if (!this.state?.accessToken) return null;
    if (this.isAccessTokenExpired()) {
      return null;
    }
    return this.state.accessToken;
  }

  getRefreshToken(): string | null {
    return this.state?.refreshToken ?? null;
  }

  hasRefreshToken(): boolean {
    return typeof this.state?.refreshToken === "string" && this.state.refreshToken.length > 0;
  }

  isAccessTokenExpired(skewMs: number = ACCESS_TOKEN_SKEW_MS): boolean {
    if (!this.state?.expiresAt) return false;
    return Date.now() + skewMs >= this.state.expiresAt;
  }

  setTokens(tokens: AuthTokenBundle): void {
    const current = this.state;
    this.state = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? current?.refreshToken,
      expiresAt: tokens.expiresAt,
      tokenType: tokens.tokenType ?? current?.tokenType ?? "Bearer",
    };
    this.save();
  }

  clear(reason?: string): void {
    this.state = null;
    this.save();
    if (reason) {
      this.dispatchEvent("auth:sessionExpired", { reason });
    }
  }

  markSessionExpired(reason: string): void {
    this.clear(reason);
  }

  async refreshTokens(options: RefreshAuthOptions): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    this.refreshPromise = this.performRefresh(refreshToken, options).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async performRefresh(
    refreshToken: string,
    options: RefreshAuthOptions
  ): Promise<boolean> {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await options.fetchImpl(`${baseUrl}/auth/token/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });

      if (!response.ok) {
        log.warn(`Token refresh failed (${response.status})`);
        this.clear("token_refresh_failed");
        return false;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        log.warn("Token refresh response missing JSON content-type");
        this.clear("token_refresh_invalid_response");
        return false;
      }

      const body = (await response.json()) as Partial<AuthTokenBundle>;
      if (!body || typeof body.accessToken !== "string" || body.accessToken.length === 0) {
        log.warn("Token refresh response missing access token");
        this.clear("token_refresh_invalid_payload");
        return false;
      }

      this.setTokens({
        accessToken: body.accessToken,
        refreshToken: body.refreshToken ?? refreshToken,
        expiresAt: body.expiresAt,
        tokenType: body.tokenType ?? "Bearer",
      });
      this.dispatchEvent("auth:tokenRefreshed", {
        expiresAt: body.expiresAt,
      });
      return true;
    } catch (error) {
      log.warn("Token refresh request error", error);
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private load(): StoredAuthSession | null {
    const storage = getLocalStorage();
    if (!storage) return null;

    try {
      const raw = storage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
      if (!parsed || typeof parsed.accessToken !== "string") {
        return null;
      }

      return {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        expiresAt: parsed.expiresAt,
        tokenType: parsed.tokenType ?? "Bearer",
      };
    } catch (error) {
      log.warn("Failed to load auth session", error);
      return null;
    }
  }

  private save(): void {
    const storage = getLocalStorage();
    if (!storage) return;

    try {
      if (!this.state) {
        storage.removeItem(AUTH_STORAGE_KEY);
        return;
      }
      storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      log.warn("Failed to save auth session", error);
    }
  }

  private dispatchEvent(type: string, detail: unknown): void {
    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }

    document.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function getLocalStorage(): Storage | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage;
}

export const authSessionService = new AuthSessionService();
