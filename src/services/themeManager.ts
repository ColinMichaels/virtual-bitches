/**
 * Theme Manager Service
 * Manages dice themes and notifies renderers when theme changes
 */

export interface ThemeConfig {
  name: string;
  systemName: string;
  author: string;
  version: number;
  meshFile: string;
  material: {
    type: 'standard' | 'color';
    diffuseTexture?: string | { light: string; dark: string };
    bumpTexture?: string;
    specularTexture?: string;
    diffuseLevel?: number;
    bumpLevel?: number;
    specularPower?: number;
  };
  diceAvailable: string[];
}

type ThemeChangeListener = (themeName: string) => void;

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
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('🎨 Initializing ThemeManager...');

    // Load all available themes from assets/textures directory
    const themeNames = ['diceOfRolling', 'default', 'smooth-pip', 'gemstone', 'wooden', 'blueGreenMetal', 'rust', 'smooth'];

    for (const themeName of themeNames) {
      try {
        const configPath = `/src/assets/textures/${themeName}/theme.config.json`;
        const response = await fetch(configPath);

        if (response.ok) {
          const config: ThemeConfig = await response.json();
          this.availableThemes.set(themeName, config);
          console.log(`  ✓ Loaded theme: ${config.name} (${themeName})`);
        }
      } catch (error) {
        console.warn(`  ⚠️ Failed to load theme ${themeName}:`, error);
      }
    }

    // Ensure current theme is valid
    if (!this.availableThemes.has(this.currentTheme)) {
      this.currentTheme = themeNames[0];
    }

    this.initialized = true;
    console.log(`✅ ThemeManager initialized with ${this.availableThemes.size} themes`);
    console.log(`   Current theme: ${this.currentTheme}`);
  }

  /**
   * Get current theme name
   */
  getCurrentTheme(): string {
    return this.currentTheme;
  }

  /**
   * Get current theme configuration
   */
  getCurrentThemeConfig(): ThemeConfig | null {
    return this.availableThemes.get(this.currentTheme) || null;
  }

  /**
   * Get theme configuration by name
   */
  getThemeConfig(themeName: string): ThemeConfig | null {
    return this.availableThemes.get(themeName) || null;
  }

  /**
   * Get all available themes
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
   */
  setTheme(themeName: string): boolean {
    if (!this.availableThemes.has(themeName)) {
      console.warn(`⚠️ Theme "${themeName}" not available`);
      return false;
    }

    if (this.currentTheme === themeName) {
      return true; // Already set
    }

    console.log(`🎨 Switching theme: ${this.currentTheme} → ${themeName}`);
    this.currentTheme = themeName;
    this.saveThemeToStorage();
    this.notifyListeners();
    return true;
  }

  /**
   * Get base path for current theme assets
   */
  getCurrentThemePath(): string {
    return `/src/assets/textures/${this.currentTheme}`;
  }

  /**
   * Get base path for specific theme assets
   */
  getThemePath(themeName: string): string {
    return `/src/assets/textures/${themeName}`;
  }

  /**
   * Subscribe to theme changes
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
        console.error('Error in theme change listener:', error);
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
      }
    } catch (error) {
      console.warn('Failed to load theme from storage:', error);
    }
  }

  /**
   * Save current theme to localStorage
   */
  private saveThemeToStorage(): void {
    try {
      localStorage.setItem('biscuits-theme', this.currentTheme);
    } catch (error) {
      console.warn('Failed to save theme to storage:', error);
    }
  }
}

// Export singleton instance
export const themeManager = ThemeManager.getInstance();
