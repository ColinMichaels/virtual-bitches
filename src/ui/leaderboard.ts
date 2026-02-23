/**
 * Leaderboard Modal
 * Displays personal score history and statistics
 */

import { scoreHistoryService, GameScore, ScoreStats } from "../services/score-history.js";
import { audioService } from "../services/audio.js";

export class LeaderboardModal {
  private container: HTMLElement;
  private contentContainer: HTMLElement;
  private onReplay: ((score: GameScore) => void) | null = null;

  constructor() {
    this.container = this.createModal();
    this.contentContainer = this.container.querySelector(".leaderboard-content")!;
    document.body.appendChild(this.container);
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
      this.renderGlobalLeaderboard();
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
        ${scores.map((score, index) => `
          <div class="score-entry">
            <div class="rank">#${index + 1}</div>
            <div class="score-info">
              <div class="score-value">${score.score}</div>
              <div class="score-meta">
                <span>${this.formatDate(score.timestamp)}</span>
                <span>${score.rollCount} rolls</span>
                <span>${this.formatDuration(score.duration)}</span>
              </div>
            </div>
            <button class="btn-replay" data-score-id="${score.id}" title="Replay this game">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 009 9 9 9 0 009-9 9 9 0 00-9-9"/>
                <path d="M3 12l3-3m-3 3l3 3"/>
              </svg>
            </button>
          </div>
        `).join("")}
      </div>
    `;
  }

  private renderGlobalLeaderboard() {
    this.contentContainer.innerHTML = `
      <div class="global-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="64" height="64">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 2v20M2 12h20"/>
        </svg>
        <h3>Global Leaderboard</h3>
        <p>Coming Soon!</p>
        <p class="subtitle">Global leaderboards will be available once backend integration is complete.</p>
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
   * Dispose resources
   */
  dispose(): void {
    this.container.remove();
  }
}
