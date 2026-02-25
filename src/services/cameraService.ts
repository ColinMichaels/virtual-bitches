/**
 * Camera Service
 * Manages camera position saving, loading, and tier-based access control
 * Supports progressive unlock system for advanced camera features
 */

import { logger } from "../utils/logger.js";
import { Vector3 } from "@babylonjs/core";

const log = logger.create('CameraService');

export type CameraTier = 'free' | 'unlocked' | 'premium';

export interface CameraPosition {
  id: string;              // UUID
  name: string;            // User-defined name
  alpha: number;           // Horizontal rotation (radians)
  beta: number;            // Vertical rotation (radians)
  radius: number;          // Distance from target
  target: {                // Camera focus point
    x: number;
    y: number;
    z: number;
  };
  createdAt: number;       // Timestamp
  isFavorite: boolean;     // Quick access flag
}

interface CameraServiceState {
  positions: CameraPosition[];
  tier: CameraTier;
  lastUsedId?: string;
}

const STORAGE_KEY = 'biscuits-camera-positions';

const TIER_LIMITS: Record<CameraTier, number> = {
  free: 3,
  unlocked: 10,
  premium: Infinity,
};

export class CameraService {
  private state: CameraServiceState;
  private listeners: Map<string, Set<Function>> = new Map();

  constructor() {
    this.state = this.loadState();
    log.info(`Camera service initialized with ${this.state.positions.length} saved positions (${this.state.tier} tier)`);
  }

  /**
   * Load saved state from localStorage
   */
  private loadState(): CameraServiceState {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          positions: parsed.positions || [],
          tier: parsed.tier || 'free',
          lastUsedId: parsed.lastUsedId,
        };
      }
    } catch (error) {
      log.warn('Failed to load camera state:', error);
    }

    return {
      positions: [],
      tier: 'free',
    };
  }

  /**
   * Save current state to localStorage
   */
  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      log.debug('Camera state saved');
    } catch (error) {
      log.error('Failed to save camera state:', error);
    }
  }

  /**
   * Generate UUID v4
   */
  private generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Save current camera position
   * @returns Position ID or null if limit reached
   */
  savePosition(name: string, position: Omit<CameraPosition, 'id' | 'name' | 'createdAt' | 'isFavorite'>): string | null {
    if (!this.canSaveMore()) {
      log.warn(`Cannot save position: ${this.state.tier} tier limit reached (${this.getMaxSlots()} slots)`);
      return null;
    }

    const newPosition: CameraPosition = {
      ...position,
      id: this.generateId(),
      name: name.trim() || `Position ${this.state.positions.length + 1}`,
      createdAt: Date.now(),
      isFavorite: false,
    };

    this.state.positions.push(newPosition);
    this.state.lastUsedId = newPosition.id;
    this.saveState();

    log.info(`Saved camera position: ${newPosition.name} (${newPosition.id})`);
    this.emit('positionAdded', newPosition);

    return newPosition.id;
  }

  /**
   * Load camera position by ID
   */
  loadPosition(id: string): CameraPosition | null {
    const position = this.state.positions.find(p => p.id === id);

    if (position) {
      this.state.lastUsedId = id;
      this.saveState();
      log.info(`Loaded camera position: ${position.name}`);
      this.emit('positionLoaded', position);
    } else {
      log.warn(`Position not found: ${id}`);
    }

    return position || null;
  }

  /**
   * Delete camera position
   */
  deletePosition(id: string): boolean {
    const index = this.state.positions.findIndex(p => p.id === id);

    if (index === -1) {
      log.warn(`Cannot delete: position not found (${id})`);
      return false;
    }

    const deleted = this.state.positions.splice(index, 1)[0];

    if (this.state.lastUsedId === id) {
      this.state.lastUsedId = undefined;
    }

    this.saveState();
    log.info(`Deleted camera position: ${deleted.name}`);
    this.emit('positionDeleted', id);

    return true;
  }

  /**
   * Update existing position
   */
  updatePosition(id: string, updates: Partial<Omit<CameraPosition, 'id' | 'createdAt'>>): boolean {
    const position = this.state.positions.find(p => p.id === id);

    if (!position) {
      log.warn(`Cannot update: position not found (${id})`);
      return false;
    }

    Object.assign(position, updates);
    this.saveState();
    log.info(`Updated camera position: ${position.name}`);
    this.emit('positionUpdated', position);

    return true;
  }

  /**
   * Toggle favorite status
   */
  toggleFavorite(id: string): boolean {
    const position = this.state.positions.find(p => p.id === id);

    if (!position) return false;

    position.isFavorite = !position.isFavorite;
    this.saveState();
    this.emit('positionUpdated', position);

    return position.isFavorite;
  }

  /**
   * Get all saved positions
   */
  listPositions(): CameraPosition[] {
    return [...this.state.positions];
  }

  /**
   * Get favorite positions
   */
  getFavorites(): CameraPosition[] {
    return this.state.positions.filter(p => p.isFavorite);
  }

  /**
   * Get last used position
   */
  getLastUsed(): CameraPosition | null {
    if (!this.state.lastUsedId) return null;
    return this.state.positions.find(p => p.id === this.state.lastUsedId) || null;
  }

  /**
   * Export single position as JSON
   */
  exportPosition(id: string): string | null {
    const position = this.state.positions.find(p => p.id === id);

    if (!position) {
      log.warn(`Cannot export: position not found (${id})`);
      return null;
    }

    const exported = {
      version: 1,
      position,
      exportedAt: Date.now(),
    };

    return JSON.stringify(exported, null, 2);
  }

  /**
   * Export all positions as JSON
   */
  exportAll(): string {
    const exported = {
      version: 1,
      positions: this.state.positions,
      exportedAt: Date.now(),
    };

    return JSON.stringify(exported, null, 2);
  }

  /**
   * Import single position from JSON
   * @returns New position ID or null if failed
   */
  importPosition(json: string): string | null {
    try {
      const data = JSON.parse(json);

      if (!data.position || typeof data.position !== 'object') {
        throw new Error('Invalid position data');
      }

      // Validate position structure
      const pos = data.position;
      if (typeof pos.alpha !== 'number' ||
          typeof pos.beta !== 'number' ||
          typeof pos.radius !== 'number' ||
          !pos.target ||
          typeof pos.target.x !== 'number') {
        throw new Error('Invalid position format');
      }

      // Check if we can save more
      if (!this.canSaveMore()) {
        log.warn('Cannot import: tier limit reached');
        return null;
      }

      // Create new position with fresh ID
      const newId = this.savePosition(pos.name || 'Imported Position', {
        alpha: pos.alpha,
        beta: pos.beta,
        radius: pos.radius,
        target: pos.target,
      });

      if (newId) {
        log.info(`Imported camera position: ${pos.name}`);
      }

      return newId;
    } catch (error) {
      log.error('Failed to import position:', error);
      return null;
    }
  }

  /**
   * Import multiple positions from JSON
   * @returns Array of successfully imported IDs
   */
  importAll(json: string): string[] {
    try {
      const data = JSON.parse(json);

      if (!Array.isArray(data.positions)) {
        throw new Error('Invalid positions array');
      }

      const imported: string[] = [];

      for (const pos of data.positions) {
        if (!this.canSaveMore()) {
          log.warn(`Import stopped: tier limit reached after ${imported.length} positions`);
          break;
        }

        const newId = this.savePosition(pos.name || 'Imported Position', {
          alpha: pos.alpha,
          beta: pos.beta,
          radius: pos.radius,
          target: pos.target,
        });

        if (newId) {
          imported.push(newId);
        }
      }

      log.info(`Imported ${imported.length} camera positions`);
      return imported;
    } catch (error) {
      log.error('Failed to import positions:', error);
      return [];
    }
  }

  /**
   * Clear all saved positions
   */
  clearAll(): void {
    const count = this.state.positions.length;
    this.state.positions = [];
    this.state.lastUsedId = undefined;
    this.saveState();

    log.info(`Cleared ${count} camera positions`);
    this.emit('allCleared');
  }

  /**
   * Get current tier
   */
  getTier(): CameraTier {
    return this.state.tier;
  }

  /**
   * Set camera tier (unlock features)
   */
  setTier(tier: CameraTier): void {
    const oldTier = this.state.tier;
    this.state.tier = tier;
    this.saveState();

    log.info(`Camera tier changed: ${oldTier} → ${tier}`);
    this.emit('tierChanged', tier);

    // If downgrading and over limit, warn user
    const maxSlots = this.getMaxSlots();
    if (this.state.positions.length > maxSlots) {
      log.warn(`Position count (${this.state.positions.length}) exceeds new tier limit (${maxSlots})`);
      // Note: We don't auto-delete positions, just prevent new saves
    }
  }

  /**
   * Check if more positions can be saved
   */
  canSaveMore(): boolean {
    return this.state.positions.length < this.getMaxSlots();
  }

  /**
   * Get maximum slots for current tier
   */
  getMaxSlots(): number {
    return TIER_LIMITS[this.state.tier];
  }

  /**
   * Get remaining slots
   */
  getRemainingSlots(): number {
    const max = this.getMaxSlots();
    if (max === Infinity) return Infinity;
    return Math.max(0, max - this.state.positions.length);
  }

  /**
   * Check if flying mode is unlocked
   */
  isFlyingModeUnlocked(): boolean {
    // Flying mode requires 'premium' tier or specific unlock
    // TODO: Integrate with achievement system
    return this.state.tier === 'premium';
  }

  /**
   * Check if machinima tools are unlocked
   */
  isMachinimaModeUnlocked(): boolean {
    // Machinima requires premium tier
    return this.state.tier === 'premium';
  }

  /**
   * Subscribe to events
   */
  on(event: string, callback: Function): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(callback);
      }
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: string, ...args: any[]): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          log.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Get stats for debugging
   */
  getStats(): {
    positionCount: number;
    favoriteCount: number;
    tier: CameraTier;
    maxSlots: number;
    remainingSlots: number;
    lastUsed?: string;
  } {
    return {
      positionCount: this.state.positions.length,
      favoriteCount: this.state.positions.filter(p => p.isFavorite).length,
      tier: this.state.tier,
      maxSlots: this.getMaxSlots(),
      remainingSlots: this.getRemainingSlots(),
      lastUsed: this.state.lastUsedId,
    };
  }
}

// Singleton instance
export const cameraService = new CameraService();
