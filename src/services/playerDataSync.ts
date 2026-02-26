import { environment } from "@env";
import type { UpgradeProgressionState } from "../chaos/upgrades/types.js";
import type { CameraAttackMessage } from "../chaos/types.js";
import { upgradeProgressionService } from "../chaos/upgrades/progressionService.js";
import { logger } from "../utils/logger.js";
import { backendApiService, type GameLogRecord, type PlayerProfileRecord } from "./backendApi.js";
import { getLocalPlayerId } from "./playerIdentity.js";
import { pwaService } from "./pwa.js";
import { scoreHistoryService } from "./score-history.js";
import { settingsService } from "./settings.js";

const log = logger.create("PlayerDataSync");

const LOG_QUEUE_KEY = `${environment.storage.prefix}-game-log-queue`;
const MAX_QUEUED_LOGS = 300;
const PROFILE_SYNC_DEBOUNCE_MS = 1500;
const PROFILE_SYNC_INTERVAL_MS = 45000;
const SYNC_BACKOFF_BASE_MS = 1500;
const SYNC_BACKOFF_MAX_MS = 60000;
const MAX_SYNC_BACKOFF_STEPS = 6;

export class PlayerDataSyncService {
  private readonly playerId: string;
  private started = false;
  private syncIntervalHandle?: ReturnType<typeof setInterval>;
  private pendingProfileSync?: ReturnType<typeof setTimeout>;
  private unsubscribeSettings?: () => void;
  private unsubscribeProgression?: () => void;
  private logQueue: GameLogRecord[] = [];
  private applyingRemoteSnapshot = false;
  private sessionId?: string;
  private profileDirty = true;
  private flushInFlight = false;
  private syncFailureCount = 0;
  private nextFlushAttemptAt = 0;

  private readonly onCameraAttack = (event: Event) => {
    const custom = event as CustomEvent<CameraAttackMessage>;
    if (!custom.detail) return;
    const attack = custom.detail;

    this.enqueueLog("camera_attack", {
      abilityId: attack.abilityId,
      level: attack.level,
      effectType: attack.effectType,
      duration: attack.duration,
      intensity: attack.intensity,
      targetId: attack.targetId,
    });
  };

  private readonly onOnline = () => {
    this.nextFlushAttemptAt = 0;
    void this.flushAll();
  };

  constructor(playerId: string = getLocalPlayerId()) {
    this.playerId = playerId;
    this.logQueue = this.loadQueue();
    this.sessionId = this.readSessionIdFromUrl();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.unsubscribeSettings = settingsService.onChange((settings) => {
      if (!this.applyingRemoteSnapshot) {
        this.profileDirty = true;
        this.scheduleProfileSync();
      }

      this.enqueueLog("settings_changed", {
        controls: settings.controls,
        display: settings.display,
      });
    });

    this.unsubscribeProgression = upgradeProgressionService.on("changed", (state) => {
      if (!this.applyingRemoteSnapshot) {
        this.profileDirty = true;
        this.scheduleProfileSync();
      }

      this.enqueueLog("upgrade_progression_changed", summarizeProgression(state));
    });

    if (typeof document !== "undefined") {
      document.addEventListener("chaos:cameraAttack", this.onCameraAttack as EventListener);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }

    this.syncIntervalHandle = setInterval(() => {
      void this.flushAll();
    }, PROFILE_SYNC_INTERVAL_MS);

    void this.bootstrap();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    this.unsubscribeSettings?.();
    this.unsubscribeSettings = undefined;
    this.unsubscribeProgression?.();
    this.unsubscribeProgression = undefined;

    if (this.pendingProfileSync) {
      clearTimeout(this.pendingProfileSync);
      this.pendingProfileSync = undefined;
    }
    if (this.syncIntervalHandle) {
      clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = undefined;
    }

    if (typeof document !== "undefined") {
      document.removeEventListener("chaos:cameraAttack", this.onCameraAttack as EventListener);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }
  }

  getPlayerId(): string {
    return this.playerId;
  }

  setSessionId(sessionId: string | undefined): void {
    this.sessionId = sessionId?.trim() || undefined;
  }

  enqueueLog(type: string, payload: unknown): void {
    const entry: GameLogRecord = {
      id: this.generateId("log"),
      playerId: this.playerId,
      sessionId: this.sessionId,
      type,
      timestamp: Date.now(),
      payload,
    };

    if (this.shouldCompactWithPrevious(entry.type)) {
      this.logQueue[this.logQueue.length - 1] = entry;
    } else {
      this.logQueue.push(entry);
    }

    if (this.logQueue.length > MAX_QUEUED_LOGS) {
      this.logQueue.splice(0, this.logQueue.length - MAX_QUEUED_LOGS);
    }
    this.saveQueue();
  }

  private async bootstrap(): Promise<void> {
    await this.pullRemoteProfile();
    this.profileDirty = true;
    this.scheduleProfileSync(200);
    await this.flushAll();
  }

  private scheduleProfileSync(delayMs: number = PROFILE_SYNC_DEBOUNCE_MS): void {
    if (this.pendingProfileSync) {
      clearTimeout(this.pendingProfileSync);
    }

    this.pendingProfileSync = setTimeout(() => {
      this.pendingProfileSync = undefined;
      void this.flushAll();
    }, delayMs);
  }

  private async pullRemoteProfile(): Promise<void> {
    const remote = await backendApiService.getPlayerProfile(this.playerId);
    if (!remote) return;

    this.applyingRemoteSnapshot = true;
    try {
      settingsService.replaceSettings(remote.settings);
      upgradeProgressionService.replaceState(remote.upgradeProgression);
      this.enqueueLog("profile_pull_success", {
        updatedAt: remote.updatedAt,
      });
    } finally {
      this.applyingRemoteSnapshot = false;
    }
  }

  private async syncProfile(): Promise<boolean> {
    if (!this.profileDirty) {
      return true;
    }

    const profile: PlayerProfileRecord = {
      playerId: this.playerId,
      settings: settingsService.getSettings(),
      upgradeProgression: upgradeProgressionService.getState(),
      updatedAt: Date.now(),
    };

    const saved = await backendApiService.upsertPlayerProfile(profile);
    if (!saved) return false;

    this.profileDirty = false;
    log.debug("Player profile synced");
    return true;
  }

  private async flushAll(): Promise<void> {
    if (!this.started || this.flushInFlight) {
      return;
    }

    const now = Date.now();
    if (now < this.nextFlushAttemptAt) {
      return;
    }

    this.flushInFlight = true;
    try {
      const profileOk = await this.syncProfile();
      const scoreLogsOk = await this.flushScoreLogs();
      const queuedLogsOk = await this.flushQueuedLogs();
      const syncComplete = profileOk && scoreLogsOk && queuedLogsOk;

      if (syncComplete) {
        this.resetSyncBackoff();
      } else {
        this.applySyncBackoff();
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  private async flushQueuedLogs(): Promise<boolean> {
    if (this.logQueue.length === 0) return true;

    const batch = [...this.logQueue];
    const endpoint = `${normalizeBaseUrl(environment.apiBaseUrl)}/logs/batch`;

    const workerResult = await pwaService.syncGameLogs(batch, endpoint);
    if (workerResult.ok) {
      this.removeAcceptedLogs(workerResult.accepted);
      return workerResult.accepted >= batch.length;
    }

    const response = await backendApiService.appendGameLogs(batch);
    if (!response) return false;

    this.removeAcceptedLogs(response.accepted);
    return response.accepted >= batch.length && response.failed <= 0;
  }

  private async flushScoreLogs(): Promise<boolean> {
    const unsynced = scoreHistoryService.getUnsyncedScores();
    if (unsynced.length === 0) return true;

    const logs: GameLogRecord[] = unsynced.map((score) => ({
      id: `score-${score.id}`,
      playerId: this.playerId,
      sessionId: this.sessionId,
      type: "score_saved",
      timestamp: score.timestamp,
      payload: {
        scoreId: score.id,
        score: score.score,
        seed: score.seed,
        duration: score.duration,
        rollCount: score.rollCount,
        mode: score.mode,
      },
    }));

    const response = await backendApiService.appendGameLogs(logs);
    if (!response || response.accepted <= 0) return false;

    const acceptedScoreIds = unsynced.slice(0, response.accepted).map((entry) => entry.id);
    scoreHistoryService.markSynced(acceptedScoreIds);
    log.debug(`Synced ${acceptedScoreIds.length} score logs`);
    return response.accepted >= logs.length && response.failed <= 0;
  }

  private removeAcceptedLogs(accepted: number): void {
    const safeAccepted = Math.max(0, Math.min(this.logQueue.length, Math.floor(accepted)));
    if (safeAccepted <= 0) return;

    this.logQueue.splice(0, safeAccepted);
    this.saveQueue();
    log.debug(`Flushed ${safeAccepted} queued logs`);
  }

  private loadQueue(): GameLogRecord[] {
    if (typeof localStorage === "undefined") {
      return [];
    }

    try {
      const raw = localStorage.getItem(LOG_QUEUE_KEY);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as GameLogRecord[];
      if (!Array.isArray(parsed)) return [];

      const deduped = new Map<string, GameLogRecord>();
      parsed.forEach((entry) => {
        if (!entry || typeof entry.type !== "string" || typeof entry.id !== "string") {
          return;
        }
        deduped.set(entry.id, entry);
      });

      const compacted = Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
      if (compacted.length > MAX_QUEUED_LOGS) {
        return compacted.slice(compacted.length - MAX_QUEUED_LOGS);
      }
      return compacted;
    } catch (error) {
      log.warn("Failed to load log queue", error);
      return [];
    }
  }

  private saveQueue(): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      localStorage.setItem(LOG_QUEUE_KEY, JSON.stringify(this.logQueue));
    } catch (error) {
      log.warn("Failed to save log queue", error);
    }
  }

  private readSessionIdFromUrl(): string | undefined {
    if (typeof window === "undefined") {
      return undefined;
    }

    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    return sessionId?.trim() || undefined;
  }

  private shouldCompactWithPrevious(type: string): boolean {
    if (this.logQueue.length === 0) {
      return false;
    }

    const last = this.logQueue[this.logQueue.length - 1];
    return (
      (type === "settings_changed" || type === "upgrade_progression_changed") &&
      last.type === type &&
      last.playerId === this.playerId
    );
  }

  private resetSyncBackoff(): void {
    this.syncFailureCount = 0;
    this.nextFlushAttemptAt = 0;
  }

  private applySyncBackoff(): void {
    this.syncFailureCount = Math.min(this.syncFailureCount + 1, MAX_SYNC_BACKOFF_STEPS);
    const exponent = Math.max(0, this.syncFailureCount - 1);
    const baseDelay = Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** exponent);
    const jitter = Math.floor(Math.random() * 300);
    const delay = baseDelay + jitter;

    this.nextFlushAttemptAt = Date.now() + delay;
    log.warn(`Data sync incomplete, retrying in ~${delay}ms`);
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function summarizeProgression(state: UpgradeProgressionState): unknown {
  return {
    chaosTokens: state.chaosTokens,
    levels: Object.fromEntries(
      Object.entries(state.abilities).map(([abilityId, progress]) => [abilityId, progress.unlockedLevel])
    ),
  };
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const playerDataSyncService = new PlayerDataSyncService();
