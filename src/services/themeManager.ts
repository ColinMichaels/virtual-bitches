/**
 * Theme Manager Service
 * Manages dice themes and notifies renderers when theme changes
 *
 * @example
 * ```ts
 * // Initialize themes
 * await themeManager.initialize();
 *
 * // Get current theme
 * const theme = themeManager.getCurrentThemeConfig();
 *
 * // Switch theme
 * themeManager.setTheme('wooden');
 *
 * // Listen for changes
 * const unsubscribe = themeManager.onThemeChange((themeName) => {
 *   log.info('Theme changed to:', themeName);
 * });
 * ```
 */

import { logger } from '../utils/logger.js';

// Create module-specific logger
const log = logger.create('ThemeManager');

/**
 * Configuration structure for a dice theme
 */
export interface ThemeConfig {
  /** Display name shown in UI */
  name: string;
  /** Internal system name (folder name) */
  systemName: string;
  /** Theme creator */
  author: string;
  /** Theme version number */
  version: number;
  /** Mesh file name (e.g., smoothDice.json) */
  meshFile: string;
  /** Material configuration */
  material: {
    /** Material type: standard (baked textures) or color (base color + overlay) */
    type: 'standard' | 'color';
    /** Diffuse/color texture path or light/dark variants */
    diffuseTexture?: string | { light: string; dark: string };
    /** Normal map texture path */
    bumpTexture?: string;
    /** Specular map texture path */
    specularTexture?: string;
    /** Diffuse brightness multiplier (0-2) */
    diffuseLevel?: number;
    /** Normal map intensity (0-2) */
    bumpLevel?: number;
    /** Specular shininess (1-128) */
    specularPower?: number;
    /** Texture UV scale (optional) */
    textureScale?: { u: number; v: number };
    /** Texture UV offset (optional) */
    textureOffset?: { u: number; v: number };
    /** Per-die texture UV overrides (optional) */
    perDieOverrides?: {
      [dieType: string]: {
        textureScale?: { u: number; v: number };
        textureOffset?: { u: number; v: number };
      };
    };
  };
  /** Supported die types (d4, d6, d8, d10, d12, d20, d100) */
  diceAvailable: string[];
  /** Fallback theme for dice types not covered by this theme's textures */
  fallbackTheme?: string;
  /** Dice types that should use fallback (e.g., ["d10", "d12", "d20"] for pip-only themes) */
  useFallbackFor?: string[];
  /** UI customization options (optional) */
  ui?: {
    /** Background color for game board (hex string) */
    backgroundColor?: string;
    /** Game board/table surface color (hex string) */
    boardColor?: string;
    /** Base die colors for color material themes (hex strings) */
    diceColors?: {
      /** Dark dice color (used with light pips) */
      dark?: string;
      /** Light dice color (used with dark pips) */
      light?: string;
    };
    /** Accent color for UI elements (hex string) */
    accentColor?: string;
    /** Custom color palette for UI elements */
    colorSet?: {
      /** Primary UI color */
      primary?: string;
      /** Secondary UI color */
      secondary?: string;
      /** Success/positive color */
      success?: string;
      /** Warning color */
      warning?: string;
      /** Error/danger color */
      error?: string;
    };
  };
  /** Per-die geometry and physics settings (optional - uses geometry file defaults if not specified) */
  perDieSettings?: {
    [dieType: string]: {
      /** Position offset [x, y, z] for this die type in the geometry scene */
      positionOffset?: [number, number, number];
      /** Rotation quaternion [x, y, z, w] for this die type */
      rotationQuaternion?: [number, number, number, number];
      /** Scaling [x, y, z] for this die type */
      scaling?: [number, number, number];
      /** Physics properties for this die type */
      physics?: {
        /** Mass of the die in kg */
        mass?: number;
        /** Friction coefficient (0-1) */
        friction?: number;
        /** Bounciness/restitution (0-1) */
        restitution?: number;
      };
    };
  };
  /** Enable physics simulation (optional - defaults to true) */
  physicsEnabled?: boolean;
  /** Gravity vector [x, y, z] (optional - defaults to [0, -9.81, 0]) */
  gravity?: [number, number, number];
}

/**
 * Callback function invoked when theme changes
 */
type ThemeChangeListener = (themeName: string) => void;

/**
 * Available theme names
 * Add new themes here when adding to public/assets/themes/
 */
const AVAILABLE_THEMES = [
  'diceOfRolling',
  'default',
  'smooth-pip',
  'gemstone',
  'wooden',
  'blueGreenMetal',
  'rust',
  'smooth',
] as const;

/** Default fallback theme if none load successfully */
const DEFAULT_THEME = 'diceOfRolling';

/** Maximum retry attempts for failed theme loads */
const MAX_RETRY_ATTEMPTS = 2;

/** Delay between retry attempts (ms) */
const RETRY_DELAY_MS = 500;

class ThemeManager {
  private static instance: ThemeManager;
  private currentTheme: string = 'diceOfRolling';
  private availableThemes: Map<string, ThemeConfig> = new Map();
  private listeners: Set<ThemeChangeListener> = new Set();
  private initialized = false;

  private constructor() {
    this.loadThemeFromStorage();
  }

  static getInstance(): ThemeManager {
    if (!ThemeManager.instance) {
      ThemeManager.instance = new ThemeManager();
    }
    return ThemeManager.instance;
  }

  /**
   * Initialize theme manager by loading all available themes
   *
   * Loads theme configurations with retry logic for network failures.
   * If all themes fail to load, falls back to default theme.
   *
   * @throws {Error} If no themes can be loaded at all
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    log.info('Initializing...');

    // Load all available themes in parallel
    const loadPromises = AVAILABLE_THEMES.map(themeName =>
      this.loadThemeConfig(themeName)
    );

    const results = await Promise.allSettled(loadPromises);

    // Process results
    results.forEach((result, index) => {
      const themeName = AVAILABLE_THEMES[index];
      if (result.status === 'fulfilled' && result.value) {
        this.availableThemes.set(themeName, result.value);
        log.debug(`Loaded theme: ${result.value.name} (${themeName})`);
      } else {
        log.warn(`Failed to load theme ${themeName}:`,
          result.status === 'rejected' ? result.reason : 'Unknown error');
      }
    });

    // Ensure we loaded at least one theme
    if (this.availableThemes.size === 0) {
      throw new Error('Failed to load any themes. Check network connection and theme assets.');
    }

    // Ensure current theme is valid, fallback to default or first available
    if (!this.availableThemes.has(this.currentTheme)) {
      if (this.availableThemes.has(DEFAULT_THEME)) {
        this.currentTheme = DEFAULT_THEME;
        log.warn(`Saved theme not available, falling back to ${DEFAULT_THEME}`);
      } else {
        this.currentTheme = Array.from(this.availableThemes.keys())[0];
        log.warn(`Default theme not available, using ${this.currentTheme}`);
      }
    }

    this.initialized = true;
    log.info(`Initialized with ${this.availableThemes.size}/${AVAILABLE_THEMES.length} themes`);
    log.debug(`Current theme: ${this.currentTheme}`);
  }

  /**
   * Load a single theme configuration with retry logic
   *
   * @param themeName - Name of theme to load
   * @returns Theme configuration or null if load fails
   */
  private async loadThemeConfig(themeName: string): Promise<ThemeConfig | null> {
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const configPath = `./assets/themes/${themeName}/theme.config.json`;
        const response = await fetch(configPath);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const config: ThemeConfig = await response.json();

        // Basic validation
        if (!this.validateThemeConfig(config)) {
          throw new Error('Invalid theme configuration structure');
        }

        return config;
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRY_ATTEMPTS - 1;

        if (isLastAttempt) {
          log.error(`Failed to load theme ${themeName} after ${MAX_RETRY_ATTEMPTS} attempts:`, error);
          return null;
        }

        // Wait before retry
        log.debug(`Retry loading ${themeName} (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
        await this.delay(RETRY_DELAY_MS);
      }
    }

    return null;
  }

  /**
   * Validate theme configuration structure
   *
   * @param config - Theme config to validate
   * @returns True if valid, false otherwise
   */
  private validateThemeConfig(config: any): config is ThemeConfig {
    return (
      config &&
      typeof config.name === 'string' &&
      typeof config.systemName === 'string' &&
      typeof config.meshFile === 'string' &&
      config.material &&
      (config.material.type === 'standard' || config.material.type === 'color') &&
      Array.isArray(config.diceAvailable)
    );
  }

  /**
   * Delay helper for retry logic
   *
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current theme name
   *
   * @returns Current theme system name
   */
  getCurrentTheme(): string {
    return this.currentTheme;
  }

  /**
   * Get current theme configuration
   *
   * @returns Current theme config or null if not loaded
   */
  getCurrentThemeConfig(): ThemeConfig | null {
    return this.availableThemes.get(this.currentTheme) || null;
  }

  /**
   * Get theme configuration by name
   *
   * @param themeName - System name of theme
   * @returns Theme config or null if not found
   */
  getThemeConfig(themeName: string): ThemeConfig | null {
    return this.availableThemes.get(themeName) || null;
  }

  /**
   * Get all available themes
   *
   * @returns Array of theme names and configurations
   */
  getAvailableThemes(): Array<{ name: string; config: ThemeConfig }> {
    const themes: Array<{ name: string; config: ThemeConfig }> = [];
    this.availableThemes.forEach((config, name) => {
      themes.push({ name, config });
    });
    return themes;
  }

  /**
   * Set current theme
   *
   * Changes the active theme and notifies all listeners.
   * Persists selection to localStorage.
   *
   * @param themeName - System name of theme to activate
   * @returns True if theme was set, false if theme not available
   *
   * @example
 * ```ts
 * if (themeManager.setTheme('wooden')) {
 *   log.info('Theme changed successfully');
 * }
 * ```
   */
  setTheme(themeName: string): boolean {
    if (!this.availableThemes.has(themeName)) {
      log.warn(`Theme "${themeName}" not available`);
      return false;
    }

    if (this.currentTheme === themeName) {
      return true; // Already set
    }

    log.info(`Switching theme: ${this.currentTheme} → ${themeName}`);
    this.currentTheme = themeName;
    this.saveThemeToStorage();
    this.notifyListeners();
    return true;
  }

  /**
   * Get base path for current theme assets
   *
   * @returns Path to current theme folder
   */
  getCurrentThemePath(): string {
    const basePath = import.meta.env.BASE_URL || './';
    return `${basePath}assets/themes/${this.currentTheme}`;
  }

  /**
   * Get base path for specific theme assets
   *
   * @param themeName - System name of theme
   * @returns Path to theme folder
   */
  getThemePath(themeName: string): string {
    const basePath = import.meta.env.BASE_URL || './';
    return `${basePath}assets/themes/${themeName}`;
  }

  /**
   * Subscribe to theme changes
   *
   * Registers a callback to be invoked whenever the theme changes.
   *
   * @param listener - Callback function receiving new theme name
   * @returns Unsubscribe function to remove the listener
   *
   * @example
 * ```ts
 * const unsubscribe = themeManager.onThemeChange((themeName) => {
 *   log.info('Theme changed to:', themeName);
 * });
   *
   * // Later, to stop listening:
   * unsubscribe();
   * ```
   */
  onThemeChange(listener: ThemeChangeListener): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of theme change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.currentTheme);
      } catch (error) {
        log.error('Error in theme change listener:', error);
      }
    });
  }

  /**
   * Load saved theme from localStorage
   */
  private loadThemeFromStorage(): void {
    try {
      const saved = localStorage.getItem('biscuits-theme');
      if (saved) {
        this.currentTheme = saved;
        log.debug(`Loaded saved theme from storage: ${saved}`);
      }
    } catch (error) {
      log.warn('Failed to load theme from storage:', error);
    }
  }

  /**
   * Save current theme to localStorage
   */
  private saveThemeToStorage(): void {
    try {
      localStorage.setItem('biscuits-theme', this.currentTheme);
      log.debug(`Saved theme to storage: ${this.currentTheme}`);
    } catch (error) {
      log.warn('Failed to save theme to storage:', error);
    }
  }

  /**
   * Get theme config for a specific die type, with fallback support
   *
   * If the current theme specifies a fallback for certain die types,
   * this will return the fallback theme's config for those dice.
   *
   * @param dieKind - Die type (d4, d6, d8, d10, d12, d20)
   * @returns Theme config to use for this die type
   */
  getThemeConfigForDie(dieKind: string): ThemeConfig | null {
    const currentConfig = this.getCurrentThemeConfig();
    if (!currentConfig) return null;

    // Check if this die type should use fallback
    if (currentConfig.useFallbackFor?.includes(dieKind) && currentConfig.fallbackTheme) {
      const fallbackConfig = this.availableThemes.get(currentConfig.fallbackTheme);
      if (fallbackConfig) {
        log.debug(`Using fallback theme "${currentConfig.fallbackTheme}" for ${dieKind}`);
        return fallbackConfig;
      }
      log.warn(`Fallback theme "${currentConfig.fallbackTheme}" not available for ${dieKind}`);
    }

    return currentConfig;
  }

  /**
   * Get UI customization options for current theme
   *
   * @returns UI configuration object or default values
   */
  getUIConfig(): ThemeConfig['ui'] {
    const config = this.getCurrentThemeConfig();
    return config?.ui || {};
  }

  /**
   * Get background color for current theme
   *
   * @param defaultColor - Fallback color if not specified in theme
   * @returns Hex color string
   */
  getBackgroundColor(defaultColor: string = '#1a1a2e'): string {
    return this.getUIConfig()?.backgroundColor || defaultColor;
  }

  /**
   * Get board/table color for current theme
   *
   * @param defaultColor - Fallback color if not specified in theme
   * @returns Hex color string
   */
  getBoardColor(defaultColor: string = '#16213e'): string {
    return this.getUIConfig()?.boardColor || defaultColor;
  }

  /**
   * Get dice colors for color material themes
   *
   * @returns Object with dark and light dice colors
   */
  getDiceColors(): { dark: string; light: string } {
    const colors = this.getUIConfig()?.diceColors;
    return {
      dark: colors?.dark || '#333333',
      light: colors?.light || '#e5e5e5',
    };
  }

  /**
   * Get accent color for UI elements
   *
   * @param defaultColor - Fallback color if not specified in theme
   * @returns Hex color string
   */
  getAccentColor(defaultColor: string = '#0f3460'): string {
    return this.getUIConfig()?.accentColor || defaultColor;
  }

  /**
   * Get complete color set for UI elements
   *
   * @returns Color palette object with fallback defaults
   */
  getColorSet(): Required<NonNullable<ThemeConfig['ui']>['colorSet']> {
    const colorSet = this.getUIConfig()?.colorSet;
    return {
      primary: colorSet?.primary || '#0f3460',
      secondary: colorSet?.secondary || '#533483',
      success: colorSet?.success || '#2ecc71',
      warning: colorSet?.warning || '#f39c12',
      error: colorSet?.error || '#e74c3c',
    };
  }
}

// Export singleton instance
export const themeManager = ThemeManager.getInstance();
