/**
 * Settings Service
 * Manages game settings and persists them to localStorage
 */

import { logger } from "../utils/logger.js";
import { GameDifficulty } from "../engine/types.js";

const log = logger.create('SettingsService');

export interface AudioSettings {
  masterVolume: number; // 0-1
  sfxVolume: number; // 0-1
  musicVolume: number; // 0-1
  sfxEnabled: boolean;
  musicEnabled: boolean;
}

export interface VisualSettings {
  tableContrast: "low" | "normal" | "high" | "maximum";
}

export interface DisplaySettings {
  graphicsQuality: "low" | "medium" | "high";
  shadowsEnabled: boolean;
  particlesEnabled: boolean;
  particleIntensity: "off" | "minimal" | "normal" | "enthusiastic";
  visual: VisualSettings;
}

export interface ControlSettings {
  cameraSensitivity: number; // 0.5-2.0
  reduceChaosCameraEffects: boolean;
  allowChaosControlInversion: boolean;
}

export interface CameraSettings {
  sensitivity: number; // 0.5-2.0 (mirror of controls.cameraSensitivity)
  smoothTransitions: boolean;
  transitionDuration: number; // seconds
  savedPositionSlots?: number; // optional override (defaults determined by tier)
  flyingModeEnabled?: boolean;
  machinimaModeEnabled?: boolean;
}

export interface GameSettings {
  showTutorial: boolean;
  confirmBeforeNewGame: boolean;
  addD20: boolean;
  addD4: boolean;
  add2ndD10: boolean;
  d100Mode: boolean;
  difficulty: GameDifficulty;
}

export interface Settings {
  audio: AudioSettings;
  display: DisplaySettings;
  controls: ControlSettings;
  camera?: CameraSettings;
  game: GameSettings;
  haptics?: boolean; // Optional for backwards compatibility
}

const DEFAULT_SETTINGS: Settings = {
  audio: {
    masterVolume: 0.7,
    sfxVolume: 0.8,
    musicVolume: 0,
    sfxEnabled: true,
    musicEnabled: false,
  },
  display: {
    graphicsQuality: "high",
    shadowsEnabled: true,
    particlesEnabled: true,
    particleIntensity: "normal",
    visual: {
      tableContrast: "high",
    },
  },
  controls: {
    cameraSensitivity: 1.0,
    reduceChaosCameraEffects: false,
    allowChaosControlInversion: true,
  },
  camera: {
    sensitivity: 1.0,
    smoothTransitions: false,
    transitionDuration: 0.75,
    // savedPositionSlots left undefined to be driven by CameraService tier limits
    flyingModeEnabled: false,
    machinimaModeEnabled: false,
  },
  game: {
    showTutorial: true,
    confirmBeforeNewGame: false,
    addD20: false,
    addD4: false,
    add2ndD10: false,
    d100Mode: false,
    difficulty: "normal",
  },
  haptics: true,
};

const STORAGE_KEY = "biscuits-settings";

export class SettingsService {
  private settings: Settings;
  private listeners: Array<(settings: Settings) => void> = [];

  constructor() {
    this.settings = this.loadSettings();
  }

  /**
   * Load settings from localStorage or use defaults
   */
  private loadSettings(): Settings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new settings added in updates
        return this.mergeWithDefaults(parsed);
      }
    } catch (error) {
      log.warn("Failed to load settings:", error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * Merge loaded settings with defaults (handles missing keys)
   */
  private mergeWithDefaults(loaded: any): Settings {
    return {
      audio: { ...DEFAULT_SETTINGS.audio, ...loaded.audio },
      display: {
        ...DEFAULT_SETTINGS.display,
        ...loaded.display,
        visual: {
          ...DEFAULT_SETTINGS.display.visual,
          ...(loaded.display?.visual || {})
        }
      },
      controls: { ...DEFAULT_SETTINGS.controls, ...loaded.controls },
      camera: { ...DEFAULT_SETTINGS.camera, ...(loaded.camera || {}) },
      game: { ...DEFAULT_SETTINGS.game, ...loaded.game },
    };
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      log.error("Failed to save settings:", error);
    }
  }

  /**
   * Get current settings
   */
  getSettings(): Settings {
    return { ...this.settings };
  }

  /**
   * Update audio settings
   */
  updateAudio(audio: Partial<AudioSettings>): void {
    this.settings.audio = { ...this.settings.audio, ...audio };
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update display settings
   */
  updateDisplay(display: Partial<DisplaySettings>): void {
    // Handle nested visual settings merge
    if (display.visual) {
      this.settings.display.visual = { ...this.settings.display.visual, ...display.visual };
      delete display.visual; // Prevent shallow overwrite
    }
    this.settings.display = { ...this.settings.display, ...display };
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update visual settings (convenience method)
   */
  updateVisual(visual: Partial<VisualSettings>): void {
    this.settings.display.visual = { ...this.settings.display.visual, ...visual };
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update control settings
   */
  updateControls(controls: Partial<ControlSettings>): void {
    this.settings.controls = { ...this.settings.controls, ...controls };
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update haptics setting
   */
  updateHaptics(enabled: boolean): void {
    this.settings.haptics = enabled;
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update game settings
   */
  updateGame(game: Partial<GameSettings>): void {
    this.settings.game = { ...this.settings.game, ...game };
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Reset to default settings
   */
  resetToDefaults(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Subscribe to settings changes
   */
  onChange(listener: (settings: Settings) => void): () => void {
    this.listeners.push(listener);
    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Notify all listeners of settings changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.settings));
  }

  /**
   * Get effective SFX volume (master * sfx * enabled)
   */
  getSfxVolume(): number {
    if (!this.settings.audio.sfxEnabled) return 0;
    return this.settings.audio.masterVolume * this.settings.audio.sfxVolume;
  }

  /**
   * Get effective music volume (master * music * enabled)
   */
  getMusicVolume(): number {
    if (!this.settings.audio.musicEnabled) return 0;
    return this.settings.audio.masterVolume * this.settings.audio.musicVolume;
  }
}

// Singleton instance
export const settingsService = new SettingsService();
