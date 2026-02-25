/**
 * Player Manager - coordinates multiple players in the game
 * Manages player lifecycle, turn order, and visual updates
 */

import { Player, type PlayerProfile } from "./Player.js";
import { PlayerController } from "./PlayerController.js";
import type { GameScene } from "../render/scene.js";
import type { DiceRenderer } from "../render/dice.js";
import { Color3 } from "@babylonjs/core";

/**
 * Player Manager - manages all players in the game
 */
export class PlayerManager {
  private players: Map<string, Player> = new Map();
  private playerControllers: Map<string, PlayerController> = new Map();
  private scene: GameScene;
  private diceRenderer: DiceRenderer;
  private localPlayer?: Player;
  private currentTurnPlayerId?: string;

  constructor(scene: GameScene, diceRenderer: DiceRenderer) {
    this.scene = scene;
    this.diceRenderer = diceRenderer;
  }

  /**
   * Add a player to the game
   * @param profile - Player profile data
   * @param seatIndex - Seat index (0-7)
   * @param isLocal - Whether this is the local player
   * @returns The created Player instance
   */
  addPlayer(profile: PlayerProfile, seatIndex: number, isLocal: boolean): Player {
    // Check if seat is already occupied
    const existingPlayer = this.getPlayerBySeat(seatIndex);
    if (existingPlayer) {
      throw new Error(`Seat ${seatIndex} is already occupied by ${existingPlayer.profile.name}`);
    }

    // Create player
    const player = new Player(profile, seatIndex, isLocal);
    this.players.set(player.id, player);

    // Create player controller
    const controller = new PlayerController(player, this.scene, this.diceRenderer);
    this.playerControllers.set(player.id, controller);

    // Set as local player if applicable
    if (isLocal) {
      this.localPlayer = player;
    }

    // Update seat visualization
    this.updateSeatVisualization(player);

    return player;
  }

  /**
   * Remove a player from the game
   * @param playerId - Player ID to remove
   */
  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    // Dispose controller
    const controller = this.playerControllers.get(playerId);
    controller?.dispose();

    // Remove from maps
    this.players.delete(playerId);
    this.playerControllers.delete(playerId);

    // Clear seat visualization
    this.clearSeatVisualization(player.seatIndex);

    // If this was the local player, clear reference
    if (player === this.localPlayer) {
      this.localPlayer = undefined;
    }
  }

  /**
   * Get a player by ID
   */
  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  /**
   * Get the local player
   */
  getLocalPlayer(): Player | undefined {
    return this.localPlayer;
  }

  /**
   * Get player by seat index
   */
  getPlayerBySeat(seatIndex: number): Player | undefined {
    for (const player of this.players.values()) {
      if (player.seatIndex === seatIndex) {
        return player;
      }
    }
    return undefined;
  }

  /**
   * Get player controller by player ID
   */
  getPlayerController(playerId: string): PlayerController | undefined {
    return this.playerControllers.get(playerId);
  }

  /**
   * Get all players
   */
  getAllPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  /**
   * Get number of players
   */
  getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Check if a seat is occupied
   */
  isSeatOccupied(seatIndex: number): boolean {
    return this.getPlayerBySeat(seatIndex) !== undefined;
  }

  // ============================================
  // Turn Management (for turn-based multiplayer)
  // ============================================

  /**
   * Set the current turn to a specific player
   * @param playerId - Player ID whose turn it is
   */
  setCurrentTurn(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) {
      console.error(`Cannot set turn: player ${playerId} not found`);
      return;
    }

    this.currentTurnPlayerId = playerId;
    this.highlightCurrentPlayer();
  }

  /**
   * Get the player whose turn it currently is
   */
  getCurrentTurnPlayer(): Player | undefined {
    if (!this.currentTurnPlayerId) return undefined;
    return this.players.get(this.currentTurnPlayerId);
  }

  /**
   * Advance to the next player's turn (clockwise around table)
   */
  nextTurn(): void {
    if (this.players.size === 0) return;

    const playerArray = this.getAllPlayers().sort((a, b) => a.seatIndex - b.seatIndex);

    if (!this.currentTurnPlayerId) {
      // No current turn, start with first player
      this.setCurrentTurn(playerArray[0].id);
      return;
    }

    // Find current player index
    const currentIndex = playerArray.findIndex((p) => p.id === this.currentTurnPlayerId);
    if (currentIndex === -1) {
      // Current player not found, start with first
      this.setCurrentTurn(playerArray[0].id);
      return;
    }

    // Move to next player (wrap around)
    const nextIndex = (currentIndex + 1) % playerArray.length;
    this.setCurrentTurn(playerArray[nextIndex].id);
  }

  // ============================================
  // Visual Updates
  // ============================================

  /**
   * Update seat visualization for a player
   */
  private updateSeatVisualization(player: Player): void {
    // Update seat renderer to show player as occupied
    const avatarColor = this.getPlayerColor(player.seatIndex);

    this.scene.playerSeatRenderer?.updateSeat(player.seatIndex, {
      index: player.seatIndex,
      occupied: true,
      isCurrentPlayer: player.isLocal,
      playerName: player.profile.name,
      avatarColor: avatarColor,
    });
  }

  /**
   * Clear seat visualization
   */
  private clearSeatVisualization(seatIndex: number): void {
    this.scene.playerSeatRenderer?.updateSeat(seatIndex, {
      index: seatIndex,
      occupied: false,
      isCurrentPlayer: false,
      playerName: undefined,
    });
  }

  /**
   * Highlight the current turn player
   */
  highlightCurrentPlayer(): void {
    const currentPlayer = this.getCurrentTurnPlayer();
    if (!currentPlayer) return;

    this.scene.playerSeatRenderer?.highlightSeat(currentPlayer.seatIndex);
  }

  /**
   * Update all player displays
   */
  updateAllPlayerDisplays(): void {
    for (const player of this.players.values()) {
      this.updateSeatVisualization(player);
    }
  }

  /**
   * Get a color for a player based on seat index
   */
  private getPlayerColor(seatIndex: number): Color3 {
    const colors = [
      new Color3(0.2, 0.8, 0.3), // Green (local player)
      new Color3(0.8, 0.3, 0.3), // Red
      new Color3(0.3, 0.5, 0.9), // Blue
      new Color3(0.9, 0.7, 0.2), // Yellow
      new Color3(0.7, 0.3, 0.8), // Purple
      new Color3(0.3, 0.8, 0.8), // Cyan
      new Color3(0.9, 0.5, 0.3), // Orange
      new Color3(0.8, 0.3, 0.6), // Pink
    ];

    return colors[seatIndex % colors.length];
  }

  // ============================================
  // Multiplayer Network (future)
  // ============================================

  /**
   * Broadcast action to all players (future multiplayer)
   */
  broadcastAction(playerId: string, action: any): void {
    // Future: Send to WebSocket server
    console.log(`Broadcast action from player ${playerId}:`, action);
  }

  /**
   * Handle action received from network
   */
  handleNetworkAction(playerId: string, action: any): void {
    const controller = this.playerControllers.get(playerId);
    if (!controller) {
      console.error(`Cannot handle action: player ${playerId} not found`);
      return;
    }

    controller.receiveActionFromServer(action);
  }

  /**
   * Dispose all players and cleanup
   */
  dispose(): void {
    for (const controller of this.playerControllers.values()) {
      controller.dispose();
    }

    this.players.clear();
    this.playerControllers.clear();
    this.localPlayer = undefined;
    this.currentTurnPlayerId = undefined;
  }
}
