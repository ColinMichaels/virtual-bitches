/**
 * Settings Modal
 * UI for adjusting game settings
 */

import { settingsService, Settings } from "../services/settings.js";
import { audioService } from "../services/audio.js";
import { hapticsService } from "../services/haptics.js";
import { notificationService } from "./notifications.js";
import { ThemeSwitcher } from "./themeSwitcher.js";
import { GameDifficulty } from "../engine/types.js";

export class SettingsModal {
  private container: HTMLElement;
  private settings: Settings;
  private themeSwitcher: ThemeSwitcher;
  private onClose: (() => void) | null = null;
  private onNewGame: (() => void) | null = null;
  private onHowToPlay: (() => void) | null = null;
  private checkGameInProgress: (() => boolean) | null = null;

  constructor() {
    this.settings = settingsService.getSettings();

    // Create modal
    this.container = document.createElement("div");
    this.container.id = "settings-modal";
    this.container.innerHTML = `
      <div class="settings-backdrop"></div>
      <div class="settings-content">
        <h2>Settings</h2>

        <div class="settings-section">
          <h3>Audio</h3>

          <div class="setting-row">
            <label for="master-volume">Master Volume</label>
            <input type="range" id="master-volume" min="0" max="100" value="${this.settings.audio.masterVolume * 100}">
            <span id="master-volume-value">${Math.round(this.settings.audio.masterVolume * 100)}%</span>
          </div>

          <div class="setting-row">
            <label for="sfx-volume">Sound Effects</label>
            <input type="range" id="sfx-volume" min="0" max="100" value="${this.settings.audio.sfxVolume * 100}">
            <span id="sfx-volume-value">${Math.round(this.settings.audio.sfxVolume * 100)}%</span>
          </div>

          <div class="setting-row">
            <label for="music-volume">Music</label>
            <input type="range" id="music-volume" min="0" max="100" value="${this.settings.audio.musicVolume * 100}">
            <span id="music-volume-value">${Math.round(this.settings.audio.musicVolume * 100)}%</span>
          </div>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="sfx-enabled" ${this.settings.audio.sfxEnabled ? "checked" : ""}>
              Enable Sound Effects
            </label>
          </div>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="music-enabled" ${this.settings.audio.musicEnabled ? "checked" : ""}>
              Enable Music
            </label>
          </div>

          <div class="setting-row" ${hapticsService.isSupported() ? '' : 'style="display:none;"'}>
            <label>
              <input type="checkbox" id="haptics-enabled" ${this.settings.haptics !== false ? "checked" : ""}>
              Enable Haptic Feedback
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h3>Display</h3>

          <div class="setting-row">
            <label for="graphics-quality">Graphics Quality</label>
            <select id="graphics-quality">
              <option value="low" ${this.settings.display.graphicsQuality === "low" ? "selected" : ""}>Low</option>
              <option value="medium" ${this.settings.display.graphicsQuality === "medium" ? "selected" : ""}>Medium</option>
              <option value="high" ${this.settings.display.graphicsQuality === "high" ? "selected" : ""}>High</option>
            </select>
          </div>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="shadows-enabled" ${this.settings.display.shadowsEnabled ? "checked" : ""}>
              Enable Shadows
            </label>
          </div>
        </div>

        <div class="settings-section">
          <h3>Visual Settings</h3>
          <p class="setting-description">Adjust table contrast for better dice visibility</p>

          <div class="setting-row">
            <label for="table-contrast">Table Contrast</label>
            <select id="table-contrast">
              <option value="low" ${this.settings.display.visual.tableContrast === "low" ? "selected" : ""}>Low (Brighter Table)</option>
              <option value="normal" ${this.settings.display.visual.tableContrast === "normal" ? "selected" : ""}>Normal (Balanced)</option>
              <option value="high" ${this.settings.display.visual.tableContrast === "high" ? "selected" : ""}>High (Good Readability)</option>
              <option value="maximum" ${this.settings.display.visual.tableContrast === "maximum" ? "selected" : ""}>Maximum (Best Readability)</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h3>Accessibility (Chaos Effects)</h3>
          <p class="setting-description">Reduce disruptive camera effects when needed</p>

          <div class="setting-row">
            <label>
              <input
                type="checkbox"
                id="reduce-chaos-camera-effects"
                ${this.settings.controls.reduceChaosCameraEffects ? "checked" : ""}
              >
              Reduce camera attack effects
            </label>
          </div>

          <div class="setting-row">
            <label>
              <input
                type="checkbox"
                id="allow-control-inversion"
                ${this.settings.controls.allowChaosControlInversion ? "checked" : ""}
              >
              Allow control inversion during drunk attacks
            </label>
          </div>
        </div>

        <div class="settings-section" id="theme-switcher-container">
        </div>

        <div class="settings-section">
          <h3>Game Mode</h3>
          <p class="setting-description">Changes apply to new games only</p>

          <div class="setting-row">
            <label for="game-difficulty">Difficulty</label>
            <select id="game-difficulty">
              <option value="easy" ${this.settings.game.difficulty === "easy" ? "selected" : ""}>Easy (Hints + More Help)</option>
              <option value="normal" ${this.settings.game.difficulty === "normal" ? "selected" : ""}>Normal (Standard Rules)</option>
              <option value="hard" ${this.settings.game.difficulty === "hard" ? "selected" : ""}>Hard (No Hints, Strict)</option>
            </select>
          </div>

          <div class="setting-row difficulty-info">
            <p id="difficulty-info-text" class="setting-description"></p>
          </div>
        </div>

        <div class="settings-section">
          <h3>Game Variants</h3>
          <p class="setting-description">Customize your dice pool</p>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="variant-d20" ${this.settings.game.addD20 ? "checked" : ""}>
              Add d20 (removes 1 d6)
            </label>
          </div>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="variant-d4" ${this.settings.game.addD4 ? "checked" : ""}>
              Add d4 (removes 1 d6)
            </label>
          </div>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="variant-2nd-d10" ${this.settings.game.add2ndD10 ? "checked" : ""}>
              Add 2nd d10 (removes 1 d6)
            </label>
          </div>

          <div class="setting-row">
            <label>
              <input type="checkbox" id="variant-d100" ${this.settings.game.d100Mode ? "checked" : ""}>
              d100 Mode (requires 2nd d10)
            </label>
          </div>
        </div>

        <div class="settings-buttons">
          <button id="settings-how-to-play">How to Play</button>
          <button id="settings-close" class="primary">Close</button>
          <button id="settings-new-game" class="danger">New Game</button>
          <button id="settings-reset">Reset to Defaults</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    // Create and add theme switcher
    this.themeSwitcher = new ThemeSwitcher();
    const themeSwitcherContainer = this.container.querySelector("#theme-switcher-container");
    if (themeSwitcherContainer) {
      themeSwitcherContainer.appendChild(this.themeSwitcher.getElement());
    }

    this.setupEventListeners();
    this.updateDifficultyInfo();
  }

  /**
   * Setup event listeners for all settings controls
   */
  private setupEventListeners(): void {
    // Master volume
    const masterVolume = document.getElementById("master-volume") as HTMLInputElement;
    const masterValue = document.getElementById("master-volume-value")!;
    masterVolume.addEventListener("input", () => {
      const value = parseInt(masterVolume.value) / 100;
      masterValue.textContent = `${masterVolume.value}%`;
      settingsService.updateAudio({ masterVolume: value });
      audioService.playSfx("click");
    });

    // SFX volume
    const sfxVolume = document.getElementById("sfx-volume") as HTMLInputElement;
    const sfxValue = document.getElementById("sfx-volume-value")!;
    sfxVolume.addEventListener("input", () => {
      const value = parseInt(sfxVolume.value) / 100;
      sfxValue.textContent = `${sfxVolume.value}%`;
      settingsService.updateAudio({ sfxVolume: value });
      audioService.playSfx("click");
    });

    // Music volume
    const musicVolume = document.getElementById("music-volume") as HTMLInputElement;
    const musicValue = document.getElementById("music-volume-value")!;
    musicVolume.addEventListener("input", () => {
      const value = parseInt(musicVolume.value) / 100;
      musicValue.textContent = `${musicVolume.value}%`;
      settingsService.updateAudio({ musicVolume: value });
    });

    // SFX enabled
    const sfxEnabled = document.getElementById("sfx-enabled") as HTMLInputElement;
    sfxEnabled.addEventListener("change", () => {
      settingsService.updateAudio({ sfxEnabled: sfxEnabled.checked });
      if (sfxEnabled.checked) audioService.playSfx("click");
    });

    // Music enabled
    const musicEnabled = document.getElementById("music-enabled") as HTMLInputElement;
    musicEnabled.addEventListener("change", () => {
      settingsService.updateAudio({ musicEnabled: musicEnabled.checked });
      if (musicEnabled.checked && !audioService.isInitialized()) {
        audioService.initialize().then(() => audioService.playMusic());
      } else if (!musicEnabled.checked) {
        audioService.stopMusic();
      }
    });

    // Haptics enabled (only if supported)
    if (hapticsService.isSupported()) {
      const hapticsEnabled = document.getElementById("haptics-enabled") as HTMLInputElement;
      hapticsEnabled?.addEventListener("change", () => {
        hapticsService.setEnabled(hapticsEnabled.checked);
        if (hapticsEnabled.checked) {
          hapticsService.buttonPress(); // Test vibration
        }
        audioService.playSfx("click");
      });
    }

    // Graphics quality
    const graphicsQuality = document.getElementById("graphics-quality") as HTMLSelectElement;
    graphicsQuality.addEventListener("change", () => {
      settingsService.updateDisplay({
        graphicsQuality: graphicsQuality.value as "low" | "medium" | "high"
      });
      audioService.playSfx("click");
    });

    // Shadows
    const shadowsEnabled = document.getElementById("shadows-enabled") as HTMLInputElement;
    shadowsEnabled.addEventListener("change", () => {
      settingsService.updateDisplay({ shadowsEnabled: shadowsEnabled.checked });
      audioService.playSfx("click");
    });

    // Table Contrast
    const tableContrast = document.getElementById("table-contrast") as HTMLSelectElement;
    tableContrast.addEventListener("change", () => {
      const value = tableContrast.value as "low" | "normal" | "high" | "maximum";
      settingsService.updateVisual({ tableContrast: value });

      // User feedback - show confirmation notification
      const labels = {
        low: "Low Contrast (Brighter Table)",
        normal: "Normal Contrast (Balanced)",
        high: "High Contrast (Darker Table)",
        maximum: "Maximum Contrast (Darkest Table)"
      };
      notificationService.show(`Table contrast: ${labels[value]}`, "info", 2000);

      // Briefly hide settings modal so user can see the table change
      this.container.style.opacity = "0";
      this.container.style.pointerEvents = "none";
      setTimeout(() => {
        this.container.style.opacity = "1";
        this.container.style.pointerEvents = "auto";
      }, 800); // Show change for 800ms

      audioService.playSfx("click");
    });

    // Chaos accessibility safeguards
    const reduceChaosEffects = document.getElementById("reduce-chaos-camera-effects") as HTMLInputElement;
    reduceChaosEffects.addEventListener("change", () => {
      settingsService.updateControls({ reduceChaosCameraEffects: reduceChaosEffects.checked });
      notificationService.show(
        reduceChaosEffects.checked
          ? "Chaos camera effects reduced"
          : "Chaos camera effects restored",
        "info",
        2000
      );
      audioService.playSfx("click");
    });

    const allowControlInversion = document.getElementById("allow-control-inversion") as HTMLInputElement;
    allowControlInversion.addEventListener("change", () => {
      settingsService.updateControls({
        allowChaosControlInversion: allowControlInversion.checked,
      });
      notificationService.show(
        allowControlInversion.checked
          ? "Control inversion enabled for drunk attacks"
          : "Control inversion blocked by accessibility setting",
        "info",
        2200
      );
      audioService.playSfx("click");
    });

    // Game Difficulty
    const gameDifficulty = document.getElementById("game-difficulty") as HTMLSelectElement;
    gameDifficulty.addEventListener("change", () => {
      // Check if game is in progress
      if (this.checkGameInProgress && this.checkGameInProgress()) {
        const confirmed = confirm(
          "Changing difficulty will start a new game. Your current progress will be lost. Continue?"
        );
        if (!confirmed) {
          // Revert the dropdown to previous value
          gameDifficulty.value = this.settings.game.difficulty;
          return;
        }
      }

      settingsService.updateGame({
        difficulty: gameDifficulty.value as GameDifficulty
      });
      this.updateDifficultyInfo();
      audioService.playSfx("click");

      // Start new game if one was in progress
      if (this.checkGameInProgress && this.checkGameInProgress()) {
        this.hide();
        if (this.onNewGame) {
          this.onNewGame();
        }
      }
    });

    // Game Variants
    const variantD20 = document.getElementById("variant-d20") as HTMLInputElement;
    variantD20.addEventListener("change", () => {
      if (this.checkGameInProgress && this.checkGameInProgress()) {
        const confirmed = confirm(
          "Changing dice variants will start a new game. Your current progress will be lost. Continue?"
        );
        if (!confirmed) {
          variantD20.checked = this.settings.game.addD20;
          return;
        }
      }
      settingsService.updateGame({ addD20: variantD20.checked });
      audioService.playSfx("click");
      if (this.checkGameInProgress && this.checkGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    const variantD4 = document.getElementById("variant-d4") as HTMLInputElement;
    variantD4.addEventListener("change", () => {
      if (this.checkGameInProgress && this.checkGameInProgress()) {
        const confirmed = confirm(
          "Changing dice variants will start a new game. Your current progress will be lost. Continue?"
        );
        if (!confirmed) {
          variantD4.checked = this.settings.game.addD4;
          return;
        }
      }
      settingsService.updateGame({ addD4: variantD4.checked });
      audioService.playSfx("click");
      if (this.checkGameInProgress && this.checkGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    const variant2ndD10 = document.getElementById("variant-2nd-d10") as HTMLInputElement;
    variant2ndD10.addEventListener("change", () => {
      if (this.checkGameInProgress && this.checkGameInProgress()) {
        const confirmed = confirm(
          "Changing dice variants will start a new game. Your current progress will be lost. Continue?"
        );
        if (!confirmed) {
          variant2ndD10.checked = this.settings.game.add2ndD10;
          return;
        }
      }
      settingsService.updateGame({ add2ndD10: variant2ndD10.checked });
      audioService.playSfx("click");
      // If d100 mode is enabled but 2nd d10 is now disabled, disable d100 mode
      if (!variant2ndD10.checked && this.settings.game.d100Mode) {
        settingsService.updateGame({ d100Mode: false });
        (document.getElementById("variant-d100") as HTMLInputElement).checked = false;
      }
      if (this.checkGameInProgress && this.checkGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    const variantD100 = document.getElementById("variant-d100") as HTMLInputElement;
    variantD100.addEventListener("change", () => {
      if (this.checkGameInProgress && this.checkGameInProgress()) {
        const confirmed = confirm(
          "Changing dice variants will start a new game. Your current progress will be lost. Continue?"
        );
        if (!confirmed) {
          variantD100.checked = this.settings.game.d100Mode;
          return;
        }
      }
      // d100 mode requires 2nd d10
      if (variantD100.checked && !this.settings.game.add2ndD10) {
        settingsService.updateGame({ add2ndD10: true });
        (document.getElementById("variant-2nd-d10") as HTMLInputElement).checked = true;
      }
      settingsService.updateGame({ d100Mode: variantD100.checked });
      audioService.playSfx("click");
      if (this.checkGameInProgress && this.checkGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    // How to Play button
    document.getElementById("settings-how-to-play")!.addEventListener("click", () => {
      audioService.playSfx("click");
      if (this.onHowToPlay) {
        this.onHowToPlay();
      }
    });

    // Close button
    document.getElementById("settings-close")!.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
    });

    // New Game button
    document.getElementById("settings-new-game")!.addEventListener("click", () => {
      audioService.playSfx("click");
      if (confirm("Start a new game? Your current progress will be lost.")) {
        this.hide();
        if (this.onNewGame) {
          this.onNewGame();
        }
      }
    });

    // Reset button
    document.getElementById("settings-reset")!.addEventListener("click", () => {
      audioService.playSfx("click");
      if (confirm("Reset all settings to defaults?")) {
        settingsService.resetToDefaults();
        this.refresh();
      }
    });

    // Close on backdrop click
    this.container.querySelector(".settings-backdrop")!.addEventListener("click", () => {
      this.hide();
    });

  }

  /**
   * Refresh UI with current settings
   */
  private refresh(): void {
    this.settings = settingsService.getSettings();

    // Update all controls
    (document.getElementById("master-volume") as HTMLInputElement).value =
      String(this.settings.audio.masterVolume * 100);
    document.getElementById("master-volume-value")!.textContent =
      `${Math.round(this.settings.audio.masterVolume * 100)}%`;

    (document.getElementById("sfx-volume") as HTMLInputElement).value =
      String(this.settings.audio.sfxVolume * 100);
    document.getElementById("sfx-volume-value")!.textContent =
      `${Math.round(this.settings.audio.sfxVolume * 100)}%`;

    (document.getElementById("music-volume") as HTMLInputElement).value =
      String(this.settings.audio.musicVolume * 100);
    document.getElementById("music-volume-value")!.textContent =
      `${Math.round(this.settings.audio.musicVolume * 100)}%`;

    (document.getElementById("sfx-enabled") as HTMLInputElement).checked =
      this.settings.audio.sfxEnabled;
    (document.getElementById("music-enabled") as HTMLInputElement).checked =
      this.settings.audio.musicEnabled;

    (document.getElementById("graphics-quality") as HTMLSelectElement).value =
      this.settings.display.graphicsQuality;
    (document.getElementById("shadows-enabled") as HTMLInputElement).checked =
      this.settings.display.shadowsEnabled;
    (document.getElementById("table-contrast") as HTMLSelectElement).value =
      this.settings.display.visual.tableContrast;
    (document.getElementById("reduce-chaos-camera-effects") as HTMLInputElement).checked =
      this.settings.controls.reduceChaosCameraEffects;
    (document.getElementById("allow-control-inversion") as HTMLInputElement).checked =
      this.settings.controls.allowChaosControlInversion;

    // Update game variants
    (document.getElementById("variant-d20") as HTMLInputElement).checked =
      this.settings.game.addD20;
    (document.getElementById("variant-d4") as HTMLInputElement).checked =
      this.settings.game.addD4;
    (document.getElementById("variant-2nd-d10") as HTMLInputElement).checked =
      this.settings.game.add2ndD10;
    (document.getElementById("variant-d100") as HTMLInputElement).checked =
      this.settings.game.d100Mode;

    // Update difficulty
    (document.getElementById("game-difficulty") as HTMLSelectElement).value =
      this.settings.game.difficulty;
    this.updateDifficultyInfo();
  }

  /**
   * Update difficulty description
   */
  private updateDifficultyInfo(): void {
    const infoText = document.getElementById("difficulty-info-text");
    if (!infoText) return;

    const difficulty = (document.getElementById("game-difficulty") as HTMLSelectElement).value as GameDifficulty;

    const descriptions = {
      easy: "✨ Shows hints highlighting best scoring choices. Future updates will add undo/redo options.",
      normal: "🎲 Standard BISCUITS rules. No hints or special assistance.",
      hard: "🔥 Coming soon: Stricter rules and no hints. For experienced players only."
    };

    infoText.textContent = descriptions[difficulty];
  }

  /**
   * Show settings modal
   */
  show(): void {
    this.container.style.display = "flex";
  }

  /**
   * Hide settings modal
   */
  hide(): void {
    this.container.style.display = "none";

    // Notify listeners that modal was closed
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * Check if settings modal is visible
   */
  isVisible(): boolean {
    return this.container.style.display === "flex";
  }

  /**
   * Set callback for when modal is closed
   */
  setOnClose(callback: () => void): void {
    this.onClose = callback;
  }

  /**
   * Set callback for when new game is requested
   */
  setOnNewGame(callback: () => void): void {
    this.onNewGame = callback;
  }

  /**
   * Set callback for when How to Play is clicked
   */
  setOnHowToPlay(callback: () => void): void {
    this.onHowToPlay = callback;
  }

  /**
   * Set callback to check if game is in progress
   */
  setCheckGameInProgress(callback: () => boolean): void {
    this.checkGameInProgress = callback;
  }
}
