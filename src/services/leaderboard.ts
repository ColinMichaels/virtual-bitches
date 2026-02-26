import {
  backendApiService,
  type AuthenticatedUserProfile,
  type GlobalLeaderboardEntry,
} from "./backendApi.js";
import { scoreHistoryService, type GameScore } from "./score-history.js";
import { logger } from "../utils/logger.js";
import { firebaseAuthService } from "./firebaseAuth.js";

const log = logger.create("LeaderboardService");
const MAX_FLUSH_PER_BATCH = 8;

export class LeaderboardService {
  private flushInFlight = false;
  private accountProfile: AuthenticatedUserProfile | null = null;

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
      return false;
    }

    scoreHistoryService.markGlobalSynced([score.id]);
    return true;
  }

  async flushPendingScores(limit: number = MAX_FLUSH_PER_BATCH): Promise<number> {
    if (this.flushInFlight) {
      return 0;
    }

    this.flushInFlight = true;
    try {
      await firebaseAuthService.initialize();
      const token = await firebaseAuthService.getIdToken();
      if (!token) {
        return 0;
      }

      const profile = await this.getAccountProfile(true);
      if (!profile || profile.isAnonymous || !profile.leaderboardName?.trim()) {
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
          break;
        }
        submitted += 1;
      }
      return submitted;
    } finally {
      this.flushInFlight = false;
    }
  }

  async getGlobalLeaderboard(limit: number = 200): Promise<GlobalLeaderboardEntry[]> {
    const entries = await backendApiService.getGlobalLeaderboard(limit);
    if (!entries) {
      log.warn("Failed to load global leaderboard");
      return [];
    }
    return entries;
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
  }
}

export const leaderboardService = new LeaderboardService();
