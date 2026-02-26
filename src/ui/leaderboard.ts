/**
 * Leaderboard Modal
 * Displays personal score history and statistics
 */

import { scoreHistoryService, GameScore } from "../services/score-history.js";
import { audioService } from "../services/audio.js";
import { getDifficultyName } from "../engine/modes.js";
import {
  leaderboardService,
  type LeaderboardSyncStatus,
} from "../services/leaderboard.js";
import { firebaseAuthService } from "../services/firebaseAuth.js";
import {
  backendApiService,
  type AuthenticatedUserProfile,
  type GlobalLeaderboardEntry,
  type PlayerScoreRecord,
} from "../services/backendApi.js";
import {
  playerDataSyncService,
  type PlayerDataSyncStatus,
} from "../services/playerDataSync.js";
import { logger } from "../utils/logger.js";
import { modalManager } from "./modalManager.js";

const log = logger.create("LeaderboardModal");
type SyncIndicatorTone = "ok" | "syncing" | "pending" | "offline" | "error";

export class LeaderboardModal {
  private container: HTMLElement;
  private contentContainer: HTMLElement;
  private onReplay: ((score: GameScore) => void) | null = null;
  private activeTab: "personal" | "global" = "personal";
  private personalRenderVersion = 0;
  private globalRenderVersion = 0;
  private savingLeaderboardName = false;
  private readonly onFirebaseAuthChanged = () => {
    leaderboardService.clearCachedProfile();
    if (this.activeTab === "global" && this.isVisible()) {
      void this.renderGlobalLeaderboard();
    }
    this.updateSyncIndicator();
  };
  private readonly onDataSyncStatusChanged = () => {
    this.updateSyncIndicator();
  };
  private readonly onLeaderboardSyncStatusChanged = () => {
    this.updateSyncIndicator();
  };

  constructor() {
    this.container = this.createModal();
    this.contentContainer = this.container.querySelector(".leaderboard-content")!;
    document.body.appendChild(this.container);
    modalManager.register({
      id: "leaderboard-modal",
      close: () => this.hide(),
    });
    document.addEventListener("auth:firebaseUserChanged", this.onFirebaseAuthChanged as EventListener);
    document.addEventListener(
      "sync:playerDataStatusChanged",
      this.onDataSyncStatusChanged as EventListener
    );
    document.addEventListener(
      "sync:leaderboardStatusChanged",
      this.onLeaderboardSyncStatusChanged as EventListener
    );
    this.updateSyncIndicator();
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "leaderboard-modal";
    modal.className = "modal";
    const syncIndicator = this.getSyncIndicatorState();
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content leaderboard-modal-content">
        <div class="modal-header">
          <h2>Leaderboard</h2>
          <div
            id="leaderboard-sync-indicator"
            class="sync-indicator sync-indicator--${syncIndicator.tone}"
            title="${escapeAttribute(syncIndicator.title)}"
          >
            <span class="sync-indicator-dot" aria-hidden="true"></span>
            <span class="sync-indicator-label">${escapeHtml(syncIndicator.label)}</span>
          </div>
          <button class="modal-close" title="Close (ESC)">&times;</button>
        </div>
        <div class="leaderboard-tabs">
          <button class="tab-btn active" data-tab="personal">My Scores</button>
          <button class="tab-btn" data-tab="global">Global</button>
        </div>
        <div class="leaderboard-content">
          <!-- Content will be dynamically populated -->
        </div>
      </div>
    `;

    // Close button
    modal.querySelector(".modal-close")!.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
    });

    // Backdrop click
    modal.querySelector(".modal-backdrop")!.addEventListener("click", () => {
      this.hide();
    });

    // Tab switching
    modal.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        audioService.playSfx("click");
        const tab = btn.getAttribute("data-tab")!;
        this.switchTab(tab as "personal" | "global");
      });
    });

    return modal;
  }

  private switchTab(tab: "personal" | "global") {
    this.activeTab = tab;

    // Update active tab
    this.container.querySelectorAll(".tab-btn").forEach((btn) => {
      if (btn.getAttribute("data-tab") === tab) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Render appropriate content
    if (tab === "personal") {
      void this.renderPersonalScores();
    } else {
      void this.renderGlobalLeaderboard();
    }
    this.updateSyncIndicator();
  }

  private async renderPersonalScores(): Promise<void> {
    const renderVersion = ++this.personalRenderVersion;
    this.contentContainer.innerHTML = `
      <div class="global-placeholder">
        <h3>My Scores</h3>
        <p>Loading synced score history...</p>
      </div>
    `;

    const profilePlayerId = playerDataSyncService.getPlayerId();
    const response = await backendApiService.getPlayerScores(profilePlayerId, 200);
    if (this.activeTab !== "personal" || renderVersion !== this.personalRenderVersion) {
      return;
    }

    if (!response) {
      this.contentContainer.innerHTML = `
        <div class="global-placeholder">
          <h3>My Scores</h3>
          <p>Unable to load server score history right now.</p>
        </div>
      `;
      return;
    }

    const stats = response.stats;
    const topScores = response.entries.slice(0, 10);

    this.contentContainer.innerHTML = `
      <div class="stats-summary">
        <div class="stat-box">
          <div class="stat-label">Total Games</div>
          <div class="stat-value">${stats.totalGames}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Best Score</div>
          <div class="stat-value">${stats.bestScore || "-"}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Average</div>
          <div class="stat-value">${stats.averageScore || "-"}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Play Time</div>
          <div class="stat-value">${this.formatDuration(stats.totalPlayTime)}</div>
        </div>
      </div>

      <div class="scores-section">
        <div class="section-header">
          <h3>Top 10 Synced Scores</h3>
        </div>
        ${topScores.length > 0 ? this.renderServerScoreList(topScores) : '<p class="empty-message">No synced scores yet. Finish a game to publish your history.</p>'}
      </div>
    `;

    this.contentContainer.querySelectorAll(".btn-replay").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        audioService.playSfx("click");
        const scoreId = (e.currentTarget as HTMLElement).getAttribute("data-score-id") ?? "";
        if (!scoreId) {
          return;
        }
        const score = scoreHistoryService.getScore(scoreId);
        if (score && this.onReplay) {
          this.hide();
          this.onReplay(score);
        }
      });
    });
  }

  private renderServerScoreList(scores: PlayerScoreRecord[]): string {
    return `
      <div class="score-list">
        ${scores.map((score, index) => {
          const normalizedDifficulty = normalizeDifficulty(score.mode?.difficulty);
          const modeName = getDifficultyName(normalizedDifficulty);
          const modeClass = normalizedDifficulty === 'easy' ? 'mode-easy' :
                           normalizedDifficulty === 'hard' ? 'mode-hard' : '';
          const replayAvailable = Boolean(this.onReplay && scoreHistoryService.getScore(score.scoreId));
          return `
          <div class="score-entry">
            <div class="rank">#${index + 1}</div>
            <div class="score-info">
              <div class="score-value">${score.score}</div>
              <div class="score-meta">
                <span>${this.formatDate(score.timestamp)}</span>
                <span>${score.rollCount} rolls</span>
                <span>${this.formatDuration(score.duration)}</span>
                <span class="mode-badge ${modeClass}">${modeName}</span>
              </div>
            </div>
            <button
              class="btn btn-outline btn-sm btn-replay"
              data-score-id="${score.scoreId}"
              title="${replayAvailable ? "Replay this game" : "Replay available for local scores on this device"}"
              ${replayAvailable ? "" : "disabled"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 009 9 9 9 0 009-9 9 9 0 00-9-9"/>
                <path d="M3 12l3-3m-3 3l3 3"/>
              </svg>
            </button>
          </div>
        `;
        }).join("")}
      </div>
    `;
  }

  private async renderGlobalLeaderboard(): Promise<void> {
    const renderVersion = ++this.globalRenderVersion;
    this.contentContainer.innerHTML = `
      <div class="global-placeholder">
        <h3>Global Leaderboard</h3>
        <p>Loading scores...</p>
      </div>
    `;

    try {
      await firebaseAuthService.initialize();
      await leaderboardService.flushPendingScores();
      const entries = await leaderboardService.getGlobalLeaderboard(200);
      const accountProfile = await leaderboardService.getAccountProfile();
      if (this.activeTab !== "global" || renderVersion !== this.globalRenderVersion) {
        return;
      }
      this.renderGlobalContent(entries, accountProfile);
    } catch (error) {
      if (this.activeTab !== "global" || renderVersion !== this.globalRenderVersion) {
        return;
      }
      log.warn("Failed to render global leaderboard", error);
      this.contentContainer.innerHTML = `
        <div class="global-placeholder">
          <h3>Global Leaderboard</h3>
          <p>Unable to load leaderboard right now.</p>
        </div>
      `;
    }
  }

  private renderGlobalContent(
    entries: GlobalLeaderboardEntry[],
    accountProfile: AuthenticatedUserProfile | null
  ): void {
    const authConfigured = firebaseAuthService.isConfigured();
    const isAuthenticated = Boolean(accountProfile && !accountProfile.isAnonymous);
    const displayName =
      accountProfile?.displayName ||
      accountProfile?.email ||
      (isAuthenticated ? "Signed In" : "Not Signed In");
    const authBadge = isAuthenticated
      ? "Authenticated Account"
      : "Not Signed In";
    const showGoogleSignIn = authConfigured && !isAuthenticated;
    const leaderboardName = accountProfile?.leaderboardName?.trim() ?? "";
    const requiresNameSetup = isAuthenticated && leaderboardName.length === 0;

    this.contentContainer.innerHTML = `
      <div class="global-auth-panel">
        <div>
          <div class="global-auth-title">Identity</div>
          <div class="global-auth-user">${escapeHtml(displayName)}</div>
          <div class="global-auth-badge">${escapeHtml(authBadge)}</div>
        </div>
          <div class="global-auth-actions">
          ${
            showGoogleSignIn
              ? '<button class="btn btn-primary btn-global-auth" data-action="google-signin">Sign In with Google</button>'
              : ""
          }
          <button class="btn btn-secondary btn-global-refresh" data-action="refresh-global">Refresh</button>
        </div>
      </div>
      ${
        requiresNameSetup
          ? `<div class="global-name-setup">
              <h4>Set Leaderboard Name</h4>
              <p>Pick the public name shown on the global leaderboard.</p>
              <div class="global-name-row">
                <input id="leaderboard-name-input" type="text" maxlength="24" placeholder="Your player name" />
                <button class="btn btn-primary btn-global-auth" data-action="save-name">Save Name</button>
              </div>
            </div>`
          : ""
      }
      ${
        entries.length === 0
          ? '<p class="empty-message">No global scores yet. Finish a run to claim the first spot.</p>'
          : `<div class="score-list">
              ${entries
                .map((entry, index) => this.renderGlobalEntry(entry, index + 1, accountProfile))
                .join("")}
            </div>`
      }
    `;

    if (showGoogleSignIn) {
      this.contentContainer
        .querySelector('[data-action="google-signin"]')
        ?.addEventListener("click", () => {
          audioService.playSfx("click");
          void firebaseAuthService.signInWithGoogle().then((ok) => {
            if (ok) {
              leaderboardService.clearCachedProfile();
              void this.renderGlobalLeaderboard();
            }
          });
        });
    }

    if (requiresNameSetup) {
      const saveBtn = this.contentContainer.querySelector('[data-action="save-name"]');
      const nameInput = this.contentContainer.querySelector("#leaderboard-name-input");

      saveBtn?.addEventListener("click", () => {
        const input = nameInput as HTMLInputElement | null;
        const value = input?.value?.trim() ?? "";
        if (!value || this.savingLeaderboardName) {
          return;
        }

        this.savingLeaderboardName = true;
        audioService.playSfx("click");
        void leaderboardService
          .setLeaderboardName(value)
          .then((profile) => {
            if (!profile) {
              return;
            }
            void leaderboardService.flushPendingScores();
            void this.renderGlobalLeaderboard();
          })
          .finally(() => {
            this.savingLeaderboardName = false;
          });
      });
    }

    this.contentContainer
      .querySelector('[data-action="refresh-global"]')
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        void this.renderGlobalLeaderboard();
      });
  }

  private renderGlobalEntry(
    entry: GlobalLeaderboardEntry,
    rank: number,
    currentUser: AuthenticatedUserProfile | null
  ): string {
    const normalizedDifficulty = normalizeDifficulty(entry.mode?.difficulty);
    const modeName = getDifficultyName(normalizedDifficulty);
    const modeClass =
      normalizedDifficulty === "easy"
        ? "mode-easy"
        : normalizedDifficulty === "hard"
          ? "mode-hard"
          : "";
    const isCurrentUser = currentUser?.uid === entry.uid;
    const playerLabel = entry.displayName?.trim() || "Anonymous";

    return `
      <div class="score-entry ${isCurrentUser ? "is-current-player" : ""}">
        <div class="rank">#${rank}</div>
        <div class="score-info">
          <div class="score-value">${entry.score}</div>
          <div class="score-meta">
            <span>${escapeHtml(playerLabel)}</span>
            <span>${this.formatDate(entry.timestamp)}</span>
            <span>${entry.rollCount} rolls</span>
            <span>${this.formatDuration(entry.duration)}</span>
            <span class="mode-badge ${modeClass}">${modeName}</span>
          </div>
        </div>
      </div>
    `;
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "Today";
    } else if (diffDays === 1) {
      return "Yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Register callback for replay action
   */
  setOnReplay(callback: (score: GameScore) => void): void {
    this.onReplay = callback;
  }

  /**
   * Show leaderboard modal
   */
  show(): void {
    modalManager.requestOpen("leaderboard-modal");
    this.container.style.display = "flex";
    this.switchTab("personal"); // Always start on personal tab
    this.updateSyncIndicator();
  }

  /**
   * Hide leaderboard modal
   */
  hide(): void {
    if (this.container.style.display === "none") {
      return;
    }
    this.container.style.display = "none";
    modalManager.notifyClosed("leaderboard-modal");
  }

  /**
   * Check if leaderboard modal is visible
   */
  isVisible(): boolean {
    return this.container.style.display === "flex";
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    document.removeEventListener(
      "auth:firebaseUserChanged",
      this.onFirebaseAuthChanged as EventListener
    );
    document.removeEventListener(
      "sync:playerDataStatusChanged",
      this.onDataSyncStatusChanged as EventListener
    );
    document.removeEventListener(
      "sync:leaderboardStatusChanged",
      this.onLeaderboardSyncStatusChanged as EventListener
    );
    this.container.remove();
  }

  private updateSyncIndicator(): void {
    const indicator = this.container.querySelector("#leaderboard-sync-indicator");
    if (!indicator) {
      return;
    }

    const state = this.getSyncIndicatorState();
    indicator.classList.remove(
      "sync-indicator--ok",
      "sync-indicator--syncing",
      "sync-indicator--pending",
      "sync-indicator--offline",
      "sync-indicator--error"
    );
    indicator.classList.add(`sync-indicator--${state.tone}`);
    indicator.setAttribute("title", state.title);

    const label = indicator.querySelector(".sync-indicator-label");
    if (label) {
      label.textContent = state.label;
    }
  }

  private getSyncIndicatorState(): { label: string; tone: SyncIndicatorTone; title: string } {
    const dataSync: PlayerDataSyncStatus = playerDataSyncService.getSyncStatus();
    const leaderboardSync: LeaderboardSyncStatus = leaderboardService.getSyncStatus();
    const pendingCount =
      dataSync.pendingLogCount +
      dataSync.pendingScoreLogCount +
      leaderboardSync.pendingGlobalScores;

    if (!isNavigatorOnline()) {
      return {
        label: "Offline",
        tone: "offline",
        title: "Offline mode: local scores are queued and will sync later.",
      };
    }

    if (dataSync.state === "syncing" || leaderboardSync.state === "syncing") {
      return {
        label: "Syncing",
        tone: "syncing",
        title: "Sync in progress.",
      };
    }

    if (dataSync.state === "error" || leaderboardSync.state === "error") {
      return {
        label: "Retry",
        tone: "error",
        title: "A recent sync attempt failed. Automatic retry is active.",
      };
    }

    if (pendingCount > 0 || dataSync.profileDirty) {
      return {
        label: pendingCount > 0 ? `Pending ${pendingCount}` : "Pending",
        tone: "pending",
        title: "There are local score/profile updates waiting to sync.",
      };
    }

    const latestSuccessAt = Math.max(
      dataSync.lastSuccessAt,
      leaderboardSync.lastSuccessAt,
      leaderboardSync.lastFetchedAt
    );
    const suffix =
      latestSuccessAt > 0
        ? ` Last update ${formatRelativeSyncTime(latestSuccessAt)}.`
        : "";

    return {
      label: "Updated",
      tone: "ok",
      title: `Leaderboard data is synchronized.${suffix}`,
    };
  }
}

function normalizeDifficulty(raw: string | undefined): "easy" | "normal" | "hard" {
  if (raw === "easy" || raw === "hard") {
    return raw;
  }
  return "normal";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
}

function formatRelativeSyncTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return "just now";
  }
  if (deltaMs < 10_000) {
    return "just now";
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
    return true;
  }
  return navigator.onLine;
}
