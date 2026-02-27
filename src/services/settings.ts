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
  mobileDiceLayout: "wrapped" | "single-row" | "perimeter";
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
  cameraAssistEnabled: boolean;
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
    mobileDiceLayout: "wrapped",
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
    cameraAssistEnabled: true,
    addD20: false,
    addD4: false,
    add2ndD10: false,
    d100Mode: false,
    difficulty: "normal",
  },
  haptics: true,
};

const STORAGE_KEY = "biscuits-settings";

interface StoredSettingsPayload {
  settings: Settings;
  updatedAt: number;
}

export class SettingsService {
  private settings: Settings;
  private lastUpdatedAt: number;
  private listeners: Array<(settings: Settings) => void> = [];

  constructor() {
    const loaded = this.loadSettings();
    this.settings = loaded.settings;
    this.lastUpdatedAt = loaded.updatedAt;
  }

  /**
   * Load settings from localStorage or use defaults
   */
  private loadSettings(): StoredSettingsPayload {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (isStoredSettingsPayload(parsed)) {
          return {
            settings: this.mergeWithDefaults(parsed.settings),
            updatedAt: normalizeTimestamp(parsed.updatedAt),
          };
        }

        // Legacy format: raw settings object only.
        return {
          settings: this.mergeWithDefaults(parsed),
          updatedAt: 0,
        };
      }
    } catch (error) {
      log.warn("Failed to load settings:", error);
    }

    return {
      settings: { ...DEFAULT_SETTINGS },
      updatedAt: 0,
    };
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
      haptics: typeof loaded.haptics === "boolean" ? loaded.haptics : DEFAULT_SETTINGS.haptics,
    };
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(): void {
    try {
      const payload: StoredSettingsPayload = {
        settings: this.settings,
        updatedAt: this.lastUpdatedAt,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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

  getLastUpdatedAt(): number {
    return this.lastUpdatedAt;
  }

  /**
   * Update audio settings
   */
  updateAudio(audio: Partial<AudioSettings>): void {
    this.settings.audio = { ...this.settings.audio, ...audio };
    this.touchUpdatedAt();
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
    this.touchUpdatedAt();
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update visual settings (convenience method)
   */
  updateVisual(visual: Partial<VisualSettings>): void {
    this.settings.display.visual = { ...this.settings.display.visual, ...visual };
    this.touchUpdatedAt();
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update control settings
   */
  updateControls(controls: Partial<ControlSettings>): void {
    this.settings.controls = { ...this.settings.controls, ...controls };
    this.touchUpdatedAt();
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update haptics setting
   */
  updateHaptics(enabled: boolean): void {
    this.settings.haptics = enabled;
    this.touchUpdatedAt();
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Update game settings
   */
  updateGame(game: Partial<GameSettings>): void {
    this.settings.game = { ...this.settings.game, ...game };
    this.touchUpdatedAt();
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Replace full settings snapshot (used by remote profile sync)
   */
  replaceSettings(nextSettings: Settings, updatedAt?: number): void {
    this.settings = this.mergeWithDefaults(nextSettings);
    this.lastUpdatedAt = normalizeTimestamp(updatedAt) || Date.now();
    this.saveSettings();
    this.notifyListeners();
  }

  /**
   * Reset to default settings
   */
  resetToDefaults(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.touchUpdatedAt();
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

  private touchUpdatedAt(): void {
    this.lastUpdatedAt = Date.now();
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

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function isStoredSettingsPayload(value: unknown): value is StoredSettingsPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredSettingsPayload>;
  return Boolean(candidate.settings && typeof candidate.settings === "object");
}
