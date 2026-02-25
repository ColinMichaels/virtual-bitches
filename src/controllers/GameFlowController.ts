/**
 * Game Flow Controller
 * Handles game lifecycle: initialization, mode switching, new games
 */

import { createGame, replay, deserializeActions } from "../game/state.js";
import { settingsService } from "../services/settings.js";
import { shouldShowHints } from "../engine/modes.js";
import { notificationService } from "../ui/notifications.js";
import { generateSeed, parseGameURL } from "../utils/urlUtils.js";
import type { GameState, GameDifficulty, GameConfig } from "../engine/types.js";
import type { DiceRow } from "../ui/diceRow.js";
import type { DiceRenderer } from "../render/dice.js";

export class GameFlowController {
  /**
   * Initialize game state from URL or create new game
   */
  static initializeGameState(): GameState {
    const { seed, logEncoded } = parseGameURL();
    const gameSeed = seed || generateSeed();

    // Get settings for mode configuration
    const settings = settingsService.getSettings();
    const mode = {
      difficulty: settings.game.difficulty,
      variant: "classic" as const,
    };

    if (logEncoded) {
      // Replay mode
      const actions = deserializeActions(logEncoded);
      return replay(gameSeed, actions);
    } else {
      // New game
      return createGame(gameSeed, {}, mode);
    }
  }

  /**
   * Create a new game with current settings
   */
  static createNewGame(): GameState {
    const seed = generateSeed();
    const settings = settingsService.getSettings();

    const config: GameConfig = {
      addD20: settings.game.addD20,
      addD4: settings.game.addD4,
      add2ndD10: settings.game.add2ndD10,
      d100Mode: settings.game.d100Mode,
    };

    const mode = {
      difficulty: settings.game.difficulty,
      variant: "classic" as const,
    };

    return createGame(seed, config, mode);
  }

  /**
   * Handle mode change (difficulty switch)
   * Returns new game state if game should be reset, null otherwise
   */
  static handleModeChange(
    currentState: GameState,
    newDifficulty: GameDifficulty,
    isGameInProgress: boolean
  ): GameState | null {
    // Check if game is in progress
    if (isGameInProgress) {
      const confirmed = confirm(
        `Switch to ${newDifficulty.charAt(0).toUpperCase() + newDifficulty.slice(1)} mode? This will start a new game and your current progress will be lost.`
      );
      if (!confirmed) {
        return null;
      }
    }

    // Update settings
    settingsService.updateGame({ difficulty: newDifficulty });

    // Return new game state if one was in progress
    if (isGameInProgress) {
      return GameFlowController.createNewGame();
    }

    return null;
  }

  /**
   * Update UI components after hint mode change
   */
  static updateHintMode(state: GameState, diceRow: DiceRow): void {
    const hintsEnabled = shouldShowHints(state.mode);
    diceRow.setHintMode(hintsEnabled);
  }

  /**
   * Reset game for new round
   */
  static resetForNewGame(diceRenderer: DiceRenderer): void {
    // Clear all dice from renderer
    diceRenderer.clearDice();

    // Show notification
    notificationService.show("New Game Started!", "success");
  }

  /**
   * Check if game is currently in progress
   */
  static isGameInProgress(state: GameState): boolean {
    return state.status !== "COMPLETE" &&
           (state.rollIndex > 0 || state.score > 0);
  }

  /**
   * Initialize audio on first user interaction
   */
  static async initializeAudio(): Promise<void> {
    const { audioService } = await import("../services/audio.js");

    const initAudio = async () => {
      if (!audioService.isInitialized()) {
        await audioService.initialize();
        await audioService.playMusic();
      }
    };

    // Listen for any user interaction to initialize audio
    const events = ["click", "keydown", "touchstart"];
    const handler = async () => {
      await initAudio();
      events.forEach((event) => document.removeEventListener(event, handler));
    };

    events.forEach((event) =>
      document.addEventListener(event, handler, { once: true, passive: true })
    );
  }
}
