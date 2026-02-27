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
import { environment } from "@env";
import { firebaseAuthService } from "../services/firebaseAuth.js";
import {
  leaderboardService,
  type LeaderboardSyncStatus,
} from "../services/leaderboard.js";
import {
  playerDataSyncService,
  type PlayerDataSyncStatus,
} from "../services/playerDataSync.js";
import { scoreHistoryService } from "../services/score-history.js";
import type { AuthenticatedUserProfile } from "../services/backendApi.js";
import {
  adminApiService,
  type AdminAuditEntry,
  type AdminStorageDiagnostics,
  type AdminStorageSectionSummary,
  type AdminMonitorOverview,
  type AdminRoleRecord,
  type AdminUserRole,
} from "../services/adminApi.js";
import { getLocale, setLocale, t, type LocaleCode } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import { confirmAction } from "./confirmModal.js";
import { modalManager } from "./modalManager.js";

const log = logger.create("SettingsModal");
const ADMIN_MONITOR_REFRESH_MS = 5000;

type SettingsTab = "game" | "graphics" | "audio" | "account";
type SyncIndicatorTone = "ok" | "syncing" | "pending" | "offline" | "error";

export class SettingsModal {
  private container: HTMLElement;
  private adminModalContainer: HTMLElement;
  private adminModalBody: HTMLElement | null = null;
  private settings: Settings;
  private themeSwitcher: ThemeSwitcher;
  private onClose: (() => void) | null = null;
  private onNewGame: (() => void) | null = null;
  private onHowToPlay: (() => void) | null = null;
  private onReturnToLobby: (() => void) | null = null;
  private checkGameInProgress: (() => boolean) | null = null;
  private activeTab: SettingsTab = "game";
  private savingLeaderboardName = false;
  private savingAdminRole = false;
  private savingAdminMutation = false;
  private accountRenderVersion = 0;
  private adminModalRenderVersion = 0;
  private adminMonitorRefreshHandle?: ReturnType<typeof setInterval>;
  private adminModalRefreshHandle?: ReturnType<typeof setInterval>;
  private readonly onFirebaseAuthChanged = () => {
    leaderboardService.clearCachedProfile();
    void this.refreshAccountSection();
    if (this.isAdminModalVisible()) {
      void this.refreshAdminMonitorPanel();
    }
  };
  private readonly onDataSyncStatusChanged = () => {
    this.updateAccountSyncIndicator();
  };
  private readonly onLeaderboardSyncStatusChanged = () => {
    this.updateAccountSyncIndicator();
  };

  constructor() {
    this.settings = settingsService.getSettings();

    // Create modal
    this.container = document.createElement("div");
    this.container.id = "settings-modal";
    this.container.innerHTML = `
      <div class="settings-backdrop"></div>
      <div class="settings-content">
        <h2>${t("settings.title")}</h2>

        <div class="settings-tabs" role="tablist" aria-label="${t("settings.tabs.aria")}">
          <button class="settings-tab-btn active" type="button" data-tab="game">${t("settings.tabs.game")}</button>
          <button class="settings-tab-btn" type="button" data-tab="graphics">${t("settings.tabs.graphics")}</button>
          <button class="settings-tab-btn" type="button" data-tab="audio">${t("settings.tabs.audio")}</button>
          <button class="settings-tab-btn" type="button" data-tab="account">${t("settings.tabs.account")}</button>
        </div>

        <div class="settings-tab-panel is-active" data-tab-panel="game">
          <div class="settings-section">
            <h3>${t("settings.section.accessibility.title")}</h3>
            <p class="setting-description">${t("settings.section.accessibility.description")}</p>

            <div class="setting-row">
              <label>
                <input
                  type="checkbox"
                  id="reduce-chaos-camera-effects"
                  ${this.settings.controls.reduceChaosCameraEffects ? "checked" : ""}
                >
                ${t("settings.controls.reduceChaos")}
              </label>
            </div>

            <div class="setting-row">
              <label>
                <input
                  type="checkbox"
                  id="allow-control-inversion"
                  ${this.settings.controls.allowChaosControlInversion ? "checked" : ""}
                >
                ${t("settings.controls.allowControlInversion")}
              </label>
            </div>

            <div class="setting-row">
              <label for="mobile-dice-layout">${t("settings.controls.mobileDiceLayout.label")}</label>
              <select id="mobile-dice-layout">
                <option value="wrapped" ${this.settings.controls.mobileDiceLayout === "wrapped" ? "selected" : ""}>${t("settings.controls.mobileDiceLayout.wrapped")}</option>
                <option value="single-row" ${this.settings.controls.mobileDiceLayout === "single-row" ? "selected" : ""}>${t("settings.controls.mobileDiceLayout.singleRow")}</option>
                <option value="perimeter" ${this.settings.controls.mobileDiceLayout === "perimeter" ? "selected" : ""}>${t("settings.controls.mobileDiceLayout.perimeter")}</option>
              </select>
            </div>
          </div>

          <div class="settings-section">
            <h3>${t("settings.section.gameMode.title")}</h3>
            <p class="setting-description">${t("settings.section.gameMode.description")}</p>

            <div class="setting-row">
              <label for="game-language">${t("settings.controls.language.label")}</label>
              <select id="game-language" class="language-select">
                <option value="en-US" ${getLocale() === "en-US" ? "selected" : ""}>${this.getLocaleOptionLabel("en-US")}</option>
                <option value="es-ES" ${getLocale() === "es-ES" ? "selected" : ""}>${this.getLocaleOptionLabel("es-ES")}</option>
              </select>
            </div>

            <div class="setting-row">
              <label for="game-difficulty">${t("settings.controls.difficulty.label")}</label>
              <select id="game-difficulty">
                <option value="easy" ${this.settings.game.difficulty === "easy" ? "selected" : ""}>${t("settings.controls.difficulty.easy")}</option>
                <option value="normal" ${this.settings.game.difficulty === "normal" ? "selected" : ""}>${t("settings.controls.difficulty.normal")}</option>
                <option value="hard" ${this.settings.game.difficulty === "hard" ? "selected" : ""}>${t("settings.controls.difficulty.hard")}</option>
              </select>
            </div>

            <div class="setting-row difficulty-info">
              <p id="difficulty-info-text" class="setting-description"></p>
            </div>

            <div class="setting-row">
              <label>
                <input
                  type="checkbox"
                  id="camera-assist-enabled"
                  ${this.settings.game.difficulty === "easy" && this.settings.game.cameraAssistEnabled ? "checked" : ""}
                  ${this.settings.game.difficulty === "easy" ? "" : "disabled"}
                >
                ${t("settings.controls.cameraAssist")}
              </label>
            </div>

            <div class="setting-row difficulty-info">
              <p id="camera-assist-info-text" class="setting-description"></p>
            </div>
          </div>

          <div class="settings-section">
            <h3>${t("settings.section.gameVariants.title")}</h3>
            <p class="setting-description">${t("settings.section.gameVariants.description")}</p>

            <div class="setting-row">
              <label>
                <input type="checkbox" id="variant-d20" ${this.settings.game.addD20 ? "checked" : ""}>
                ${t("settings.controls.variant.addD20")}
              </label>
            </div>

            <div class="setting-row">
              <label>
                <input type="checkbox" id="variant-d4" ${this.settings.game.addD4 ? "checked" : ""}>
                ${t("settings.controls.variant.addD4")}
              </label>
            </div>

            <div class="setting-row">
              <label>
                <input type="checkbox" id="variant-2nd-d10" ${this.settings.game.add2ndD10 ? "checked" : ""}>
                ${t("settings.controls.variant.add2ndD10")}
              </label>
            </div>

            <div class="setting-row">
              <label>
                <input type="checkbox" id="variant-d100" ${this.settings.game.d100Mode ? "checked" : ""}>
                ${t("settings.controls.variant.d100")}
              </label>
            </div>
          </div>
        </div>

        <div class="settings-tab-panel" data-tab-panel="graphics">
          <div class="settings-section">
            <h3>${t("settings.section.display.title")}</h3>

            <div class="setting-row">
              <label for="graphics-quality">${t("settings.controls.graphicsQuality.label")}</label>
              <select id="graphics-quality">
                <option value="low" ${this.settings.display.graphicsQuality === "low" ? "selected" : ""}>${t("settings.controls.graphicsQuality.low")}</option>
                <option value="medium" ${this.settings.display.graphicsQuality === "medium" ? "selected" : ""}>${t("settings.controls.graphicsQuality.medium")}</option>
                <option value="high" ${this.settings.display.graphicsQuality === "high" ? "selected" : ""}>${t("settings.controls.graphicsQuality.high")}</option>
              </select>
            </div>

            <div class="setting-row">
              <label>
                <input type="checkbox" id="shadows-enabled" ${this.settings.display.shadowsEnabled ? "checked" : ""}>
                ${t("settings.controls.shadowsEnabled")}
              </label>
            </div>
          </div>

          <div class="settings-section">
            <h3>${t("settings.section.visual.title")}</h3>
            <p class="setting-description">${t("settings.section.visual.description")}</p>

            <div class="setting-row">
              <label for="table-contrast">${t("settings.controls.tableContrast.label")}</label>
              <select id="table-contrast">
                <option value="low" ${this.settings.display.visual.tableContrast === "low" ? "selected" : ""}>${t("settings.controls.tableContrast.low")}</option>
                <option value="normal" ${this.settings.display.visual.tableContrast === "normal" ? "selected" : ""}>${t("settings.controls.tableContrast.normal")}</option>
                <option value="high" ${this.settings.display.visual.tableContrast === "high" ? "selected" : ""}>${t("settings.controls.tableContrast.high")}</option>
                <option value="maximum" ${this.settings.display.visual.tableContrast === "maximum" ? "selected" : ""}>${t("settings.controls.tableContrast.maximum")}</option>
              </select>
            </div>
          </div>

          <div class="settings-section" id="theme-switcher-container"></div>
        </div>

        <div class="settings-tab-panel" data-tab-panel="audio">
          <div class="settings-section">
            <h3>${t("settings.section.audio.title")}</h3>

            <div class="setting-row">
              <label for="master-volume">${t("settings.controls.masterVolume")}</label>
              <input type="range" id="master-volume" min="0" max="100" value="${this.settings.audio.masterVolume * 100}">
              <span id="master-volume-value">${Math.round(this.settings.audio.masterVolume * 100)}%</span>
            </div>

            <div class="setting-row" id="audio-sfx-volume-row">
              <label for="sfx-volume">${t("settings.controls.soundEffects")}</label>
              <input type="range" id="sfx-volume" min="0" max="100" value="${this.settings.audio.sfxVolume * 100}">
              <span id="sfx-volume-value">${Math.round(this.settings.audio.sfxVolume * 100)}%</span>
            </div>

            <div class="setting-row" id="audio-music-volume-row">
              <label for="music-volume">${t("settings.controls.music")}</label>
              <input type="range" id="music-volume" min="0" max="100" value="${this.settings.audio.musicVolume * 100}">
              <span id="music-volume-value">${Math.round(this.settings.audio.musicVolume * 100)}%</span>
            </div>

            <div class="setting-row" id="audio-sfx-toggle-row">
              <label>
                <input type="checkbox" id="sfx-enabled" ${this.settings.audio.sfxEnabled ? "checked" : ""}>
                ${t("settings.controls.enableSoundEffects")}
              </label>
            </div>

            <div class="setting-row" id="audio-music-toggle-row">
              <label>
                <input type="checkbox" id="music-enabled" ${this.settings.audio.musicEnabled ? "checked" : ""}>
                ${t("settings.controls.enableMusic")}
              </label>
            </div>

            <div class="setting-row" ${hapticsService.isSupported() ? "" : 'style="display:none;"'}>
              <label>
                <input type="checkbox" id="haptics-enabled" ${this.settings.haptics !== false ? "checked" : ""}>
                ${t("settings.controls.enableHaptics")}
              </label>
            </div>
          </div>
        </div>

        <div class="settings-tab-panel" data-tab-panel="account">
          <div class="settings-section">
            <h3>${t("settings.section.account.title")}</h3>
            <p class="setting-description">
              ${t("settings.section.account.description")}
            </p>
            <div id="settings-account-panel" class="settings-account-panel">
              <p class="settings-account-loading">${t("settings.account.loading")}</p>
            </div>
          </div>
        </div>

        <div class="settings-buttons">
          <button id="settings-return-lobby" class="btn btn-secondary">${t("settings.buttons.mainMenu")}</button>
          <button id="settings-how-to-play" class="btn btn-outline">${t("settings.buttons.howToPlay")}</button>
          <button id="settings-close" class="btn btn-primary primary">${t("settings.buttons.close")}</button>
          <button id="settings-new-game" class="btn btn-danger danger">${t("settings.buttons.newGame")}</button>
          <button id="settings-reset" class="btn btn-secondary">${t("settings.buttons.resetDefaults")}</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    this.adminModalContainer = this.createAdminModal();
    modalManager.register({
      id: "settings-modal",
      close: () => this.hide(),
      canStackWith: ["tutorial-modal", "settings-admin-modal"],
      allowStackOnMobile: true,
    });

    // Create and add theme switcher
    this.themeSwitcher = new ThemeSwitcher();
    const themeSwitcherContainer = this.container.querySelector("#theme-switcher-container");
    if (themeSwitcherContainer) {
      themeSwitcherContainer.appendChild(this.themeSwitcher.getElement());
    }

    this.setupEventListeners();
    this.updateDifficultyInfo();
    void this.refreshAccountSection();
  }

  /**
   * Setup event listeners for all settings controls
   */
  private setupEventListeners(): void {
    this.setupTabSwitching();

    // Master volume
    const masterVolume = document.getElementById("master-volume") as HTMLInputElement;
    const masterValue = document.getElementById("master-volume-value") as HTMLElement;
    masterVolume.addEventListener("input", () => {
      const value = parseInt(masterVolume.value) / 100;
      masterValue.textContent = `${masterVolume.value}%`;
      settingsService.updateAudio({ masterVolume: value });
      audioService.playSfx("click");
    });

    // SFX volume
    const sfxVolume = document.getElementById("sfx-volume") as HTMLInputElement;
    const sfxValue = document.getElementById("sfx-volume-value") as HTMLElement;
    sfxVolume.addEventListener("input", () => {
      const value = parseInt(sfxVolume.value) / 100;
      sfxValue.textContent = `${sfxVolume.value}%`;
      settingsService.updateAudio({ sfxVolume: value });
      audioService.playSfx("click");
    });

    // Music volume
    const musicVolume = document.getElementById("music-volume") as HTMLInputElement;
    const musicValue = document.getElementById("music-volume-value") as HTMLElement;
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
        graphicsQuality: graphicsQuality.value as "low" | "medium" | "high",
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
        low: t("settings.controls.tableContrast.low"),
        normal: t("settings.controls.tableContrast.normal"),
        high: t("settings.controls.tableContrast.high"),
        maximum: t("settings.controls.tableContrast.maximum"),
      };
      notificationService.show(
        t("settings.notification.tableContrast", { value: labels[value] }),
        "info",
        2000
      );

      // Briefly hide settings modal so user can see the table change
      this.container.style.opacity = "0";
      this.container.style.pointerEvents = "none";
      setTimeout(() => {
        this.container.style.opacity = "1";
        this.container.style.pointerEvents = "auto";
      }, 800);

      audioService.playSfx("click");
    });

    // Chaos accessibility safeguards
    const reduceChaosEffects = document.getElementById(
      "reduce-chaos-camera-effects"
    ) as HTMLInputElement;
    reduceChaosEffects.addEventListener("change", () => {
      settingsService.updateControls({ reduceChaosCameraEffects: reduceChaosEffects.checked });
      notificationService.show(
        reduceChaosEffects.checked
          ? t("settings.notification.chaosEffectsReduced")
          : t("settings.notification.chaosEffectsRestored"),
        "info",
        2000
      );
      audioService.playSfx("click");
    });

    const allowControlInversion = document.getElementById(
      "allow-control-inversion"
    ) as HTMLInputElement;
    allowControlInversion.addEventListener("change", () => {
      settingsService.updateControls({
        allowChaosControlInversion: allowControlInversion.checked,
      });
      notificationService.show(
        allowControlInversion.checked
          ? t("settings.notification.controlInversionEnabled")
          : t("settings.notification.controlInversionBlocked"),
        "info",
        2200
      );
      audioService.playSfx("click");
    });

    const mobileDiceLayout = document.getElementById("mobile-dice-layout") as HTMLSelectElement;
    mobileDiceLayout.addEventListener("change", () => {
      settingsService.updateControls({
        mobileDiceLayout: mobileDiceLayout.value as "wrapped" | "single-row" | "perimeter",
      });
      audioService.playSfx("click");
    });

    const gameLanguage = document.getElementById("game-language") as HTMLSelectElement;
    gameLanguage.addEventListener("change", () => {
      const nextLocale = gameLanguage.value as LocaleCode;
      setLocale(nextLocale);
      this.updateDifficultyInfo();
      notificationService.show(
        t("settings.notification.language.changed", {
          locale: this.getLocaleLabel(nextLocale),
        }),
        "info",
        2000
      );
      audioService.playSfx("click");
    });

    const cameraAssistEnabled = document.getElementById("camera-assist-enabled") as HTMLInputElement;
    cameraAssistEnabled.addEventListener("change", () => {
      const difficulty = (document.getElementById("game-difficulty") as HTMLSelectElement)
        .value as GameDifficulty;
      if (difficulty !== "easy") {
        this.updateCameraAssistControlState(difficulty);
        return;
      }

      settingsService.updateGame({
        cameraAssistEnabled: cameraAssistEnabled.checked,
      });
      notificationService.show(
        cameraAssistEnabled.checked
          ? t("settings.notification.cameraAssist.enabled")
          : t("settings.notification.cameraAssist.disabled"),
        "info",
        1800
      );
      audioService.playSfx("click");
    });

    // Game Difficulty
    const gameDifficulty = document.getElementById("game-difficulty") as HTMLSelectElement;
    gameDifficulty.addEventListener("change", async () => {
      if (this.isGameInProgress()) {
        const confirmed = await confirmAction({
          title: t("settings.confirm.startNewGame.title"),
          message: t("settings.confirm.startNewGame.message"),
          confirmLabel: t("settings.confirm.startNewGame.confirm"),
          cancelLabel: t("settings.confirm.startNewGame.cancel"),
          tone: "danger",
        });
        if (!confirmed) {
          gameDifficulty.value = this.settings.game.difficulty;
          return;
        }
      }

      settingsService.updateGame({
        difficulty: gameDifficulty.value as GameDifficulty,
      });
      this.updateDifficultyInfo();
      audioService.playSfx("click");

      if (this.isGameInProgress()) {
        this.hide();
        if (this.onNewGame) {
          this.onNewGame();
        }
      }
    });

    // Game Variants
    const variantD20 = document.getElementById("variant-d20") as HTMLInputElement;
    variantD20.addEventListener("change", async () => {
      if (this.isGameInProgress()) {
        const confirmed = await confirmAction({
          title: t("settings.confirm.startNewGame.title"),
          message: t("settings.confirm.startNewGame.variantsMessage"),
          confirmLabel: t("settings.confirm.startNewGame.confirm"),
          cancelLabel: t("settings.confirm.startNewGame.cancel"),
          tone: "danger",
        });
        if (!confirmed) {
          variantD20.checked = this.settings.game.addD20;
          return;
        }
      }
      settingsService.updateGame({ addD20: variantD20.checked });
      audioService.playSfx("click");
      if (this.isGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    const variantD4 = document.getElementById("variant-d4") as HTMLInputElement;
    variantD4.addEventListener("change", async () => {
      if (this.isGameInProgress()) {
        const confirmed = await confirmAction({
          title: t("settings.confirm.startNewGame.title"),
          message: t("settings.confirm.startNewGame.variantsMessage"),
          confirmLabel: t("settings.confirm.startNewGame.confirm"),
          cancelLabel: t("settings.confirm.startNewGame.cancel"),
          tone: "danger",
        });
        if (!confirmed) {
          variantD4.checked = this.settings.game.addD4;
          return;
        }
      }
      settingsService.updateGame({ addD4: variantD4.checked });
      audioService.playSfx("click");
      if (this.isGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    const variant2ndD10 = document.getElementById("variant-2nd-d10") as HTMLInputElement;
    variant2ndD10.addEventListener("change", async () => {
      if (this.isGameInProgress()) {
        const confirmed = await confirmAction({
          title: t("settings.confirm.startNewGame.title"),
          message: t("settings.confirm.startNewGame.variantsMessage"),
          confirmLabel: t("settings.confirm.startNewGame.confirm"),
          cancelLabel: t("settings.confirm.startNewGame.cancel"),
          tone: "danger",
        });
        if (!confirmed) {
          variant2ndD10.checked = this.settings.game.add2ndD10;
          return;
        }
      }
      settingsService.updateGame({ add2ndD10: variant2ndD10.checked });
      audioService.playSfx("click");
      if (!variant2ndD10.checked && this.settings.game.d100Mode) {
        settingsService.updateGame({ d100Mode: false });
        (document.getElementById("variant-d100") as HTMLInputElement).checked = false;
      }
      if (this.isGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    const variantD100 = document.getElementById("variant-d100") as HTMLInputElement;
    variantD100.addEventListener("change", async () => {
      if (this.isGameInProgress()) {
        const confirmed = await confirmAction({
          title: t("settings.confirm.startNewGame.title"),
          message: t("settings.confirm.startNewGame.variantsMessage"),
          confirmLabel: t("settings.confirm.startNewGame.confirm"),
          cancelLabel: t("settings.confirm.startNewGame.cancel"),
          tone: "danger",
        });
        if (!confirmed) {
          variantD100.checked = this.settings.game.d100Mode;
          return;
        }
      }
      if (variantD100.checked && !this.settings.game.add2ndD10) {
        settingsService.updateGame({ add2ndD10: true });
        (document.getElementById("variant-2nd-d10") as HTMLInputElement).checked = true;
      }
      settingsService.updateGame({ d100Mode: variantD100.checked });
      audioService.playSfx("click");
      if (this.isGameInProgress() && this.onNewGame) {
        this.hide();
        this.onNewGame();
      }
    });

    // How to Play button
    document.getElementById("settings-how-to-play")?.addEventListener("click", () => {
      audioService.playSfx("click");
      if (this.onHowToPlay) {
        this.onHowToPlay();
      }
    });

    // Main Menu button
    document.getElementById("settings-return-lobby")?.addEventListener("click", async () => {
      audioService.playSfx("click");
      const confirmed = await confirmAction({
        title: t("settings.confirm.returnLobby.title"),
        message: t("settings.confirm.returnLobby.message"),
        confirmLabel: t("settings.confirm.returnLobby.confirm"),
        cancelLabel: t("settings.confirm.returnLobby.cancel"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      this.hide();
      if (this.onReturnToLobby) {
        this.onReturnToLobby();
      }
    });

    // Close button
    document.getElementById("settings-close")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
    });

    // New Game button
    document.getElementById("settings-new-game")?.addEventListener("click", async () => {
      audioService.playSfx("click");
      const confirmed = await confirmAction({
        title: t("settings.confirm.newGameButton.title"),
        message: t("settings.confirm.newGameButton.message"),
        confirmLabel: t("settings.confirm.newGameButton.confirm"),
        cancelLabel: t("settings.confirm.newGameButton.cancel"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      this.hide();
      if (this.onNewGame) {
        this.onNewGame();
      }
    });

    // Reset button
    document.getElementById("settings-reset")?.addEventListener("click", async () => {
      audioService.playSfx("click");
      const confirmed = await confirmAction({
        title: t("settings.confirm.reset.title"),
        message: t("settings.confirm.reset.message"),
        confirmLabel: t("settings.confirm.reset.confirm"),
        cancelLabel: t("settings.confirm.reset.cancel"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      settingsService.resetToDefaults();
      this.refresh();
    });

    // Close on backdrop click
    this.container.querySelector(".settings-backdrop")?.addEventListener("click", () => {
      this.hide();
    });

    document.addEventListener("auth:firebaseUserChanged", this.onFirebaseAuthChanged as EventListener);
    document.addEventListener(
      "sync:playerDataStatusChanged",
      this.onDataSyncStatusChanged as EventListener
    );
    document.addEventListener(
      "sync:leaderboardStatusChanged",
      this.onLeaderboardSyncStatusChanged as EventListener
    );
  }

  private setupTabSwitching(): void {
    this.container.querySelectorAll<HTMLElement>(".settings-tab-btn").forEach((button) => {
      button.addEventListener("click", () => {
        audioService.playSfx("click");
        const targetTab = button.dataset.tab as SettingsTab | undefined;
        if (!targetTab) {
          return;
        }
        this.switchTab(targetTab);
      });
    });
  }

  private switchTab(tab: SettingsTab): void {
    this.activeTab = tab;
    this.container.querySelectorAll<HTMLElement>(".settings-tab-btn").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
    this.container.querySelectorAll<HTMLElement>(".settings-tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.tabPanel === tab);
    });

    if (tab === "account") {
      this.startAdminMonitorRefresh();
      void this.refreshAccountSection();
      return;
    }
    this.stopAdminMonitorRefresh();
  }

  /**
   * Programmatically switch to a specific settings tab.
   */
  showTab(tab: "game" | "graphics" | "audio" | "account"): void {
    this.switchTab(tab);
  }

  private async refreshAccountSection(): Promise<void> {
    const panel = this.container.querySelector("#settings-account-panel") as HTMLElement | null;
    if (!panel) return;

    const renderVersion = ++this.accountRenderVersion;
    panel.innerHTML = `<p class="settings-account-loading">${t("settings.account.loading")}</p>`;

    try {
      await firebaseAuthService.initialize();

      const firebaseProfile = firebaseAuthService.getCurrentUserProfile();
      const authConfigured = firebaseAuthService.isConfigured();
      const isAuthenticated = Boolean(firebaseProfile && !firebaseProfile.isAnonymous);
      let accountProfile: AuthenticatedUserProfile | null = null;

      if (isAuthenticated) {
        accountProfile = await leaderboardService.getAccountProfile(true);
      }

      if (renderVersion !== this.accountRenderVersion) {
        return;
      }

      const stats = scoreHistoryService.getStats();
      const displayName =
        accountProfile?.displayName?.trim() ||
        firebaseProfile?.displayName?.trim() ||
        accountProfile?.leaderboardName?.trim() ||
        t("settings.account.guestPlayer");
      const email = accountProfile?.email?.trim() || firebaseProfile?.email?.trim() || "";
      const provider = accountProfile?.provider?.trim() || (isAuthenticated ? "google" : "guest");
      const providerId = accountProfile?.providerId?.trim() || firebaseProfile?.providerId?.trim() || "";
      const providerLabel = providerId ? `${provider} (${providerId})` : provider;
      const photoUrl = accountProfile?.photoUrl?.trim() || firebaseProfile?.photoURL?.trim() || "";
      const leaderboardName = accountProfile?.leaderboardName?.trim() ?? "";
      const accountAdminRole = this.normalizeAdminRoleValue(accountProfile?.admin?.role);
      const authLabel = authConfigured
        ? isAuthenticated
          ? t("settings.account.auth.signedIn")
          : t("settings.account.auth.guestMode")
        : t("settings.account.auth.notConfigured");
      const syncIndicator = this.getSyncIndicatorState();
      const adminConsoleMarkup = this.isAdminMonitorEnabled()
        ? `
          <div class="settings-account-admin-launch">
            <div class="settings-account-admin-launch-info">
              <strong>${t("settings.admin.console.title")}</strong>
              <span>${t("settings.admin.launch.description")}</span>
            </div>
            <button type="button" class="btn btn-secondary settings-account-btn" data-action="settings-open-admin-console">
              ${t("settings.admin.launch.button")}
            </button>
          </div>
        `
        : "";

      panel.innerHTML = `
        <div class="settings-account-header">
          <div class="settings-account-summary">
            <div class="settings-account-avatar">
              ${
                photoUrl
                  ? `<img class="settings-account-avatar-image" src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(
                      t("settings.account.avatar.alt", { name: displayName })
                    )}" referrerpolicy="no-referrer" />`
                  : `<span>${escapeHtml(this.getAvatarInitial(displayName))}</span>`
              }
            </div>
            <div>
              <div class="settings-account-name">${escapeHtml(displayName)}</div>
              <div class="settings-account-badge">${escapeHtml(authLabel)}</div>
              ${email ? `<div class="settings-account-email">${escapeHtml(email)}</div>` : ""}
              <div class="settings-account-provider">${escapeHtml(
                t("settings.account.provider", { provider: providerLabel })
              )}</div>
              ${
                this.isAdminMonitorEnabled()
                  ? `<div class="settings-account-provider">${escapeHtml(
                      t("settings.account.adminRole", {
                        role: accountAdminRole ?? t("settings.account.none"),
                      })
                    )}</div>`
                  : ""
              }
              <div
                id="settings-sync-indicator"
                class="sync-indicator sync-indicator--${syncIndicator.tone}"
                title="${escapeAttribute(syncIndicator.title)}"
              >
                <span class="sync-indicator-dot" aria-hidden="true"></span>
                <span class="sync-indicator-label">${escapeHtml(syncIndicator.label)}</span>
              </div>
            </div>
          </div>
          <div class="settings-account-actions">
            ${
              authConfigured && !isAuthenticated
                ? `<button type="button" class="btn btn-primary settings-account-btn" data-action="settings-signin">${t(
                    "settings.account.action.signIn"
                  )}</button>`
                : ""
            }
            ${
              isAuthenticated
                ? `<button type="button" class="btn btn-danger settings-account-btn" data-action="settings-signout">${t(
                    "settings.account.action.signOut"
                  )}</button>`
                : ""
            }
            <button type="button" class="btn btn-secondary settings-account-btn" data-action="settings-refresh">${t(
              "settings.account.action.refresh"
            )}</button>
          </div>
        </div>

        ${
          isAuthenticated
            ? `<div class="settings-account-name-row">
                <label for="settings-leaderboard-name">${t("settings.account.leaderboardName.label")}</label>
                <div class="settings-account-name-inputs">
                  <input
                    id="settings-leaderboard-name"
                    type="text"
                    maxlength="24"
                    placeholder="${escapeAttribute(t("settings.account.leaderboardName.placeholder"))}"
                    value="${escapeAttribute(leaderboardName)}"
                  />
                  <button type="button" class="btn btn-primary settings-account-btn" data-action="settings-save-name">${t(
                    "settings.account.leaderboardName.save"
                  )}</button>
                </div>
              </div>`
            : `<p class="setting-description settings-account-help">
                ${t("settings.account.help.signInForLeaderboard")}
              </p>`
        }

        <div class="settings-account-stats-grid">
          <div class="settings-account-stat">
            <span>${t("settings.account.stats.games")}</span>
            <strong>${stats.totalGames}</strong>
          </div>
          <div class="settings-account-stat">
            <span>${t("settings.account.stats.best")}</span>
            <strong>${stats.totalGames > 0 ? stats.bestScore : "-"}</strong>
          </div>
          <div class="settings-account-stat">
            <span>${t("settings.account.stats.average")}</span>
            <strong>${stats.totalGames > 0 ? stats.averageScore : "-"}</strong>
          </div>
          <div class="settings-account-stat">
            <span>${t("settings.account.stats.playTime")}</span>
            <strong>${this.formatDuration(stats.totalPlayTime)}</strong>
          </div>
        </div>

        ${adminConsoleMarkup}
      `;

      this.bindAccountActions(panel);
    } catch (error) {
      if (renderVersion !== this.accountRenderVersion) {
        return;
      }
      log.warn("Failed to refresh account settings panel", error);
      panel.innerHTML = `
        <p class="settings-account-loading">${t("settings.account.error.loadFailed")}</p>
      `;
    }
  }

  private bindAccountActions(panel: HTMLElement): void {
    panel.querySelector('[data-action="settings-refresh"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      void this.refreshAccountSection();
    });

    panel.querySelector('[data-action="settings-signin"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      void firebaseAuthService.signInWithGoogle().then((ok) => {
        if (ok) {
          leaderboardService.clearCachedProfile();
          void this.refreshAccountSection();
        }
      });
    });

    panel.querySelector('[data-action="settings-signout"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      void firebaseAuthService.signOutCurrentUser().then(() => {
        leaderboardService.clearCachedProfile();
        void this.refreshAccountSection();
      });
    });

    panel.querySelector('[data-action="settings-save-name"]')?.addEventListener("click", () => {
      const input = panel.querySelector("#settings-leaderboard-name") as HTMLInputElement | null;
      const value = input?.value?.trim() ?? "";
      if (!value || this.savingLeaderboardName) {
        return;
      }

      this.savingLeaderboardName = true;
      audioService.playSfx("click");
      void leaderboardService
        .setLeaderboardName(value)
        .then((profile) => {
          if (!profile) {
            return;
          }
          void leaderboardService.flushPendingScores();
        })
        .finally(() => {
          this.savingLeaderboardName = false;
          void this.refreshAccountSection();
        });
    });

    panel
      .querySelector('[data-action="settings-open-admin-console"]')
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        this.showAdminMonitorModal();
      });
  }

  private bindAdminActions(panel: HTMLElement): void {
    panel.querySelector('[data-action="settings-admin-refresh"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      void this.refreshAdminMonitorPanel();
    });

    const adminTokenInput = panel.querySelector("#settings-admin-token") as HTMLInputElement | null;
    const saveAdminToken = () => {
      adminApiService.setAdminToken(adminTokenInput?.value ?? "");
      void this.refreshAdminMonitorPanel();
    };

    panel.querySelector('[data-action="settings-admin-save-token"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      saveAdminToken();
    });

    panel.querySelector('[data-action="settings-admin-clear-token"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      if (adminTokenInput) {
        adminTokenInput.value = "";
      }
      adminApiService.setAdminToken("");
      void this.refreshAdminMonitorPanel();
    });

    adminTokenInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      saveAdminToken();
    });

    panel.querySelectorAll('[data-action="settings-admin-save-role"]').forEach((buttonNode) => {
      const button = buttonNode as HTMLButtonElement;
      button.addEventListener("click", () => {
        if (this.savingAdminRole) {
          return;
        }
        const row = button.closest(".settings-admin-role-row") as HTMLElement | null;
        const targetUid = row?.dataset.adminRoleTarget?.trim() ?? "";
        const select = row?.querySelector(
          "select[data-admin-role-select]"
        ) as HTMLSelectElement | null;
        if (!targetUid || !select) {
          return;
        }
        const nextRole = this.normalizeAdminRoleValue(select.value);
        this.savingAdminRole = true;
        audioService.playSfx("click");
        void firebaseAuthService
          .getIdToken()
          .then((firebaseIdToken) =>
            adminApiService.setRole(targetUid, nextRole, {
              firebaseIdToken,
              adminToken: adminApiService.getAdminToken(),
            })
          )
          .then((result) => {
            if (!result.roleRecord) {
              notificationService.show(
                this.getAdminMonitorFailureMessage(result.reason, result.status),
                "error",
                2400
              );
              return;
            }
            const roleLabel = result.roleRecord.role ?? "none";
            notificationService.show(
              t("settings.admin.notification.roleUpdated", { uid: targetUid, role: roleLabel }),
              "success",
              1800
            );
          })
          .finally(() => {
            this.savingAdminRole = false;
            void this.refreshAdminMonitorPanel();
            void this.refreshAccountSection();
          });
      });
    });

    panel.querySelectorAll('[data-action="settings-admin-expire-room"]').forEach((buttonNode) => {
      const button = buttonNode as HTMLButtonElement;
      button.addEventListener("click", () => {
        if (this.savingAdminMutation) {
          return;
        }
        const sessionId = button.dataset.sessionId?.trim() ?? "";
        if (!sessionId) {
          return;
        }
        this.savingAdminMutation = true;
        audioService.playSfx("click");
        void confirmAction({
          title: t("settings.admin.confirm.expireRoom.title"),
          message: t("settings.admin.confirm.expireRoom.message", { sessionId }),
          confirmLabel: t("settings.admin.confirm.expireRoom.confirm"),
          cancelLabel: t("settings.admin.confirm.cancel"),
          tone: "danger",
        })
          .then((confirmed) => {
            if (!confirmed) {
              return null;
            }
            return this.getAdminRequestAuthOptions().then((authOptions) =>
              adminApiService.expireSession(sessionId, authOptions)
            );
          })
          .then((result) => {
            if (!result) {
              return;
            }
            if (!result.ok) {
              notificationService.show(
                this.getAdminMonitorFailureMessage(result.reason, result.status),
                "error",
                2500
              );
              return;
            }
            notificationService.show(t("settings.admin.notification.roomExpired"), "success", 1800);
          })
          .finally(() => {
            this.savingAdminMutation = false;
            void this.refreshAdminMonitorPanel();
            void this.refreshAccountSection();
          });
      });
    });

    panel.querySelectorAll('[data-action="settings-admin-remove-player"]').forEach((buttonNode) => {
      const button = buttonNode as HTMLButtonElement;
      button.addEventListener("click", () => {
        if (this.savingAdminMutation) {
          return;
        }
        const sessionId = button.dataset.sessionId?.trim() ?? "";
        const card = button.closest(".settings-admin-room-card") as HTMLElement | null;
        const select = card?.querySelector(
          "select[data-admin-remove-player]"
        ) as HTMLSelectElement | null;
        const playerId = select?.value?.trim() ?? "";
        if (!sessionId || !playerId) {
          return;
        }
        this.savingAdminMutation = true;
        audioService.playSfx("click");
        void confirmAction({
          title: t("settings.admin.confirm.removePlayer.title"),
          message: t("settings.admin.confirm.removePlayer.message", { playerId, sessionId }),
          confirmLabel: t("settings.admin.confirm.removePlayer.confirm"),
          cancelLabel: t("settings.admin.confirm.cancel"),
          tone: "danger",
        })
          .then((confirmed) => {
            if (!confirmed) {
              return null;
            }
            return this.getAdminRequestAuthOptions().then((authOptions) =>
              adminApiService.removeParticipant(sessionId, playerId, authOptions)
            );
          })
          .then((result) => {
            if (!result) {
              return;
            }
            if (!result.ok) {
              notificationService.show(
                this.getAdminMonitorFailureMessage(result.reason, result.status),
                "error",
                2500
              );
              return;
            }
            notificationService.show(t("settings.admin.notification.playerRemoved"), "success", 1800);
          })
          .finally(() => {
            this.savingAdminMutation = false;
            void this.refreshAdminMonitorPanel();
            void this.refreshAccountSection();
          });
      });
    });
  }

  private createAdminModal(): HTMLElement {
    const container = document.createElement("div");
    container.id = "settings-admin-modal";
    container.innerHTML = `
      <div class="settings-admin-modal-backdrop"></div>
      <div class="settings-admin-modal-content">
        <div class="settings-admin-modal-header">
          <h2>${t("settings.admin.console.title")}</h2>
          <div class="settings-admin-modal-actions">
            <button type="button" class="btn btn-secondary settings-account-btn" data-action="settings-admin-refresh">
              ${t("settings.admin.action.refresh")}
            </button>
            <button type="button" class="btn btn-primary settings-account-btn" data-action="settings-admin-close">
              ${t("settings.buttons.close")}
            </button>
          </div>
        </div>
        <div id="settings-admin-modal-body" class="settings-admin-modal-body">
          <p class="settings-account-loading">${t("settings.account.loadingAdmin")}</p>
        </div>
      </div>
    `;
    container.style.display = "none";
    document.body.appendChild(container);
    this.adminModalBody = container.querySelector("#settings-admin-modal-body");

    container
      .querySelector(".settings-admin-modal-backdrop")
      ?.addEventListener("click", () => this.hideAdminMonitorModal());
    container
      .querySelector('[data-action="settings-admin-close"]')
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        this.hideAdminMonitorModal();
      });
    container
      .querySelector(".settings-admin-modal-actions [data-action=\"settings-admin-refresh\"]")
      ?.addEventListener("click", () => {
        audioService.playSfx("click");
        void this.refreshAdminMonitorPanel();
      });

    modalManager.register({
      id: "settings-admin-modal",
      close: () => this.hideAdminMonitorModal(),
      canStackWith: ["settings-modal"],
      allowStackOnMobile: true,
    });

    return container;
  }

  private showAdminMonitorModal(): void {
    if (!this.isAdminMonitorEnabled()) {
      return;
    }
    modalManager.requestOpen("settings-admin-modal");
    this.adminModalContainer.style.display = "flex";
    this.startAdminModalRefresh();
    void this.refreshAdminMonitorPanel();
  }

  private hideAdminMonitorModal(): void {
    if (this.adminModalContainer.style.display === "none") {
      return;
    }
    this.adminModalContainer.style.display = "none";
    this.stopAdminModalRefresh();
    modalManager.notifyClosed("settings-admin-modal");
  }

  private isAdminModalVisible(): boolean {
    return this.adminModalContainer.style.display === "flex";
  }

  private startAdminModalRefresh(): void {
    this.stopAdminModalRefresh();
    this.adminModalRefreshHandle = setInterval(() => {
      if (!this.isAdminModalVisible() || this.savingAdminRole || this.savingAdminMutation) {
        return;
      }
      void this.refreshAdminMonitorPanel();
    }, ADMIN_MONITOR_REFRESH_MS);
  }

  private stopAdminModalRefresh(): void {
    if (!this.adminModalRefreshHandle) {
      return;
    }
    clearInterval(this.adminModalRefreshHandle);
    this.adminModalRefreshHandle = undefined;
  }

  private async refreshAdminMonitorPanel(): Promise<void> {
    const panel = this.adminModalBody;
    if (!panel) {
      return;
    }

    const renderVersion = ++this.adminModalRenderVersion;
    panel.innerHTML = `<p class="settings-account-loading">${t("settings.account.loadingAdmin")}</p>`;

    try {
      await firebaseAuthService.initialize();
      const firebaseProfile = firebaseAuthService.getCurrentUserProfile();
      const isAuthenticated = Boolean(firebaseProfile && !firebaseProfile.isAnonymous);
      const accountProfile = isAuthenticated
        ? await leaderboardService.getAccountProfile(true)
        : null;
      if (renderVersion !== this.adminModalRenderVersion) {
        return;
      }

      const firebaseIdToken = isAuthenticated ? (await firebaseAuthService.getIdToken()) ?? "" : "";
      const adminToken = adminApiService.getAdminToken();
      const adminAuthOptions = {
        firebaseIdToken,
        adminToken,
      };
      const canRequestAdmin = Boolean(firebaseIdToken || adminToken);
      const adminResult = canRequestAdmin
        ? await adminApiService.getOverview(18, adminAuthOptions)
        : {
            overview: null,
            reason: "missing_admin_auth",
            status: 401,
          };
      if (renderVersion !== this.adminModalRenderVersion) {
        return;
      }

      const profileRole = this.normalizeAdminRoleValue(accountProfile?.admin?.role);
      const resolvedRole = this.normalizeAdminRoleValue(
        profileRole ?? adminResult.overview?.principal?.role
      );
      let roleRecords: AdminRoleRecord[] | null = null;
      let roleReason: string | undefined;
      let roleStatus: number | undefined;
      let auditEntries: AdminAuditEntry[] | null = null;
      let auditReason: string | undefined;
      let auditStatus: number | undefined;
      let storage: AdminStorageDiagnostics | null = null;
      let storageSections: AdminStorageSectionSummary[] | null = null;
      let storageReason: string | undefined;
      let storageStatus: number | undefined;
      if (resolvedRole === "owner" && canRequestAdmin) {
        const rolesResult = await adminApiService.getRoles(250, adminAuthOptions);
        if (renderVersion !== this.adminModalRenderVersion) {
          return;
        }
        roleRecords = rolesResult.roles;
        roleReason = rolesResult.reason;
        roleStatus = rolesResult.status;
      }
      if (canRequestAdmin) {
        const auditResult = await adminApiService.getAudit(40, adminAuthOptions);
        if (renderVersion !== this.adminModalRenderVersion) {
          return;
        }
        auditEntries = auditResult.entries;
        auditReason = auditResult.reason;
        auditStatus = auditResult.status;
        const storageResult = await adminApiService.getStorage(adminAuthOptions);
        if (renderVersion !== this.adminModalRenderVersion) {
          return;
        }
        storage = storageResult.storage;
        storageSections = storageResult.sections;
        storageReason = storageResult.reason;
        storageStatus = storageResult.status;
      }
      panel.innerHTML = this.renderAdminMonitorMarkup(
        adminResult.overview,
        adminResult.reason,
        adminResult.status,
        {
          currentRole: resolvedRole,
          roleSource: accountProfile?.admin?.source ?? undefined,
          roleRecords,
          roleReason,
          roleStatus,
          auditEntries,
          auditReason,
          auditStatus,
          storage,
          storageSections,
          storageReason,
          storageStatus,
        }
      );
      this.bindAdminActions(panel);
    } catch (error) {
      if (renderVersion !== this.adminModalRenderVersion) {
        return;
      }
      log.warn("Failed to refresh admin monitor panel", error);
      panel.innerHTML = `
        <p class="settings-account-loading">${t("settings.admin.error.loadFailed")}</p>
      `;
    }
  }

  private renderAdminMonitorMarkup(
    overview: AdminMonitorOverview | null,
    reason?: string,
    status?: number,
    options: {
      currentRole?: AdminUserRole | null;
      roleSource?: string;
      roleRecords?: AdminRoleRecord[] | null;
      roleReason?: string;
      roleStatus?: number;
      auditEntries?: AdminAuditEntry[] | null;
      auditReason?: string;
      auditStatus?: number;
      storage?: AdminStorageDiagnostics | null;
      storageSections?: AdminStorageSectionSummary[] | null;
      storageReason?: string;
      storageStatus?: number;
    } = {}
  ): string {
    const tokenValue = adminApiService.getAdminToken();
    const now = Date.now();
    const currentRole = this.normalizeAdminRoleValue(options.currentRole);
    const canOperate = currentRole === "owner" || currentRole === "operator";
    const statusText = overview
      ? t("settings.admin.status.connected", {
          mode: this.formatAdminAccessMode(overview.accessMode),
        })
      : this.getAdminMonitorFailureMessage(reason, status);
    const statusTone = overview ? "ok" : reason === "network_error" ? "warn" : "error";
    const metricsMarkup = overview
      ? `
        <div class="settings-admin-metrics-grid">
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.activeRooms")}</span>
            <strong>${overview.metrics.activeSessionCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.humans")}</span>
            <strong>${overview.metrics.humanCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.bots")}</span>
            <strong>${overview.metrics.botCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.publicBase")}</span>
            <strong>${overview.metrics.publicDefaultCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.overflow")}</span>
            <strong>${overview.metrics.publicOverflowCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.private")}</span>
            <strong>${overview.metrics.privateRoomCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.timeoutAuto")}</span>
            <strong>${Math.max(0, Math.floor(overview.metrics.turnTimeoutAutoAdvanceCount ?? 0))}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>${t("settings.admin.metrics.botAuto")}</span>
            <strong>${Math.max(0, Math.floor(overview.metrics.botTurnAutoAdvanceCount ?? 0))}</strong>
          </div>
        </div>
      `
      : "";
    const roomsMarkup = overview
      ? this.renderAdminRoomListMarkup(overview, now, canOperate)
      : `
        <p class="settings-admin-empty">
          ${t("settings.admin.monitor.unavailable")}
        </p>
      `;
    const roleLine = currentRole
      ? t("settings.admin.role.current", {
          role: `${currentRole}${options.roleSource ? ` (${options.roleSource})` : ""}`,
        })
      : t("settings.admin.role.none");
    const roleManagerMarkup =
      currentRole === "owner"
        ? this.renderAdminRoleManagerMarkup(options.roleRecords, options.roleReason, options.roleStatus)
        : currentRole
          ? `<p class="settings-admin-empty">${t("settings.admin.role.ownerRequired")}</p>`
          : `<p class="settings-admin-empty">${t("settings.admin.role.signInRequired")}</p>`;
    const auditMarkup = this.renderAdminAuditMarkup(
      options.auditEntries,
      options.auditReason,
      options.auditStatus
    );
    const storageMarkup = this.renderAdminStorageMarkup(
      options.storage,
      options.storageSections,
      options.storageReason,
      options.storageStatus
    );

    return `
      <div class="settings-admin-monitor">
        <div class="settings-admin-header">
          <div class="settings-admin-title">${t("settings.admin.monitor.title")}</div>
          <div class="settings-admin-status settings-admin-status--${statusTone}">
            ${escapeHtml(statusText)}
          </div>
        </div>
        <div class="settings-admin-role">${escapeHtml(roleLine)}</div>
        <div class="settings-admin-actions">
          <button type="button" class="btn btn-secondary settings-account-btn" data-action="settings-admin-refresh">
            ${t("settings.admin.action.refreshMonitor")}
          </button>
        </div>
        <div class="settings-admin-token-row">
          <label for="settings-admin-token">${t("settings.admin.token.label")}</label>
          <div class="settings-account-name-inputs">
            <input
              id="settings-admin-token"
              type="password"
              placeholder="${escapeAttribute(t("settings.admin.token.placeholder"))}"
              autocomplete="off"
              spellcheck="false"
              value="${escapeAttribute(tokenValue)}"
            />
            <button type="button" class="btn btn-primary settings-account-btn" data-action="settings-admin-save-token">
              ${t("settings.admin.action.save")}
            </button>
            <button type="button" class="btn btn-outline settings-account-btn" data-action="settings-admin-clear-token">
              ${t("settings.admin.action.clear")}
            </button>
          </div>
        </div>
        ${metricsMarkup}
        ${storageMarkup}
        ${roomsMarkup}
        ${auditMarkup}
        ${roleManagerMarkup}
      </div>
    `;
  }

  private renderAdminRoleManagerMarkup(
    roleRecords: AdminRoleRecord[] | null | undefined,
    roleReason?: string,
    roleStatus?: number
  ): string {
    if (!roleRecords) {
      return `
        <p class="settings-admin-empty">
          Role list unavailable: ${escapeHtml(this.getAdminMonitorFailureMessage(roleReason, roleStatus))}
        </p>
      `;
    }
    if (!roleRecords.length) {
      return `
        <p class="settings-admin-empty">
          ${t("settings.admin.role.noKnownUsers")}
        </p>
      `;
    }

    const rows = roleRecords
      .map((record) => {
        const normalizedRole = this.normalizeAdminRoleValue(record.role);
        const locked = record.source === "bootstrap";
        const label = record.displayName?.trim() || record.email?.trim() || record.uid;
        return `
          <div class="settings-admin-role-row" data-admin-role-target="${escapeAttribute(record.uid)}">
            <div class="settings-admin-role-user">
              <strong>${escapeHtml(label)}</strong>
              <span>${escapeHtml(record.uid)}</span>
            </div>
            <div class="settings-admin-role-controls">
              <select data-admin-role-select ${locked ? "disabled" : ""}>
                <option value="" ${normalizedRole === null ? "selected" : ""}>${t("settings.account.none")}</option>
                <option value="viewer" ${normalizedRole === "viewer" ? "selected" : ""}>${t("settings.admin.role.viewer")}</option>
                <option value="operator" ${normalizedRole === "operator" ? "selected" : ""}>${t("settings.admin.role.operator")}</option>
                <option value="owner" ${normalizedRole === "owner" ? "selected" : ""}>${t("settings.admin.role.owner")}</option>
              </select>
              <button
                type="button"
                class="btn btn-secondary settings-account-btn"
                data-action="settings-admin-save-role"
                ${locked ? "disabled" : ""}
              >
                ${locked ? t("settings.admin.role.locked") : t("settings.admin.role.apply")}
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="settings-admin-role-manager">
        <div class="settings-admin-role-manager-title">${t("settings.admin.role.managementTitle")}</div>
        ${rows}
      </div>
    `;
  }

  private renderAdminRoomListMarkup(
    overview: AdminMonitorOverview,
    now: number,
    canOperate: boolean
  ): string {
    if (!overview.rooms.length) {
      return `
        <p class="settings-admin-empty">
          ${t("settings.admin.room.noneActive")}
        </p>
      `;
    }

    const roomCards = overview.rooms
      .map((room) => {
        const activeTurnPlayerId = room.turnState?.activeTurnPlayerId ?? null;
        const activeTurnPlayer = activeTurnPlayerId
          ? room.participants.find((participant) => participant.playerId === activeTurnPlayerId)
          : null;
        const activeTurnLabel =
          activeTurnPlayer?.displayName?.trim() ||
          activeTurnPlayerId ||
          t("settings.admin.room.noActivePlayer");
        const phaseLabel = room.turnState
          ? this.formatAdminTurnPhase(room.turnState.phase)
          : t("settings.admin.turnPhase.waiting");
        const secondsToTurnExpire =
          room.turnState && typeof room.turnState.turnExpiresAt === "number"
            ? Math.max(0, Math.ceil((room.turnState.turnExpiresAt - now) / 1000))
            : null;
        const secondsToSessionExpire = Math.max(0, Math.ceil((room.expiresAt - now) / 1000));
        const roomTypeLabel = this.formatAdminRoomType(room.roomType);
        const removablePlayers = room.participants.filter((participant) => !participant.isBot);
        const removeOptionsMarkup = removablePlayers
          .map((participant) => {
            const participantLabel =
              participant.displayName?.trim() || participant.playerId;
            return `<option value="${escapeAttribute(participant.playerId)}">${escapeHtml(participantLabel)}</option>`;
          })
          .join("");
        const adminActionsMarkup = canOperate
          ? `
            <div class="settings-admin-room-actions">
                <button
                type="button"
                class="btn btn-danger settings-account-btn"
                data-action="settings-admin-expire-room"
                data-session-id="${escapeAttribute(room.sessionId)}"
              >
                ${t("settings.admin.action.expireRoom")}
              </button>
              ${
                removablePlayers.length > 0
                  ? `
                    <div class="settings-admin-remove-row">
                      <select data-admin-remove-player>
                        ${removeOptionsMarkup}
                      </select>
                      <button
                        type="button"
                        class="btn btn-secondary settings-account-btn"
                        data-action="settings-admin-remove-player"
                        data-session-id="${escapeAttribute(room.sessionId)}"
                      >
                        ${t("settings.admin.action.removePlayer")}
                      </button>
                    </div>
                  `
                  : `<div class="settings-admin-empty">${t("settings.admin.room.noHumanPlayers")}</div>`
              }
            </div>
          `
          : "";

        return `
          <div class="settings-admin-room-card">
            <div class="settings-admin-room-top">
              <div class="settings-admin-room-code">${escapeHtml(room.roomCode)}</div>
              <div class="settings-admin-room-type">${escapeHtml(roomTypeLabel)}</div>
            </div>
            <div class="settings-admin-room-meta">
              ${escapeHtml(
                t("settings.admin.room.meta", {
                  humans: `${room.humanCount}/${room.maxHumanCount}`,
                  ready: room.readyHumanCount,
                  bots: room.botCount,
                  connected: room.connectedSocketCount,
                })
              )}
            </div>
            <div class="settings-admin-room-turn">
              <strong>${escapeHtml(activeTurnLabel)}</strong> • ${escapeHtml(phaseLabel)}
              ${
                secondsToTurnExpire === null
                  ? ""
                  : ` • ${escapeHtml(t("settings.admin.room.turnSeconds", { seconds: secondsToTurnExpire }))}`
              }
              • ${escapeHtml(t("settings.admin.room.idleSeconds", { seconds: Math.floor(room.idleMs / 1000) }))}
              • ${escapeHtml(t("settings.admin.room.roomSeconds", { seconds: secondsToSessionExpire }))}
            </div>
            ${adminActionsMarkup}
          </div>
        `;
      })
      .join("");

    return `
      <div class="settings-admin-room-list">
        ${roomCards}
      </div>
    `;
  }

  private renderAdminStorageMarkup(
    storage: AdminStorageDiagnostics | null | undefined,
    sections: AdminStorageSectionSummary[] | null | undefined,
    reason?: string,
    status?: number
  ): string {
    if (!storage || !sections) {
      return `
        <div class="settings-admin-storage">
          <div class="settings-admin-storage-title">${t("settings.admin.storage.title")}</div>
          <p class="settings-admin-empty">
            ${escapeHtml(
              t("settings.admin.storage.unavailable", {
                reason: this.getAdminMonitorFailureMessage(reason, status),
              })
            )}
          </p>
        </div>
      `;
    }

    const backendLabel = storage.backend?.trim() || "unknown";
    const prefixLabel = storage.firestorePrefix?.trim() || "";
    const sectionMarkup = sections
      .map((entry) => {
        const label = entry.section?.trim() || "unknown";
        const count = Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0;
        return `<span>${escapeHtml(label)}: ${count}</span>`;
      })
      .join("");

    return `
      <div class="settings-admin-storage">
        <div class="settings-admin-storage-title">${t("settings.admin.storage.title")}</div>
        <div class="settings-admin-storage-meta">
          ${escapeHtml(t("settings.admin.storage.backend", { backend: backendLabel }))}
          ${
            prefixLabel
              ? ` • ${escapeHtml(t("settings.admin.storage.prefix", { prefix: prefixLabel }))}`
              : ""
          }
        </div>
        <div class="settings-admin-storage-sections">
          ${sectionMarkup}
        </div>
      </div>
    `;
  }

  private renderAdminAuditMarkup(
    auditEntries: AdminAuditEntry[] | null | undefined,
    reason?: string,
    status?: number
  ): string {
    if (!auditEntries) {
      return `
        <div class="settings-admin-audit-list">
          <div class="settings-admin-audit-title">${t("settings.admin.audit.title")}</div>
          <p class="settings-admin-empty">
            ${escapeHtml(
              t("settings.admin.audit.unavailable", {
                reason: this.getAdminMonitorFailureMessage(reason, status),
              })
            )}
          </p>
        </div>
      `;
    }
    if (!auditEntries.length) {
      return `
        <div class="settings-admin-audit-list">
          <div class="settings-admin-audit-title">${t("settings.admin.audit.title")}</div>
          <p class="settings-admin-empty">${t("settings.admin.audit.noActions")}</p>
        </div>
      `;
    }
    const rows = auditEntries
      .map((entry) => {
        const actionLabel = this.formatAdminAuditAction(entry.action);
        const actorLabel =
          entry.actor.uid?.trim() ||
          entry.actor.email?.trim() ||
          entry.actor.authType?.trim() ||
          t("settings.admin.audit.unknownActor");
        const targetLabel =
          entry.target.sessionId?.trim() ||
          entry.target.playerId?.trim() ||
          entry.target.uid?.trim() ||
          "";
        const summary = entry.summary?.trim()
          ? entry.summary.trim()
          : `${actionLabel}${targetLabel ? ` · ${targetLabel}` : ""}`;
        return `
          <div class="settings-admin-audit-row">
            <div class="settings-admin-audit-main">
              <strong>${escapeHtml(actionLabel)}</strong>
              <span>${escapeHtml(summary)}</span>
            </div>
            <div class="settings-admin-audit-meta">
              <span>${escapeHtml(actorLabel)}</span>
              <span>${escapeHtml(this.formatAdminAuditTimestamp(entry.timestamp))}</span>
            </div>
          </div>
        `;
      })
      .join("");
    return `
      <div class="settings-admin-audit-list">
        <div class="settings-admin-audit-title">${t("settings.admin.audit.title")}</div>
        ${rows}
      </div>
    `;
  }

  private getAdminMonitorFailureMessage(reason?: string, status?: number): string {
    switch (reason) {
      case "missing_admin_auth":
        return t("settings.admin.failure.missingAdminAuth");
      case "missing_admin_token":
        return t("settings.admin.failure.missingAdminToken");
      case "invalid_admin_token":
        return t("settings.admin.failure.invalidAdminToken");
      case "missing_admin_role":
        return t("settings.admin.failure.missingAdminRole");
      case "invalid_session_id":
        return t("settings.admin.failure.invalidSessionId");
      case "invalid_player_id":
        return t("settings.admin.failure.invalidPlayerId");
      case "unknown_session":
        return t("settings.admin.failure.unknownSession");
      case "unknown_player":
        return t("settings.admin.failure.unknownPlayer");
      case "admin_role_required":
        return t("settings.admin.failure.adminRoleRequired");
      case "admin_role_forbidden":
        return t("settings.admin.failure.adminRoleForbidden");
      case "bootstrap_owner_locked":
        return t("settings.admin.failure.bootstrapOwnerLocked");
      case "missing_authorization_header":
      case "invalid_bearer_header":
      case "invalid_auth":
      case "anonymous_not_allowed":
        return t("settings.admin.failure.signInRequired");
      case "invalid_admin_payload":
        return t("settings.admin.failure.invalidPayload");
      case "admin_disabled":
        return t("settings.admin.failure.adminDisabled");
      case "network_error":
        return t("settings.admin.failure.network");
      default: {
        if (status === 401) {
          return t("settings.admin.failure.http401");
        }
        if (status === 403) {
          return t("settings.admin.failure.http403");
        }
        if (status && Number.isFinite(status)) {
          return t("settings.admin.failure.httpGeneric", { status });
        }
        return t("settings.admin.failure.unavailable");
      }
    }
  }

  private formatAdminAccessMode(mode: string | undefined): string {
    switch (mode) {
      case "open":
        return t("settings.admin.accessMode.open");
      case "token":
        return t("settings.admin.accessMode.token");
      case "role":
        return t("settings.admin.accessMode.role");
      case "hybrid":
        return t("settings.admin.accessMode.hybrid");
      case "disabled":
        return t("settings.admin.accessMode.disabled");
      default:
        return t("settings.admin.accessMode.unknown");
    }
  }

  private formatAdminAuditAction(action: string): string {
    switch (action) {
      case "role_upsert":
        return t("settings.admin.audit.action.roleUpsert");
      case "session_expire":
        return t("settings.admin.audit.action.sessionExpire");
      case "participant_remove":
        return t("settings.admin.audit.action.participantRemove");
      default:
        return action
          .split("_")
          .filter((part) => part.trim().length > 0)
          .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
          .join(" ");
    }
  }

  private formatAdminAuditTimestamp(timestamp: number): string {
    if (!Number.isFinite(timestamp)) {
      return t("settings.admin.audit.unknownTime");
    }
    try {
      return new Date(timestamp).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return t("settings.admin.audit.unknownTime");
    }
  }

  private normalizeAdminRoleValue(role: unknown): AdminUserRole | null {
    if (role === "viewer" || role === "operator" || role === "owner") {
      return role;
    }
    return null;
  }

  private isAdminMonitorEnabled(): boolean {
    return environment.adminUiEnabled || environment.debug;
  }

  private async getAdminRequestAuthOptions(): Promise<{
    firebaseIdToken?: string | null;
    adminToken?: string | null;
  }> {
    const firebaseIdToken = await firebaseAuthService.getIdToken();
    const adminToken = adminApiService.getAdminToken();
    return {
      firebaseIdToken,
      adminToken,
    };
  }

  private formatAdminRoomType(roomType: string): string {
    switch (roomType) {
      case "public_default":
        return t("settings.admin.room.type.publicBase");
      case "public_overflow":
        return t("settings.admin.room.type.publicOverflow");
      default:
        return t("settings.admin.room.type.private");
    }
  }

  private formatAdminTurnPhase(phase: string): string {
    switch (phase) {
      case "await_roll":
        return t("settings.admin.turnPhase.awaitRoll");
      case "await_score":
        return t("settings.admin.turnPhase.awaitScore");
      case "ready_to_end":
        return t("settings.admin.turnPhase.readyToEnd");
      default:
        return t("settings.admin.turnPhase.waiting");
    }
  }

  private startAdminMonitorRefresh(): void {
    if (!this.isAdminMonitorEnabled()) {
      return;
    }
    this.stopAdminMonitorRefresh();
    this.adminMonitorRefreshHandle = setInterval(() => {
      if (
        this.activeTab !== "account" ||
        !this.isVisible() ||
        this.isAccountFieldFocused() ||
        this.savingAdminRole
      ) {
        return;
      }
      void this.refreshAccountSection();
    }, ADMIN_MONITOR_REFRESH_MS);
  }

  private stopAdminMonitorRefresh(): void {
    if (!this.adminMonitorRefreshHandle) {
      return;
    }
    clearInterval(this.adminMonitorRefreshHandle);
    this.adminMonitorRefreshHandle = undefined;
  }

  private isAccountFieldFocused(): boolean {
    const activeElement = document.activeElement as HTMLElement | null;
    if (!activeElement) {
      return false;
    }
    return activeElement.id === "settings-leaderboard-name";
  }

  private updateAccountSyncIndicator(): void {
    const indicator = this.container.querySelector("#settings-sync-indicator");
    if (!indicator) {
      return;
    }

    const state = this.getSyncIndicatorState();
    indicator.classList.remove(
      "sync-indicator--ok",
      "sync-indicator--syncing",
      "sync-indicator--pending",
      "sync-indicator--offline",
      "sync-indicator--error"
    );
    indicator.classList.add(`sync-indicator--${state.tone}`);
    indicator.setAttribute("title", state.title);

    const label = indicator.querySelector(".sync-indicator-label");
    if (label) {
      label.textContent = state.label;
    }
  }

  private getSyncIndicatorState(): { label: string; tone: SyncIndicatorTone; title: string } {
    const dataSync: PlayerDataSyncStatus = playerDataSyncService.getSyncStatus();
    const leaderboardSync: LeaderboardSyncStatus = leaderboardService.getSyncStatus();
    const pendingCount =
      dataSync.pendingLogCount +
      dataSync.pendingScoreLogCount +
      leaderboardSync.pendingGlobalScores;

    if (!isNavigatorOnline()) {
      return {
        label: t("settings.sync.offline.label"),
        tone: "offline",
        title: t("settings.sync.offline.title"),
      };
    }

    if (dataSync.state === "syncing" || leaderboardSync.state === "syncing") {
      return {
        label: t("settings.sync.syncing.label"),
        tone: "syncing",
        title: t("settings.sync.syncing.title"),
      };
    }

    if (dataSync.state === "error" || leaderboardSync.state === "error") {
      return {
        label: t("settings.sync.error.label"),
        tone: "error",
        title: t("settings.sync.error.title"),
      };
    }

    if (pendingCount > 0 || dataSync.profileDirty) {
      return {
        label:
          pendingCount > 0
            ? t("settings.sync.pending.withCount", { count: pendingCount })
            : t("settings.sync.pending.label"),
        tone: "pending",
        title: t("settings.sync.pending.title"),
      };
    }

    const latestSuccessAt = Math.max(
      dataSync.lastSuccessAt,
      leaderboardSync.lastSuccessAt,
      leaderboardSync.lastFetchedAt
    );
    const suffix =
      latestSuccessAt > 0
        ? t("settings.sync.upToDate.suffix", { relative: formatRelativeSyncTime(latestSuccessAt) })
        : "";

    return {
      label: t("settings.sync.upToDate.label"),
      tone: "ok",
      title: `${t("settings.sync.upToDate.title")}${suffix}`,
    };
  }

  /**
   * Refresh UI with current settings
   */
  private refresh(): void {
    this.settings = settingsService.getSettings();

    (document.getElementById("master-volume") as HTMLInputElement).value = String(
      this.settings.audio.masterVolume * 100
    );
    (document.getElementById("master-volume-value") as HTMLElement).textContent = `${Math.round(
      this.settings.audio.masterVolume * 100
    )}%`;

    (document.getElementById("sfx-volume") as HTMLInputElement).value = String(
      this.settings.audio.sfxVolume * 100
    );
    (document.getElementById("sfx-volume-value") as HTMLElement).textContent = `${Math.round(
      this.settings.audio.sfxVolume * 100
    )}%`;

    (document.getElementById("music-volume") as HTMLInputElement).value = String(
      this.settings.audio.musicVolume * 100
    );
    (document.getElementById("music-volume-value") as HTMLElement).textContent = `${Math.round(
      this.settings.audio.musicVolume * 100
    )}%`;

    (document.getElementById("sfx-enabled") as HTMLInputElement).checked = this.settings.audio.sfxEnabled;
    (document.getElementById("music-enabled") as HTMLInputElement).checked = this.settings.audio.musicEnabled;

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
    (document.getElementById("mobile-dice-layout") as HTMLSelectElement).value =
      this.settings.controls.mobileDiceLayout;
    (document.getElementById("game-language") as HTMLSelectElement).value = getLocale();

    (document.getElementById("variant-d20") as HTMLInputElement).checked = this.settings.game.addD20;
    (document.getElementById("variant-d4") as HTMLInputElement).checked = this.settings.game.addD4;
    (document.getElementById("variant-2nd-d10") as HTMLInputElement).checked =
      this.settings.game.add2ndD10;
    (document.getElementById("variant-d100") as HTMLInputElement).checked = this.settings.game.d100Mode;

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

    const difficulty = (document.getElementById("game-difficulty") as HTMLSelectElement)
      .value as GameDifficulty;

    const descriptions = {
      easy: t("settings.difficulty.info.easy"),
      normal: t("settings.difficulty.info.normal"),
      hard: t("settings.difficulty.info.hard"),
    };

    infoText.textContent = descriptions[difficulty];
    this.updateCameraAssistControlState(difficulty);
  }

  private updateCameraAssistControlState(difficulty: GameDifficulty): void {
    const toggle = document.getElementById("camera-assist-enabled") as HTMLInputElement | null;
    const info = document.getElementById("camera-assist-info-text") as HTMLElement | null;
    if (!toggle) {
      return;
    }

    const isEasy = difficulty === "easy";
    const storedEnabled = settingsService.getSettings().game.cameraAssistEnabled !== false;
    toggle.disabled = !isEasy;
    toggle.checked = isEasy && storedEnabled;

    if (info) {
      info.textContent = isEasy
        ? t("settings.cameraAssist.info.easy")
        : t("settings.cameraAssist.info.nonEasy");
    }
  }

  private getLocaleLabel(locale: LocaleCode): string {
    switch (locale) {
      case "es-ES":
        return t("settings.controls.language.option.esES");
      case "en-US":
      default:
        return t("settings.controls.language.option.enUS");
    }
  }

  private getLocaleOptionLabel(locale: LocaleCode): string {
    const flag = locale === "es-ES" ? "&#x1F1EA;&#x1F1F8;" : "&#x1F1FA;&#x1F1F8;";
    return `${flag} ${this.getLocaleLabel(locale)}`;
  }

  private getAvatarInitial(displayName: string): string {
    const normalized = displayName.trim();
    if (!normalized) {
      return "?";
    }
    return normalized.charAt(0).toUpperCase();
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private isGameInProgress(): boolean {
    return Boolean(this.checkGameInProgress && this.checkGameInProgress());
  }

  /**
   * Show settings modal
   */
  show(): void {
    modalManager.requestOpen("settings-modal");
    this.refresh();
    this.container.style.display = "flex";
    if (this.activeTab === "account") {
      this.startAdminMonitorRefresh();
      void this.refreshAccountSection();
      return;
    }
    this.stopAdminMonitorRefresh();
  }

  /**
   * Hide settings modal
   */
  hide(): void {
    if (this.container.style.display === "none") {
      return;
    }
    this.hideAdminMonitorModal();
    this.stopAdminMonitorRefresh();
    this.container.style.display = "none";
    modalManager.notifyClosed("settings-modal");

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
   * Set callback for when return to lobby is requested
   */
  setOnReturnToLobby(callback: () => void): void {
    this.onReturnToLobby = callback;
  }

  /**
   * Set callback to check if game is in progress
   */
  setCheckGameInProgress(callback: () => boolean): void {
    this.checkGameInProgress = callback;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
}

function formatRelativeSyncTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    return t("settings.sync.relative.justNow");
  }
  if (deltaMs < 10_000) {
    return t("settings.sync.relative.justNow");
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return t("settings.sync.relative.secondsAgo", { value: seconds });
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return t("settings.sync.relative.minutesAgo", { value: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("settings.sync.relative.hoursAgo", { value: hours });
  }
  const days = Math.floor(hours / 24);
  return t("settings.sync.relative.daysAgo", { value: days });
}

function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
    return true;
  }
  return navigator.onLine;
}
