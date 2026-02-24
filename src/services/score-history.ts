/**
 * Score History Service
 * Manages local score history and statistics
 */

import { Action, GameMode } from "../engine/types.js";
import { environment } from "@env";
import { logger } from "../utils/logger.js";

const log = logger.create('ScoreHistoryService');

export interface GameScore {
  id: string; // UUID
  score: number;
  timestamp: number;
  seed: string;
  actionLog: Action[]; // For replay
  duration: number; // Game length in ms
  rollCount: number;
  mode: GameMode; // Game mode (difficulty + variant)
  playerName?: string; // Optional player identification
  synced: boolean; // Track if uploaded to backend
}

export interface ScoreStats {
  totalGames: number;
  bestScore: number;
  averageScore: number;
  totalPlayTime: number;
}

const STORAGE_KEY = `${environment.storage.prefix}-score-history`;
const MAX_STORED_SCORES = 100; // Limit storage size

export class ScoreHistoryService {
  /**
   * Generate UUID v4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Load score history from localStorage
   */
  private loadScores(): GameScore[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      log.error("Failed to load score history:", error);
    }
    return [];
  }

  /**
   * Save score history to localStorage
   */
  private saveScores(scores: GameScore[]): void {
    try {
      // Keep only the most recent MAX_STORED_SCORES
      const trimmed = scores
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_STORED_SCORES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (error) {
      log.error("Failed to save score history:", error);
    }
  }

  /**
   * Save a new game score
   */
  saveScore(
    score: number,
    seed: string,
    actionLog: Action[],
    duration: number,
    rollCount: number,
    mode: GameMode,
    playerName?: string
  ): GameScore {
    const gameScore: GameScore = {
      id: this.generateUUID(),
      score,
      timestamp: Date.now(),
      seed,
      actionLog,
      duration,
      rollCount,
      mode,
      playerName,
      synced: false,
    };

    const scores = this.loadScores();
    scores.push(gameScore);
    this.saveScores(scores);

    return gameScore;
  }

  /**
   * Get score history (sorted by timestamp, most recent first)
   */
  getScoreHistory(limit?: number): GameScore[] {
    const scores = this.loadScores().sort((a, b) => b.timestamp - a.timestamp);
    return limit ? scores.slice(0, limit) : scores;
  }

  /**
   * Get score history sorted by best score
   */
  getTopScores(limit: number = 10): GameScore[] {
    return this.loadScores()
      .sort((a, b) => a.score - b.score) // Lower is better
      .slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStats(): ScoreStats {
    const scores = this.loadScores();

    if (scores.length === 0) {
      return {
        totalGames: 0,
        bestScore: 0,
        averageScore: 0,
        totalPlayTime: 0,
      };
    }

    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
    const bestScore = Math.min(...scores.map((s) => s.score));
    const totalPlayTime = scores.reduce((sum, s) => sum + s.duration, 0);

    return {
      totalGames: scores.length,
      bestScore,
      averageScore: Math.round(totalScore / scores.length),
      totalPlayTime,
    };
  }

  /**
   * Get a specific score by ID
   */
  getScore(id: string): GameScore | undefined {
    return this.loadScores().find((s) => s.id === id);
  }

  /**
   * Get unsynced scores (for future backend sync)
   */
  getUnsyncedScores(): GameScore[] {
    return this.loadScores().filter((s) => !s.synced);
  }

  /**
   * Mark scores as synced
   */
  markSynced(scoreIds: string[]): void {
    const scores = this.loadScores().map((score) => {
      if (scoreIds.includes(score.id)) {
        return { ...score, synced: true };
      }
      return score;
    });
    this.saveScores(scores);
  }

  /**
   * Clear all score history
   */
  clearHistory(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      log.error("Failed to clear score history:", error);
    }
  }

  /**
   * Get rank of a specific score
   */
  getRank(score: number): number {
    const scores = this.loadScores();
    const betterScores = scores.filter((s) => s.score < score);
    return betterScores.length + 1;
  }
}

// Singleton instance
export const scoreHistoryService = new ScoreHistoryService();
