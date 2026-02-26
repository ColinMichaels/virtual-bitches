/**
 * Player Controller - manages individual player's game state and interactions
 * Handles game flow, dice rendering, and visual updates for a single player
 */

import type { Player } from "./Player.js";
import type { GameState, Action, DieState } from "../engine/types.js";
import type { GameScene } from "../render/scene.js";
import type { DiceRenderer } from "../render/dice.js";
import { reduce } from "../game/state.js";
import { logger } from "../utils/logger.js";

const log = logger.create("PlayerController");

/**
 * Player HUD data displayed when clicking on a player
 */
export interface PlayerHUDData {
  playerName: string;
  currentScore: number;
  rollsRemaining: number;
  highScore: number;
  gamesPlayed: number;
  avatarUrl?: string;
}

/**
 * Player Controller - manages a single player's game state
 */
export class PlayerController {
  private player: Player;
  private diceRenderer: DiceRenderer;
  private scene: GameScene;
  private hudVisible: boolean = false;

  constructor(player: Player, scene: GameScene, diceRenderer: DiceRenderer) {
    this.player = player;
    this.scene = scene;
    this.diceRenderer = diceRenderer;
  }

  /**
   * Get the player this controller manages
   */
  getPlayer(): Player {
    return this.player;
  }

  /**
   * Start a new game for this player
   * @param initialState - Initial game state
   */
  startGame(initialState: GameState): void {
    this.player.gameState = initialState;
  }

  /**
   * Handle a game action for this player
   * @param action - Action to apply
   */
  handleAction(action: Action): void {
    if (!this.player.gameState) {
      log.error("Cannot handle action: player has no game state");
      return;
    }

    // Apply action to player's game state
    this.player.gameState = reduce(this.player.gameState, action);
  }

  /**
   * Update the player's game state
   * @param newState - New game state
   */
  updateGameState(newState: GameState): void {
    this.player.gameState = newState;
    this.updateScoreDisplay();
  }

  /**
   * Get current game state
   */
  getGameState(): GameState | undefined {
    return this.player.gameState;
  }

  /**
   * Update score display (future: update player HUD)
   */
  updateScoreDisplay(): void {
    // Future: Update player-specific score display in 3D space
    // For now, this is handled by the main game HUD
  }

  /**
   * Animate scored dice to this player's score area
   * @param dice - Dice to animate
   */
  animateScoreDice(dice: DieState[], selected: Set<string>, onComplete: () => void): void {
    // Get player-specific score position
    const scorePosition = this.player.getScoreAreaPosition(this.scene.tableRadius);

    // Future: Pass scorePosition to diceRenderer.animateScore()
    // For now, animateScore uses default position
    this.diceRenderer.animateScore(dice, selected, onComplete);
  }

  /**
   * Show player HUD overlay (for clicking on other players)
   * Displays player stats, current score, avatar
   */
  showPlayerHUD(): void {
    if (this.hudVisible) return;

    const hudData = this.getPlayerHUDData();

    // Future: Create 3D HUD overlay above player seat
    // For now, this is a placeholder
    log.debug("Show Player HUD", hudData);

    this.hudVisible = true;
  }

  /**
   * Hide player HUD overlay
   */
  hidePlayerHUD(): void {
    if (!this.hudVisible) return;

    // Future: Remove 3D HUD overlay
    this.hudVisible = false;
  }

  /**
   * Get player HUD data for display
   */
  getPlayerHUDData(): PlayerHUDData {
    return {
      playerName: this.player.profile.name,
      currentScore: this.player.gameState?.score ?? 0,
      rollsRemaining: this.player.gameState
        ? 3 - this.player.gameState.rollIndex
        : 3,
      highScore: this.player.profile.stats.highScore,
      gamesPlayed: this.player.profile.stats.gamesPlayed,
      avatarUrl: this.player.profile.avatarUrl,
    };
  }

  /**
   * Check if this player is the local player
   */
  isLocalPlayer(): boolean {
    return this.player.isLocal;
  }

  /**
   * Get player's seat index
   */
  getSeatIndex(): number {
    return this.player.seatIndex;
  }

  /**
   * Finish game and update player stats
   * @param won - Whether the player won
   */
  finishGame(won: boolean): void {
    if (!this.player.gameState) return;

    const finalScore = this.player.gameState.score;
    this.player.updateStats(finalScore, won);
  }

  // ============================================
  // Network methods (future multiplayer)
  // ============================================

  /**
   * Send action to server (multiplayer)
   * @param action - Action to send
   */
  async sendActionToServer(action: Action): Promise<void> {
    // Future: WebSocket implementation
    // await websocket.send({ type: 'action', playerId: this.player.id, action });
    log.debug("Send action to server", action);
  }

  /**
   * Receive action from server (multiplayer)
   * @param action - Action received from server
   */
  receiveActionFromServer(action: Action): void {
    // Future: Apply action from remote player
    // this.handleAction(action);
    log.debug("Receive action from server", action);
  }

  /**
   * Dispose controller and cleanup resources
   */
  dispose(): void {
    this.hidePlayerHUD();
  }
}
