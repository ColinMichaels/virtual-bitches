/**
 * Leaderboard Modal
 * Displays personal score history and statistics
 */

import { scoreHistoryService, GameScore } from "../services/score-history.js";
import { audioService } from "../services/audio.js";
import { getDifficultyName } from "../engine/modes.js";
import { leaderboardService } from "../services/leaderboard.js";
import { firebaseAuthService, type FirebaseUserProfile } from "../services/firebaseAuth.js";
import type { GlobalLeaderboardEntry } from "../services/backendApi.js";
import { logger } from "../utils/logger.js";

const log = logger.create("LeaderboardModal");

export class LeaderboardModal {
  private container: HTMLElement;
  private contentContainer: HTMLElement;
  private onReplay: ((score: GameScore) => void) | null = null;
  private activeTab: "personal" | "global" = "personal";
  private globalRenderVersion = 0;
  private readonly onFirebaseAuthChanged = () => {
    if (this.activeTab === "global" && this.isVisible()) {
      void this.renderGlobalLeaderboard();
    }
  };

  constructor() {
    this.container = this.createModal();
    this.contentContainer = this.container.querySelector(".leaderboard-content")!;
    document.body.appendChild(this.container);
    document.addEventListener("auth:firebaseUserChanged", this.onFirebaseAuthChanged as EventListener);
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "leaderboard-modal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content leaderboard-modal-content">
        <div class="modal-header">
          <h2>Leaderboard</h2>
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
      this.renderPersonalScores();
    } else {
      void this.renderGlobalLeaderboard();
    }
  }

  private renderPersonalScores() {
    const stats = scoreHistoryService.getStats();
    const topScores = scoreHistoryService.getTopScores(10);

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
          <h3>Top 10 Scores</h3>
          <button class="btn-clear-history">Clear History</button>
        </div>
        ${topScores.length > 0 ? this.renderScoreList(topScores) : '<p class="empty-message">No scores yet. Play a game to get started!</p>'}
      </div>
    `;

    // Wire up clear history button
    const clearBtn = this.contentContainer.querySelector(".btn-clear-history");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        this.handleClearHistory();
      });
    }

    // Wire up replay buttons
    this.contentContainer.querySelectorAll(".btn-replay").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        audioService.playSfx("click");
        const scoreId = (e.target as HTMLElement).getAttribute("data-score-id")!;
        const score = scoreHistoryService.getScore(scoreId);
        if (score && this.onReplay) {
          this.hide();
          this.onReplay(score);
        }
      });
    });
  }

  private renderScoreList(scores: GameScore[]): string {
    return `
      <div class="score-list">
        ${scores.map((score, index) => {
          const modeName = score.mode ? getDifficultyName(score.mode.difficulty) : 'Normal';
          const modeClass = score.mode?.difficulty === 'easy' ? 'mode-easy' :
                           score.mode?.difficulty === 'hard' ? 'mode-hard' : '';
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
            <button class="btn-replay" data-score-id="${score.id}" title="Replay this game">
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
      const entries = await leaderboardService.getGlobalLeaderboard(25);
      if (this.activeTab !== "global" || renderVersion !== this.globalRenderVersion) {
        return;
      }
      this.renderGlobalContent(entries, firebaseAuthService.getCurrentUserProfile());
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

  private renderGlobalContent(entries: GlobalLeaderboardEntry[], user: FirebaseUserProfile | null): void {
    const authConfigured = firebaseAuthService.isConfigured();
    const displayName = user?.displayName || user?.email || (user?.isAnonymous ? "Guest Player" : "Not Signed In");
    const authBadge = user
      ? (user.isAnonymous ? "Guest Session" : "Google Account")
      : "Offline";

    this.contentContainer.innerHTML = `
      <div class="global-auth-panel">
        <div>
          <div class="global-auth-title">Identity</div>
          <div class="global-auth-user">${escapeHtml(displayName)}</div>
          <div class="global-auth-badge">${escapeHtml(authBadge)}</div>
        </div>
        <div class="global-auth-actions">
          ${
            authConfigured && user?.isAnonymous
              ? '<button class="btn-global-auth" data-action="google-signin">Sign In with Google</button>'
              : ""
          }
          <button class="btn-global-refresh" data-action="refresh-global">Refresh</button>
        </div>
      </div>
      ${
        entries.length === 0
          ? '<p class="empty-message">No global scores yet. Finish a run to claim the first spot.</p>'
          : `<div class="score-list">
              ${entries
                .map((entry, index) => this.renderGlobalEntry(entry, index + 1, user))
                .join("")}
            </div>`
      }
    `;

    if (authConfigured && user?.isAnonymous) {
      this.contentContainer
        .querySelector('[data-action="google-signin"]')
        ?.addEventListener("click", () => {
          audioService.playSfx("click");
          void firebaseAuthService.signInWithGoogle().then((ok) => {
            if (ok) {
              void this.renderGlobalLeaderboard();
            }
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
    currentUser: FirebaseUserProfile | null
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

  private handleClearHistory() {
    const confirmed = confirm("Are you sure you want to clear your entire score history? This cannot be undone.");
    if (confirmed) {
      scoreHistoryService.clearHistory();
      this.renderPersonalScores();
    }
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
    this.container.style.display = "flex";
    this.switchTab("personal"); // Always start on personal tab
  }

  /**
   * Hide leaderboard modal
   */
  hide(): void {
    this.container.style.display = "none";
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
    this.container.remove();
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
