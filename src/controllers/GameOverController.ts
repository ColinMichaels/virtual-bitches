/**
 * Game Over Controller
 * Handles end-game flow: score display, seed sharing, leaderboard integration
 */

import { audioService } from "../services/audio.js";
import { hapticsService } from "../services/haptics.js";
import { scoreHistoryService } from "../services/score-history.js";
import { notificationService } from "../ui/notifications.js";
import { generateShareURL } from "../game/state.js";
import { logger } from "../utils/logger.js";
import type { GameState } from "../engine/types.js";
import type { GameScene } from "../render/scene.js";

const log = logger.create('GameOver');

export class GameOverController {
  private gameOverEl: HTMLElement;
  private finalScoreEl: HTMLElement;
  private shareLinkEl: HTMLElement;
  private scene: GameScene;

  constructor(scene: GameScene) {
    this.scene = scene;
    this.gameOverEl = document.getElementById("game-over")!;
    this.finalScoreEl = document.getElementById("final-score")!;
    this.shareLinkEl = document.getElementById("share-link")!;
  }

  /**
   * Show game over screen with final score and stats
   */
  showGameOver(state: GameState, gameStartTime: number): void {
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

    // Get rank
    const rank = scoreHistoryService.getRank(state.score);

    // Show game over notification
    notificationService.show(`🎮 Game Complete! Final Score: ${state.score}`, "success");

    // Update final score display
    this.finalScoreEl.textContent = state.score.toString();

    // Display player's rank
    this.displayRank(rank, state, scoreHistoryService.getStats());

    // Generate and setup share URL
    const shareURL = generateShareURL(state);
    if (this.shareLinkEl) {
      this.shareLinkEl.textContent = shareURL;
    }

    // Setup seed action buttons
    this.setupSeedActions(shareURL, state.score);

    // Show game over modal
    this.gameOverEl.classList.add("show");

    log.debug("Game Over - Score saved:", savedScore);
    log.debug("Your rank:", rank);
  }

  /**
   * Display player's rank and personal best status
   */
  private displayRank(rank: number | null, state: GameState, stats: ReturnType<typeof scoreHistoryService.getStats>): void {
    const rankEl = document.getElementById("rank-display")!;

    if (rank) {
      const totalGames = stats.totalGames;
      const rankEmoji = rank === 1 ? "🏆" : rank <= 3 ? "🥉" : "📊";
      rankEl.innerHTML = `<p style="font-size: 1.2em; opacity: 0.8; margin: 10px 0;">${rankEmoji} Rank #${rank} of ${totalGames} games</p>`;

      // Add special message for personal best
      if (state.score === stats.bestScore) {
        rankEl.innerHTML += `<p style="color: gold; font-weight: bold; margin: 5px 0;">🎉 NEW PERSONAL BEST!</p>`;
      }
    } else {
      rankEl.innerHTML = `<p style="opacity: 0.8; margin: 10px 0;">🎮 First game!</p>`;
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
          notificationService.show("Seed copied to clipboard!", "success");
        }).catch(() => {
          notificationService.show("Failed to copy seed", "error");
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
        a.download = `biscuits-seed-${score}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notificationService.show("Seed downloaded!", "success");
      };
    }
  }

  /**
   * Hide game over screen
   */
  hide(): void {
    this.gameOverEl.classList.remove("show");
  }
}
