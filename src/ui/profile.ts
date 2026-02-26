import { audioService } from "../services/audio.js";
import { firebaseAuthService } from "../services/firebaseAuth.js";
import { leaderboardService } from "../services/leaderboard.js";
import { scoreHistoryService } from "../services/score-history.js";
import { getDifficultyName } from "../engine/modes.js";
import type { AuthenticatedUserProfile } from "../services/backendApi.js";
import { logger } from "../utils/logger.js";
import { modalManager } from "./modalManager.js";

const log = logger.create("ProfileModal");

export class ProfileModal {
  private container: HTMLElement;
  private contentContainer: HTMLElement;
  private renderVersion = 0;
  private savingLeaderboardName = false;
  private readonly onFirebaseAuthChanged = () => {
    leaderboardService.clearCachedProfile();
    if (this.isVisible()) {
      void this.render();
    }
  };

  constructor() {
    this.container = this.createModal();
    this.contentContainer = this.container.querySelector(".profile-content") as HTMLElement;
    document.body.appendChild(this.container);
    modalManager.register({
      id: "profile-modal",
      close: () => this.hide(),
    });
    document.addEventListener("auth:firebaseUserChanged", this.onFirebaseAuthChanged as EventListener);
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "profile-modal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content profile-modal-content">
        <div class="modal-header">
          <h2>Player Profile</h2>
          <button class="modal-close" title="Close (ESC)">&times;</button>
        </div>
        <div class="profile-content">
          <div class="profile-loading">Loading profile...</div>
        </div>
      </div>
    `;

    modal.querySelector(".modal-close")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
    });

    modal.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      this.hide();
    });

    return modal;
  }

  async render(): Promise<void> {
    const renderVersion = ++this.renderVersion;
    this.contentContainer.innerHTML = `<div class="profile-loading">Loading profile...</div>`;

    try {
      await firebaseAuthService.initialize();
      const firebaseUser = firebaseAuthService.getCurrentUserProfile();
      const authConfigured = firebaseAuthService.isConfigured();
      const isAuthenticated = Boolean(firebaseUser && !firebaseUser.isAnonymous);

      let accountProfile: AuthenticatedUserProfile | null = null;
      if (isAuthenticated) {
        accountProfile = await leaderboardService.getAccountProfile(true);
      }

      if (renderVersion !== this.renderVersion || !this.isVisible()) {
        return;
      }

      const stats = scoreHistoryService.getStats();
      const topScores = scoreHistoryService.getTopScores(5);
      const displayName =
        accountProfile?.displayName?.trim() ||
        firebaseUser?.displayName?.trim() ||
        accountProfile?.leaderboardName?.trim() ||
        "Guest Player";
      const email = accountProfile?.email?.trim() || firebaseUser?.email?.trim() || "";
      const provider = accountProfile?.provider?.trim() || (isAuthenticated ? "google" : "guest");
      const providerId = accountProfile?.providerId?.trim() || firebaseUser?.providerId?.trim() || "";
      const providerLabel = providerId ? `${provider} (${providerId})` : provider;
      const photoUrl = accountProfile?.photoUrl?.trim() || firebaseUser?.photoURL?.trim() || "";
      const leaderboardName = accountProfile?.leaderboardName?.trim() ?? "";
      const showSignIn = authConfigured && !isAuthenticated;

      this.contentContainer.innerHTML = `
        <section class="profile-identity-card">
          <div class="profile-avatar">${
            photoUrl
              ? `<img class="profile-avatar-image" src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(displayName)} profile photo" referrerpolicy="no-referrer" />`
              : this.getAvatarInitial(displayName)
          }</div>
          <div class="profile-identity">
            <div class="profile-name">${escapeHtml(displayName)}</div>
            <div class="profile-subtitle">${escapeHtml(isAuthenticated ? "Authenticated account" : "Guest account")}</div>
            ${email ? `<div class="profile-email">${escapeHtml(email)}</div>` : ""}
            <div class="profile-provider">Provider: ${escapeHtml(providerLabel)}</div>
          </div>
          <div class="profile-identity-actions">
            ${
              showSignIn
                ? '<button class="btn btn-primary btn-profile-action" data-action="google-signin">Sign In with Google</button>'
                : ""
            }
            ${
              isAuthenticated
                ? '<button class="btn btn-danger btn-profile-action" data-action="signout">Sign Out</button>'
                : ""
            }
            <button class="btn btn-secondary btn-profile-action" data-action="refresh-profile">Refresh</button>
          </div>
        </section>

        ${
          isAuthenticated
            ? `<section class="profile-name-setup">
                <h3>Leaderboard Identity</h3>
                <p>Public name shown on the global leaderboard.</p>
                <div class="profile-name-row">
                  <input
                    id="profile-leaderboard-name"
                    type="text"
                    maxlength="24"
                    placeholder="Your leaderboard name"
                    value="${escapeAttribute(leaderboardName)}"
                  />
                  <button class="btn btn-primary btn-profile-action" data-action="save-name">Save Name</button>
                </div>
              </section>`
            : `<section class="profile-name-setup">
                <h3>Leaderboard Identity</h3>
                <p>Sign in with Google to set a leaderboard name and submit global scores.</p>
              </section>`
        }

        <section class="profile-stats">
          <h3>Local Player Stats</h3>
          <div class="profile-stats-grid">
            <div class="profile-stat-card">
              <div class="profile-stat-label">Games Played</div>
              <div class="profile-stat-value">${stats.totalGames}</div>
            </div>
            <div class="profile-stat-card">
              <div class="profile-stat-label">Best Score</div>
              <div class="profile-stat-value">${stats.totalGames > 0 ? stats.bestScore : "-"}</div>
            </div>
            <div class="profile-stat-card">
              <div class="profile-stat-label">Average Score</div>
              <div class="profile-stat-value">${stats.totalGames > 0 ? stats.averageScore : "-"}</div>
            </div>
            <div class="profile-stat-card">
              <div class="profile-stat-label">Total Play Time</div>
              <div class="profile-stat-value">${this.formatDuration(stats.totalPlayTime)}</div>
            </div>
          </div>
        </section>

        <section class="profile-top-scores">
          <h3>Top Local Scores</h3>
          ${
            topScores.length === 0
              ? '<p class="profile-empty">No completed runs yet. Finish a game to populate your stats.</p>'
              : `<div class="profile-score-list">
                  ${topScores
                    .map((score, index) => {
                      const normalizedDifficulty =
                        score.mode?.difficulty === "easy" || score.mode?.difficulty === "hard"
                          ? score.mode.difficulty
                          : "normal";
                      return `
                        <div class="profile-score-row">
                          <span class="profile-score-rank">#${index + 1}</span>
                          <span class="profile-score-value">${score.score}</span>
                          <span class="profile-score-meta">${escapeHtml(
                            getDifficultyName(normalizedDifficulty)
                          )}</span>
                          <span class="profile-score-meta">${score.rollCount} rolls</span>
                          <span class="profile-score-meta">${this.formatDuration(score.duration)}</span>
                        </div>
                      `;
                    })
                    .join("")}
                </div>`
          }
        </section>
      `;

      this.bindActions();
    } catch (error) {
      if (renderVersion !== this.renderVersion || !this.isVisible()) {
        return;
      }
      log.warn("Failed to render profile", error);
      this.contentContainer.innerHTML = `
        <div class="profile-error">
          <p>Unable to load profile right now.</p>
        </div>
      `;
    }
  }

  private bindActions(): void {
    this.contentContainer
      .querySelector('[data-action="refresh-profile"]')
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        void this.render();
      });

    this.contentContainer
      .querySelector('[data-action="google-signin"]')
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        void firebaseAuthService.signInWithGoogle().then((ok) => {
          if (ok) {
            leaderboardService.clearCachedProfile();
            void this.render();
          }
        });
      });

    this.contentContainer
      .querySelector('[data-action="signout"]')
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        void firebaseAuthService.signOutCurrentUser().then(() => {
          leaderboardService.clearCachedProfile();
          void this.render();
        });
      });

    this.contentContainer
      .querySelector('[data-action="save-name"]')
      ?.addEventListener("click", () => {
        const input = this.contentContainer.querySelector(
          "#profile-leaderboard-name"
        ) as HTMLInputElement | null;
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
          })
          .finally(() => {
            this.savingLeaderboardName = false;
            void this.render();
          });
      });
  }

  show(): void {
    modalManager.requestOpen("profile-modal");
    this.container.style.display = "flex";
    void this.render();
  }

  hide(): void {
    if (this.container.style.display === "none") {
      return;
    }
    this.container.style.display = "none";
    modalManager.notifyClosed("profile-modal");
  }

  isVisible(): boolean {
    return this.container.style.display === "flex";
  }

  dispose(): void {
    document.removeEventListener("auth:firebaseUserChanged", this.onFirebaseAuthChanged as EventListener);
    modalManager.notifyClosed("profile-modal");
    this.container.remove();
  }

  private getAvatarInitial(label: string): string {
    const normalized = label.trim();
    if (!normalized) return "P";
    return normalized.charAt(0).toUpperCase();
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
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
