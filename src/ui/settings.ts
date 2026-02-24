/**
 * Settings Modal
 * UI for adjusting game settings
 */

import { settingsService, Settings } from "../services/settings.js";
import { audioService } from "../services/audio.js";

export class SettingsModal {
  private container: HTMLElement;
  private settings: Settings;
  private onClose: (() => void) | null = null;
  private onNewGame: (() => void) | null = null;
  private onHowToPlay: (() => void) | null = null;

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
          <h3>Game Variants</h3>
          <p class="setting-description">These variants will apply to new games only</p>

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
    this.setupEventListeners();
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

    // Game Variants
    const variantD20 = document.getElementById("variant-d20") as HTMLInputElement;
    variantD20.addEventListener("change", () => {
      settingsService.updateGame({ addD20: variantD20.checked });
      audioService.playSfx("click");
    });

    const variantD4 = document.getElementById("variant-d4") as HTMLInputElement;
    variantD4.addEventListener("change", () => {
      settingsService.updateGame({ addD4: variantD4.checked });
      audioService.playSfx("click");
    });

    const variant2ndD10 = document.getElementById("variant-2nd-d10") as HTMLInputElement;
    variant2ndD10.addEventListener("change", () => {
      settingsService.updateGame({ add2ndD10: variant2ndD10.checked });
      audioService.playSfx("click");
      // If d100 mode is enabled but 2nd d10 is now disabled, disable d100 mode
      if (!variant2ndD10.checked && this.settings.game.d100Mode) {
        settingsService.updateGame({ d100Mode: false });
        (document.getElementById("variant-d100") as HTMLInputElement).checked = false;
      }
    });

    const variantD100 = document.getElementById("variant-d100") as HTMLInputElement;
    variantD100.addEventListener("change", () => {
      // d100 mode requires 2nd d10
      if (variantD100.checked && !this.settings.game.add2ndD10) {
        settingsService.updateGame({ add2ndD10: true });
        (document.getElementById("variant-2nd-d10") as HTMLInputElement).checked = true;
      }
      settingsService.updateGame({ d100Mode: variantD100.checked });
      audioService.playSfx("click");
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

    // Update game variants
    (document.getElementById("variant-d20") as HTMLInputElement).checked =
      this.settings.game.addD20;
    (document.getElementById("variant-d4") as HTMLInputElement).checked =
      this.settings.game.addD4;
    (document.getElementById("variant-2nd-d10") as HTMLInputElement).checked =
      this.settings.game.add2ndD10;
    (document.getElementById("variant-d100") as HTMLInputElement).checked =
      this.settings.game.d100Mode;
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
}
