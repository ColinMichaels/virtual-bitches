/**
 * Player data model for multiplayer support
 * Represents a single player in the game (local or remote)
 */

import { Vector3 } from "@babylonjs/core";
import type { GameState } from "../engine/types.js";

/**
 * Player statistics
 */
export interface PlayerStats {
  gamesPlayed: number;
  totalScore: number;
  highScore: number;
  wins: number;
  averageScore: number;
}

/**
 * Player profile information
 */
export interface PlayerProfile {
  id: string;
  name: string;
  avatarUrl?: string;
  rank: number;
  stats: PlayerStats;
}

/**
 * Serialized player data for network transmission
 */
export interface SerializedPlayer {
  profile: PlayerProfile;
  seatIndex: number;
  isLocal: boolean;
  gameState?: GameState;
}

/**
 * Player class - represents a player in the game
 * Handles player data, stats, and position
 */
export class Player {
  public readonly id: string;
  public profile: PlayerProfile;
  public seatIndex: number; // 0-7 for octagon seats
  public isLocal: boolean; // Local vs remote player
  public gameState?: GameState; // Player's current game state
  public isActive: boolean = true; // Whether player is still in game

  constructor(profile: PlayerProfile, seatIndex: number, isLocal: boolean) {
    this.id = profile.id;
    this.profile = profile;
    this.seatIndex = seatIndex;
    this.isLocal = isLocal;
  }

  /**
   * Update player statistics after a game
   * @param score - Final score for the game
   * @param won - Whether the player won
   */
  updateStats(score: number, won: boolean): void {
    this.profile.stats.gamesPlayed++;
    this.profile.stats.totalScore += score;

    if (score > this.profile.stats.highScore) {
      this.profile.stats.highScore = score;
    }

    if (won) {
      this.profile.stats.wins++;
    }

    // Recalculate average
    this.profile.stats.averageScore =
      this.profile.stats.totalScore / this.profile.stats.gamesPlayed;
  }

  /**
   * Get the position where this player's scored dice should appear
   * Calculated based on seat position around octagon
   * @param tableRadius - Radius of the octagon table
   * @returns Vector3 position for score area
   */
  getScoreAreaPosition(tableRadius: number = 22): Vector3 {
    // Calculate position based on seat angle
    const angleStep = (Math.PI * 2) / 8; // 45 degrees per seat
    const angle = angleStep * this.seatIndex;

    // Score area is between player and center
    const scoreAreaDistance = tableRadius * 0.4; // 40% of radius from center

    const x = scoreAreaDistance * Math.cos(angle);
    const z = scoreAreaDistance * Math.sin(angle);
    const y = 0.6; // Standard height for scored dice

    return new Vector3(x, y, z);
  }

  /**
   * Get player's seat direction (forward vector toward table center)
   */
  getForwardDirection(): Vector3 {
    const angleStep = (Math.PI * 2) / 8;
    const angle = angleStep * this.seatIndex;

    // Forward points toward center (negative of seat position direction)
    return new Vector3(-Math.cos(angle), 0, -Math.sin(angle)).normalize();
  }

  /**
   * Serialize player data for network transmission or storage
   */
  toJSON(): SerializedPlayer {
    return {
      profile: this.profile,
      seatIndex: this.seatIndex,
      isLocal: this.isLocal,
      gameState: this.gameState,
    };
  }

  /**
   * Deserialize player data from JSON
   */
  static fromJSON(data: SerializedPlayer): Player {
    const player = new Player(data.profile, data.seatIndex, data.isLocal);
    player.gameState = data.gameState;
    return player;
  }

  /**
   * Create a default local player
   */
  static createLocalPlayer(name: string = "You", seatIndex: number = 0): Player {
    const profile: PlayerProfile = {
      id: `local-${Date.now()}`,
      name,
      rank: 0,
      avatarUrl: undefined,
      stats: {
        gamesPlayed: 0,
        totalScore: 0,
        highScore: 0,
        wins: 0,
        averageScore: 0,
      },
    };

    return new Player(profile, seatIndex, true);
  }

  /**
   * Create a guest player (for future multiplayer)
   */
  static createGuestPlayer(
    name: string,
    seatIndex: number,
    isLocal: boolean = false
  ): Player {
    const profile: PlayerProfile = {
      id: `guest-${Date.now()}-${seatIndex}`,
      name,
      rank: 0,
      avatarUrl: undefined,
      stats: {
        gamesPlayed: 0,
        totalScore: 0,
        highScore: 0,
        wins: 0,
        averageScore: 0,
      },
    };

    return new Player(profile, seatIndex, isLocal);
  }
}
