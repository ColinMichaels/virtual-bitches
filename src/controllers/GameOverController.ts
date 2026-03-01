/**
 * Game Over Controller
 * Handles end-game flow: score display, seed sharing, leaderboard integration
 */

import { audioService } from "../services/audio.js";
import { hapticsService } from "../services/haptics.js";
import { scoreHistoryService } from "../services/score-history.js";
import { leaderboardService } from "../services/leaderboard.js";
import { notificationService } from "../ui/notifications.js";
import { generateShareURL } from "../game/state.js";
import { buildScoreSeedShareUrl } from "../social/share/facebookShareMeta.js";
import { gameBrand } from "../config/brand.js";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import type { GameState } from "../engine/types.js";
import type { GameScene } from "../render/scene.js";

const log = logger.create('GameOver');

interface GameOverViewOptions {
  showWaitForNextGame?: boolean;
  queuedForNextGame?: boolean;
  waitForNextGamePending?: boolean;
  nextGameStartsAtMs?: number | null;
}

export class GameOverController {
  private gameOverEl: HTMLElement;
  private finalScoreEl: HTMLElement;
  private shareLinkEl: HTMLElement;
  private newGameBtn: HTMLButtonElement | null;
  private waitNextGameBtn: HTMLButtonElement | null;
  private nextGameInfoEl: HTMLElement | null;
  private nextGameStatusEl: HTMLElement | null;
  private nextGameCountdownEl: HTMLElement | null;
  private nextGameCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private waitForNextGameVisible = false;
  private queuedForNextGame = false;
  private waitForNextGamePending = false;
  private nextGameStartsAtMs: number | null = null;
  private scene: GameScene;

  constructor(scene: GameScene) {
    this.scene = scene;
    this.gameOverEl = document.getElementById("game-over")!;
    this.finalScoreEl = document.getElementById("final-score")!;
    this.shareLinkEl = document.getElementById("share-link")!;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement | null;
    this.waitNextGameBtn = document.getElementById("wait-next-game-btn") as HTMLButtonElement | null;
    this.nextGameInfoEl = document.getElementById("next-game-info");
    this.nextGameStatusEl = document.getElementById("next-game-status");
    this.nextGameCountdownEl = document.getElementById("next-game-countdown");
    this.localizeStaticCopy();
  }

  /**
   * Show game over screen with final score and stats
   */
  showGameOver(state: GameState, gameStartTime: number, options: GameOverViewOptions = {}): void {
    // Play game over sound and haptic feedback
    audioService.playSfx("gameOver");
    hapticsService.gameComplete();

    // Celebrate game completion with particles
    this.scene.celebrateSuccess("complete");

    // Calculate game duration
    const gameDuration = Date.now() - gameStartTime;

    // Save score to history
    const savedScore = scoreHistoryService.saveScore(
      state.score,
      state.seed,
      state.actionLog,
      gameDuration,
      state.rollIndex,
      state.mode
    );
    void leaderboardService.flushPendingScores();

    // Get rank
    const rank = scoreHistoryService.getRank(state.score);

    // Show game over notification
    notificationService.show(
      t("gameOver.notification.complete", { score: state.score }),
      "success"
    );

    // Update final score display
    this.finalScoreEl.textContent = state.score.toString();

    // Display player's rank
    this.displayRank(rank, state, scoreHistoryService.getStats());

    // Generate and setup share URL
    const shareURL = buildScoreSeedShareUrl({
      baseUrl: generateShareURL(state),
      seed: state.seed,
      score: state.score,
      difficulty: state.mode.difficulty,
    });
    if (this.shareLinkEl) {
      this.shareLinkEl.textContent = shareURL;
    }

    // Setup seed action buttons
    this.setupSeedActions(shareURL, state.score);
    this.configureActionButtons(options);

    // Show game over modal
    this.gameOverEl.classList.add("show");
    this.renderNextGameInfo();
    this.syncNextGameCountdownTimer();

    log.debug("Game Over - Score saved:", savedScore);
    log.debug("Your rank:", rank);
  }

  /**
   * Display player's rank and personal best status
   */
  private displayRank(rank: number | null, state: GameState, stats: ReturnType<typeof scoreHistoryService.getStats>): void {
    const rankEl = document.getElementById("rank-display")!;

    // Difficulty badge with emoji
    const difficulty = state.mode.difficulty;
    const difficultyEmoji = difficulty === "easy" ? "🌱" : difficulty === "normal" ? "⚔️" : "🔥";
    const difficultyLabel = this.getDifficultyLabel(difficulty);
    const difficultyColor = difficulty === "easy" ? "#4CAF50" : difficulty === "normal" ? "#2196F3" : "#FF5722";

    if (rank) {
      const totalGames = stats.totalGames;
      const rankEmoji = rank === 1 ? "🏆" : rank <= 3 ? "🥉" : "📊";
      rankEl.innerHTML = `
        <p style="font-size: 0.9em; opacity: 0.7; margin: 5px 0;">
          <span style="background: ${difficultyColor}; padding: 2px 8px; border-radius: 4px; font-weight: bold;">
            ${difficultyEmoji} ${difficultyLabel}
          </span>
        </p>
        <p style="font-size: 1.2em; opacity: 0.8; margin: 10px 0;">${t("gameOver.rank.label", { emoji: rankEmoji, rank, totalGames })}</p>
      `;

      // Add special message for personal best
      if (state.score === stats.bestScore) {
        rankEl.innerHTML += `<p style="color: gold; font-weight: bold; margin: 5px 0;">${t("gameOver.rank.personalBest")}</p>`;
      }
    } else {
      rankEl.innerHTML = `
        <p style="font-size: 0.9em; opacity: 0.7; margin: 5px 0;">
          <span style="background: ${difficultyColor}; padding: 2px 8px; border-radius: 4px; font-weight: bold;">
            ${difficultyEmoji} ${difficultyLabel}
          </span>
        </p>
        <p style="opacity: 0.8; margin: 10px 0;">${t("gameOver.rank.firstGame")}</p>
      `;
    }
  }

  /**
   * Setup seed action buttons (copy, download)
   */
  private setupSeedActions(shareURL: string, score: number): void {
    const copyBtn = document.getElementById("copy-seed-btn");
    const downloadBtn = document.getElementById("download-seed-btn");

    if (copyBtn) {
      copyBtn.onclick = () => {
        audioService.playSfx("click");
        navigator.clipboard.writeText(shareURL).then(() => {
          notificationService.show(t("gameOver.seed.copySuccess"), "success");
        }).catch(() => {
          notificationService.show(t("gameOver.seed.copyFailed"), "error");
        });
      };
    }

    if (downloadBtn) {
      downloadBtn.onclick = () => {
        audioService.playSfx("click");
        const blob = new Blob([shareURL], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${this.getProductSlug()}-seed-${score}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notificationService.show(t("gameOver.seed.downloadSuccess"), "success");
      };
    }
  }

  /**
   * Hide game over screen
   */
  hide(): void {
    this.gameOverEl.classList.remove("show");
    this.configureActionButtons({
      showWaitForNextGame: false,
      queuedForNextGame: false,
      waitForNextGamePending: false,
      nextGameStartsAtMs: null,
    });
  }

  updateWaitForNextGame(options: GameOverViewOptions): void {
    this.configureActionButtons(options);
  }

  private configureActionButtons(options: GameOverViewOptions): void {
    const showWaitForNextGame = options.showWaitForNextGame === true;
    const queuedForNextGame = options.queuedForNextGame === true;
    const waitForNextGamePending = options.waitForNextGamePending === true;
    const nextGameStartsAtMs =
      typeof options.nextGameStartsAtMs === "number" && Number.isFinite(options.nextGameStartsAtMs)
        ? Math.floor(options.nextGameStartsAtMs)
        : null;

    this.waitForNextGameVisible = showWaitForNextGame;
    this.queuedForNextGame = queuedForNextGame;
    this.waitForNextGamePending = waitForNextGamePending;
    this.nextGameStartsAtMs = nextGameStartsAtMs;

    if (this.waitNextGameBtn) {
      this.waitNextGameBtn.style.display = showWaitForNextGame ? "inline-flex" : "none";
      this.waitNextGameBtn.disabled = !showWaitForNextGame || waitForNextGamePending || queuedForNextGame;
      if (showWaitForNextGame) {
        if (waitForNextGamePending) {
          this.waitNextGameBtn.textContent = t("gameOver.button.waitNextGameQueueing");
        } else if (queuedForNextGame) {
          this.waitNextGameBtn.textContent = t("gameOver.button.waitNextGameQueued");
        } else {
          this.waitNextGameBtn.textContent = t("gameOver.button.waitNextGame");
        }
      }
    }
    if (this.newGameBtn) {
      this.newGameBtn.style.display = showWaitForNextGame ? "none" : "inline-flex";
      this.newGameBtn.disabled = false;
    }
    if (this.nextGameInfoEl) {
      this.nextGameInfoEl.style.display = showWaitForNextGame ? "block" : "none";
    }
    this.renderNextGameInfo();
    this.syncNextGameCountdownTimer();
  }

  private syncNextGameCountdownTimer(): void {
    const shouldRun = this.waitForNextGameVisible && this.gameOverEl.classList.contains("show");
    if (shouldRun && this.nextGameCountdownTimer === null) {
      this.nextGameCountdownTimer = setInterval(() => {
        this.renderNextGameInfo();
      }, 250);
      return;
    }
    if (!shouldRun && this.nextGameCountdownTimer !== null) {
      clearInterval(this.nextGameCountdownTimer);
      this.nextGameCountdownTimer = null;
    }
  }

  private renderNextGameInfo(): void {
    if (!this.waitForNextGameVisible) {
      return;
    }
    if (this.nextGameStatusEl) {
      if (this.waitForNextGamePending) {
        this.nextGameStatusEl.textContent = t("gameOver.nextGame.statusQueueing");
      } else if (this.queuedForNextGame) {
        this.nextGameStatusEl.textContent = t("gameOver.nextGame.statusQueued");
      } else {
        this.nextGameStatusEl.textContent = t("gameOver.nextGame.statusPrompt");
      }
    }
    if (this.nextGameCountdownEl) {
      this.nextGameCountdownEl.textContent = this.buildNextGameCountdownMessage();
    }
  }

  private buildNextGameCountdownMessage(): string {
    if (typeof this.nextGameStartsAtMs !== "number" || this.nextGameStartsAtMs <= 0) {
      return t("gameOver.nextGame.countdownPending");
    }

    const secondsRemaining = Math.max(0, Math.ceil((this.nextGameStartsAtMs - Date.now()) / 1000));
    if (secondsRemaining <= 0) {
      return t("gameOver.nextGame.countdownStarting");
    }

    return t("gameOver.nextGame.countdown", { seconds: secondsRemaining });
  }

  private localizeStaticCopy(): void {
    const heading = this.gameOverEl.querySelector("h1");
    if (heading) {
      heading.textContent = t("gameOver.title");
    }

    const lowerIsBetter = this.gameOverEl.querySelector<HTMLParagraphElement>("#game-over-lower-better");
    if (lowerIsBetter) {
      lowerIsBetter.textContent = t("gameOver.lowerIsBetter");
    }

    const seedInfo = this.gameOverEl.querySelector<HTMLParagraphElement>("#seed-info-text");
    if (seedInfo) {
      seedInfo.textContent = t("gameOver.seedInfo");
    }

    const copySeedLabel = document.getElementById("copy-seed-label");
    if (copySeedLabel) {
      copySeedLabel.textContent = t("gameOver.button.copySeed");
    }

    const downloadSeedLabel = document.getElementById("download-seed-label");
    if (downloadSeedLabel) {
      downloadSeedLabel.textContent = t("gameOver.button.downloadSeed");
    }

    const mainMenuButton = document.getElementById("return-main-menu-btn");
    if (mainMenuButton) {
      mainMenuButton.textContent = t("gameOver.button.mainMenu");
    }

    const leaderboardButton = document.getElementById("view-leaderboard-btn");
    if (leaderboardButton) {
      leaderboardButton.textContent = t("gameOver.button.viewLeaderboard");
    }

    if (this.newGameBtn) {
      this.newGameBtn.textContent = t("gameOver.button.newGame");
    }
    if (this.waitNextGameBtn) {
      this.waitNextGameBtn.textContent = t("gameOver.button.waitNextGame");
    }
    if (this.nextGameStatusEl) {
      this.nextGameStatusEl.textContent = t("gameOver.nextGame.statusPrompt");
    }
    if (this.nextGameCountdownEl) {
      this.nextGameCountdownEl.textContent = t("gameOver.nextGame.countdownPending");
    }
  }

  private getDifficultyLabel(difficulty: GameState["mode"]["difficulty"]): string {
    switch (difficulty) {
      case "easy":
        return t("difficulty.easy");
      case "hard":
        return t("difficulty.hard");
      case "normal":
      default:
        return t("difficulty.normal");
    }
  }

  private getProductSlug(): string {
    const slug = gameBrand.productName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "game";
  }
}
