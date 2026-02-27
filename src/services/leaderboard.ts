import {
  backendApiService,
  type AuthenticatedUserProfile,
  type GlobalLeaderboardEntry,
} from "./backendApi.js";
import { environment } from "@env";
import { scoreHistoryService, type GameScore } from "./score-history.js";
import { logger } from "../utils/logger.js";
import { firebaseAuthService } from "./firebaseAuth.js";

const log = logger.create("LeaderboardService");
const MAX_FLUSH_PER_BATCH = 8;
const MAX_SERVER_LEADERBOARD_ENTRIES = 200;
const AUTO_SYNC_INTERVAL_MS = 30000;

export type LeaderboardSyncState = "idle" | "syncing" | "offline" | "error";

export interface LeaderboardSyncStatus {
  state: LeaderboardSyncState;
  pendingGlobalScores: number;
  lastAttemptAt: number;
  lastSuccessAt: number;
  lastErrorAt: number;
  lastFetchedAt: number;
}

export class LeaderboardService {
  private flushInFlight = false;
  private accountProfile: AuthenticatedUserProfile | null = null;
  private autoSyncStarted = false;
  private autoSyncIntervalHandle?: ReturnType<typeof setInterval>;
  private syncStatus: LeaderboardSyncStatus = {
    state: "idle",
    pendingGlobalScores: 0,
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastErrorAt: 0,
    lastFetchedAt: 0,
  };
  private readonly onOnline = () => {
    void this.flushPendingScores();
  };
  private readonly onFirebaseAuthChanged = () => {
    this.clearCachedProfile();
    void this.flushPendingScores();
  };

  constructor() {
    this.emitSyncStatusChanged();
    this.startAutoSync();
  }

  async submitScore(score: GameScore): Promise<boolean> {
    if (score.globalSynced) {
      return true;
    }

    const profile = await this.getAccountProfile(true);
    const leaderboardName = profile?.leaderboardName?.trim();
    if (!profile || profile.isAnonymous || !leaderboardName) {
      return false;
    }

    const result = await backendApiService.submitLeaderboardScore({
      scoreId: score.id,
      score: score.score,
      timestamp: score.timestamp,
      seed: score.seed,
      duration: score.duration,
      rollCount: score.rollCount,
      mode: {
        difficulty: score.mode?.difficulty,
        variant: score.mode?.variant,
      },
      playerName: leaderboardName,
    });

    if (!result) {
      this.syncStatus.lastErrorAt = Date.now();
      this.syncStatus.state = isNavigatorOnline() ? "error" : "offline";
      this.emitSyncStatusChanged();
      return false;
    }

    scoreHistoryService.markGlobalSynced([score.id]);
    this.syncStatus.state = "idle";
    this.syncStatus.lastSuccessAt = Date.now();
    this.syncStatus.lastErrorAt = 0;
    this.emitSyncStatusChanged();
    return true;
  }

  async flushPendingScores(limit: number = MAX_FLUSH_PER_BATCH): Promise<number> {
    if (this.flushInFlight) {
      return 0;
    }

    this.flushInFlight = true;
    this.syncStatus.state = "syncing";
    this.syncStatus.lastAttemptAt = Date.now();
    this.emitSyncStatusChanged();
    try {
      await firebaseAuthService.initialize();
      const token = await firebaseAuthService.getIdToken();
      if (!token) {
        this.syncStatus.state = "idle";
        this.emitSyncStatusChanged();
        return 0;
      }

      const profile = await this.getAccountProfile(true);
      if (!profile || profile.isAnonymous || !profile.leaderboardName?.trim()) {
        this.syncStatus.state = "idle";
        this.emitSyncStatusChanged();
        return 0;
      }

      const pending = scoreHistoryService
        .getUnsyncedGlobalScores()
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, Math.max(1, Math.floor(limit)));

      let submitted = 0;
      for (const score of pending) {
        const ok = await this.submitScore(score);
        if (!ok) {
          this.syncStatus.state = isNavigatorOnline() ? "error" : "offline";
          this.syncStatus.lastErrorAt = Date.now();
          this.emitSyncStatusChanged();
          break;
        }
        submitted += 1;
      }
      if (submitted > 0) {
        this.syncStatus.state = "idle";
        this.syncStatus.lastSuccessAt = Date.now();
        this.syncStatus.lastErrorAt = 0;
      } else if (this.syncStatus.state === "syncing") {
        this.syncStatus.state = "idle";
      }
      this.emitSyncStatusChanged();
      return submitted;
    } finally {
      this.flushInFlight = false;
    }
  }

  async getGlobalLeaderboard(limit: number = 200): Promise<GlobalLeaderboardEntry[] | null> {
    await this.flushPendingScores();

    const entries = await backendApiService.getGlobalLeaderboard(limit);
    if (!entries) {
      const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
      log.error("Failed to load global leaderboard from API", {
        limit,
        online: isNavigatorOnline(),
        apiBaseUrl: environment.apiBaseUrl,
        endpoint: `${normalizeApiBaseUrl(environment.apiBaseUrl)}/leaderboard/global?limit=${boundedLimit}`,
      });
      this.syncStatus.state = isNavigatorOnline() ? "error" : "offline";
      this.syncStatus.lastErrorAt = Date.now();
      this.emitSyncStatusChanged();
      return null;
    }

    const normalized = entries
      .filter((entry) => Number.isFinite(entry?.score))
      .sort(compareLeaderboardEntries)
      .slice(0, MAX_SERVER_LEADERBOARD_ENTRIES);
    this.syncStatus.lastFetchedAt = Date.now();
    this.syncStatus.state = "idle";
    this.syncStatus.lastErrorAt = 0;
    this.emitSyncStatusChanged();
    return normalized.slice(0, Math.max(1, Math.min(200, Math.floor(limit))));
  }

  async getAccountProfile(forceRefresh = false): Promise<AuthenticatedUserProfile | null> {
    if (!forceRefresh && this.accountProfile) {
      return this.accountProfile;
    }

    const profile = await backendApiService.getAuthenticatedUserProfile();
    this.accountProfile = profile;
    return profile;
  }

  async setLeaderboardName(displayName: string): Promise<AuthenticatedUserProfile | null> {
    const normalized = displayName.trim();
    if (!normalized) {
      return null;
    }

    const profile = await backendApiService.updateAuthenticatedUserProfile(normalized);
    if (!profile) {
      return null;
    }

    this.accountProfile = profile;
    return profile;
  }

  clearCachedProfile(): void {
    this.accountProfile = null;
    this.emitSyncStatusChanged();
  }

  getSyncStatus(): LeaderboardSyncStatus {
    return { ...this.syncStatus, pendingGlobalScores: scoreHistoryService.getUnsyncedGlobalScores().length };
  }

  startAutoSync(): void {
    if (this.autoSyncStarted) {
      return;
    }
    if (typeof window === "undefined" && typeof document === "undefined") {
      return;
    }
    this.autoSyncStarted = true;

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener(
        "auth:firebaseUserChanged",
        this.onFirebaseAuthChanged as EventListener
      );
    }

    this.autoSyncIntervalHandle = setInterval(() => {
      void this.flushPendingScores();
    }, AUTO_SYNC_INTERVAL_MS);
    this.emitSyncStatusChanged();
  }

  private emitSyncStatusChanged(): void {
    this.syncStatus.pendingGlobalScores = scoreHistoryService.getUnsyncedGlobalScores().length;

    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }

    document.dispatchEvent(
      new CustomEvent<LeaderboardSyncStatus>("sync:leaderboardStatusChanged", {
        detail: this.getSyncStatus(),
      })
    );
  }
}

export const leaderboardService = new LeaderboardService();

function compareLeaderboardEntries(a: GlobalLeaderboardEntry, b: GlobalLeaderboardEntry): number {
  const scoreDiff = a.score - b.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const durationDiff = (a.duration ?? 0) - (b.duration ?? 0);
  if (durationDiff !== 0) {
    return durationDiff;
  }

  const rollCountDiff = (a.rollCount ?? 0) - (b.rollCount ?? 0);
  if (rollCountDiff !== 0) {
    return rollCountDiff;
  }

  return (a.timestamp ?? 0) - (b.timestamp ?? 0);
}

function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
    return true;
  }
  return navigator.onLine;
}

function normalizeApiBaseUrl(baseUrl: string): string {
  if (!baseUrl) {
    return "/api";
  }
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}
