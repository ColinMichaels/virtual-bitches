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
  type AdminMonitorOverview,
  type AdminRoleRecord,
  type AdminUserRole,
} from "../services/adminApi.js";
import { logger } from "../utils/logger.js";
import { confirmAction } from "./confirmModal.js";
import { modalManager } from "./modalManager.js";

const log = logger.create("SettingsModal");
const ADMIN_MONITOR_REFRESH_MS = 5000;

type SettingsTab = "game" | "graphics" | "audio" | "account";
type SyncIndicatorTone = "ok" | "syncing" | "pending" | "offline" | "error";

export class SettingsModal {
  private container: HTMLElement;
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
  private accountRenderVersion = 0;
  private adminMonitorRefreshHandle?: ReturnType<typeof setInterval>;
  private readonly onFirebaseAuthChanged = () => {
    leaderboardService.clearCachedProfile();
    void this.refreshAccountSection();
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
        <h2>Settings</h2>

        <div class="settings-tabs" role="tablist" aria-label="Settings sections">
          <button class="settings-tab-btn active" type="button" data-tab="game">Game</button>
          <button class="settings-tab-btn" type="button" data-tab="graphics">Graphics</button>
          <button class="settings-tab-btn" type="button" data-tab="audio">Audio</button>
          <button class="settings-tab-btn" type="button" data-tab="account">Account</button>
        </div>

        <div class="settings-tab-panel is-active" data-tab-panel="game">
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
        </div>

        <div class="settings-tab-panel" data-tab-panel="graphics">
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

          <div class="settings-section" id="theme-switcher-container"></div>
        </div>

        <div class="settings-tab-panel" data-tab-panel="audio">
          <div class="settings-section">
            <h3>Audio</h3>

            <div class="setting-row">
              <label for="master-volume">Master Volume</label>
              <input type="range" id="master-volume" min="0" max="100" value="${this.settings.audio.masterVolume * 100}">
              <span id="master-volume-value">${Math.round(this.settings.audio.masterVolume * 100)}%</span>
            </div>

            <div class="setting-row" id="audio-sfx-volume-row">
              <label for="sfx-volume">Sound Effects</label>
              <input type="range" id="sfx-volume" min="0" max="100" value="${this.settings.audio.sfxVolume * 100}">
              <span id="sfx-volume-value">${Math.round(this.settings.audio.sfxVolume * 100)}%</span>
            </div>

            <div class="setting-row" id="audio-music-volume-row">
              <label for="music-volume">Music</label>
              <input type="range" id="music-volume" min="0" max="100" value="${this.settings.audio.musicVolume * 100}">
              <span id="music-volume-value">${Math.round(this.settings.audio.musicVolume * 100)}%</span>
            </div>

            <div class="setting-row" id="audio-sfx-toggle-row">
              <label>
                <input type="checkbox" id="sfx-enabled" ${this.settings.audio.sfxEnabled ? "checked" : ""}>
                Enable Sound Effects
              </label>
            </div>

            <div class="setting-row" id="audio-music-toggle-row">
              <label>
                <input type="checkbox" id="music-enabled" ${this.settings.audio.musicEnabled ? "checked" : ""}>
                Enable Music
              </label>
            </div>

            <div class="setting-row" ${hapticsService.isSupported() ? "" : 'style="display:none;"'}>
              <label>
                <input type="checkbox" id="haptics-enabled" ${this.settings.haptics !== false ? "checked" : ""}>
                Enable Haptic Feedback
              </label>
            </div>
          </div>
        </div>

        <div class="settings-tab-panel" data-tab-panel="account">
          <div class="settings-section">
            <h3>Account</h3>
            <p class="setting-description">
              Manage sign-in status and leaderboard identity from one place.
            </p>
            <div id="settings-account-panel" class="settings-account-panel">
              <p class="settings-account-loading">Loading account details...</p>
            </div>
          </div>
        </div>

        <div class="settings-buttons">
          <button id="settings-return-lobby" class="btn btn-secondary">Main Menu</button>
          <button id="settings-how-to-play" class="btn btn-outline">How to Play</button>
          <button id="settings-close" class="btn btn-primary primary">Close</button>
          <button id="settings-new-game" class="btn btn-danger danger">New Game</button>
          <button id="settings-reset" class="btn btn-secondary">Reset to Defaults</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    modalManager.register({
      id: "settings-modal",
      close: () => this.hide(),
      canStackWith: ["tutorial-modal"],
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
        low: "Low Contrast (Brighter Table)",
        normal: "Normal Contrast (Balanced)",
        high: "High Contrast (Darker Table)",
        maximum: "Maximum Contrast (Darkest Table)",
      };
      notificationService.show(`Table contrast: ${labels[value]}`, "info", 2000);

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
          ? "Chaos camera effects reduced"
          : "Chaos camera effects restored",
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
          ? "Control inversion enabled for drunk attacks"
          : "Control inversion blocked by accessibility setting",
        "info",
        2200
      );
      audioService.playSfx("click");
    });

    // Game Difficulty
    const gameDifficulty = document.getElementById("game-difficulty") as HTMLSelectElement;
    gameDifficulty.addEventListener("change", async () => {
      if (this.isGameInProgress()) {
        const confirmed = await confirmAction({
          title: "Start New Game?",
          message: "Changing difficulty will start a new game. Your current progress will be lost.",
          confirmLabel: "Continue",
          cancelLabel: "Keep Current Game",
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
          title: "Start New Game?",
          message: "Changing dice variants will start a new game. Your current progress will be lost.",
          confirmLabel: "Continue",
          cancelLabel: "Keep Current Game",
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
          title: "Start New Game?",
          message: "Changing dice variants will start a new game. Your current progress will be lost.",
          confirmLabel: "Continue",
          cancelLabel: "Keep Current Game",
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
          title: "Start New Game?",
          message: "Changing dice variants will start a new game. Your current progress will be lost.",
          confirmLabel: "Continue",
          cancelLabel: "Keep Current Game",
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
          title: "Start New Game?",
          message: "Changing dice variants will start a new game. Your current progress will be lost.",
          confirmLabel: "Continue",
          cancelLabel: "Keep Current Game",
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
        title: "Return To Lobby?",
        message: "Leave this game and return to the main menu?",
        confirmLabel: "Return To Lobby",
        cancelLabel: "Stay In Game",
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
        title: "Start New Game?",
        message: "Your current progress will be lost.",
        confirmLabel: "Start New Game",
        cancelLabel: "Cancel",
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
        title: "Reset Settings?",
        message: "Reset all settings to defaults?",
        confirmLabel: "Reset Settings",
        cancelLabel: "Cancel",
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
    panel.innerHTML = `<p class="settings-account-loading">Loading account details...</p>`;

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
        "Guest Player";
      const email = accountProfile?.email?.trim() || firebaseProfile?.email?.trim() || "";
      const provider = accountProfile?.provider?.trim() || (isAuthenticated ? "google" : "guest");
      const leaderboardName = accountProfile?.leaderboardName?.trim() ?? "";
      const accountAdminRole = this.normalizeAdminRoleValue(accountProfile?.admin?.role);
      const firebaseIdToken = isAuthenticated ? (await firebaseAuthService.getIdToken()) ?? "" : "";
      const authLabel = authConfigured
        ? isAuthenticated
          ? "Signed In"
          : "Guest Mode"
        : "Auth Not Configured";
      const syncIndicator = this.getSyncIndicatorState();
      let adminMonitorMarkup = "";
      if (environment.debug) {
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
        if (renderVersion !== this.accountRenderVersion) {
          return;
        }
        const profileRole = this.normalizeAdminRoleValue(accountProfile?.admin?.role);
        const resolvedRole = this.normalizeAdminRoleValue(
          profileRole ?? adminResult.overview?.principal?.role
        );
        let roleRecords: AdminRoleRecord[] | null = null;
        let roleReason: string | undefined;
        let roleStatus: number | undefined;
        if (resolvedRole === "owner" && canRequestAdmin) {
          const rolesResult = await adminApiService.getRoles(250, adminAuthOptions);
          if (renderVersion !== this.accountRenderVersion) {
            return;
          }
          roleRecords = rolesResult.roles;
          roleReason = rolesResult.reason;
          roleStatus = rolesResult.status;
        }
        adminMonitorMarkup = this.renderAdminMonitorMarkup(
          adminResult.overview,
          adminResult.reason,
          adminResult.status,
          {
            currentRole: resolvedRole,
            roleSource: accountProfile?.admin?.source ?? undefined,
            roleRecords,
            roleReason,
            roleStatus,
          }
        );
      }

      panel.innerHTML = `
        <div class="settings-account-header">
          <div>
            <div class="settings-account-name">${escapeHtml(displayName)}</div>
            <div class="settings-account-badge">${escapeHtml(authLabel)}</div>
            ${email ? `<div class="settings-account-email">${escapeHtml(email)}</div>` : ""}
            <div class="settings-account-provider">Provider: ${escapeHtml(provider)}</div>
            ${
              environment.debug
                ? `<div class="settings-account-provider">Admin Role: ${escapeHtml(
                    accountAdminRole ?? "none"
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
          <div class="settings-account-actions">
            ${
              authConfigured && !isAuthenticated
                ? '<button type="button" class="btn btn-primary settings-account-btn" data-action="settings-signin">Sign In with Google</button>'
                : ""
            }
            ${
              isAuthenticated
                ? '<button type="button" class="btn btn-danger settings-account-btn" data-action="settings-signout">Sign Out</button>'
                : ""
            }
            <button type="button" class="btn btn-secondary settings-account-btn" data-action="settings-refresh">Refresh</button>
          </div>
        </div>

        ${
          isAuthenticated
            ? `<div class="settings-account-name-row">
                <label for="settings-leaderboard-name">Leaderboard Name</label>
                <div class="settings-account-name-inputs">
                  <input
                    id="settings-leaderboard-name"
                    type="text"
                    maxlength="24"
                    placeholder="Your public leaderboard name"
                    value="${escapeAttribute(leaderboardName)}"
                  />
                  <button type="button" class="btn btn-primary settings-account-btn" data-action="settings-save-name">Save</button>
                </div>
              </div>`
            : `<p class="setting-description settings-account-help">
                Sign in to set your leaderboard name and submit global scores.
              </p>`
        }

        <div class="settings-account-stats-grid">
          <div class="settings-account-stat">
            <span>Games</span>
            <strong>${stats.totalGames}</strong>
          </div>
          <div class="settings-account-stat">
            <span>Best</span>
            <strong>${stats.totalGames > 0 ? stats.bestScore : "-"}</strong>
          </div>
          <div class="settings-account-stat">
            <span>Average</span>
            <strong>${stats.totalGames > 0 ? stats.averageScore : "-"}</strong>
          </div>
          <div class="settings-account-stat">
            <span>Play Time</span>
            <strong>${this.formatDuration(stats.totalPlayTime)}</strong>
          </div>
        </div>

        ${adminMonitorMarkup}
      `;

      this.bindAccountActions(panel);
    } catch (error) {
      if (renderVersion !== this.accountRenderVersion) {
        return;
      }
      log.warn("Failed to refresh account settings panel", error);
      panel.innerHTML = `
        <p class="settings-account-loading">Unable to load account details right now.</p>
      `;
    }
  }

  private bindAccountActions(panel: HTMLElement): void {
    panel.querySelector('[data-action="settings-refresh"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      void this.refreshAccountSection();
    });

    panel.querySelector('[data-action="settings-admin-refresh"]')?.addEventListener("click", () => {
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

    const adminTokenInput = panel.querySelector("#settings-admin-token") as HTMLInputElement | null;
    const saveAdminToken = () => {
      adminApiService.setAdminToken(adminTokenInput?.value ?? "");
      void this.refreshAccountSection();
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
      void this.refreshAccountSection();
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
            notificationService.show(`Updated ${targetUid} role to ${roleLabel}`, "success", 1800);
          })
          .finally(() => {
            this.savingAdminRole = false;
            void this.refreshAccountSection();
          });
      });
    });
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
    } = {}
  ): string {
    const tokenValue = adminApiService.getAdminToken();
    const now = Date.now();
    const currentRole = this.normalizeAdminRoleValue(options.currentRole);
    const statusText = overview
      ? `Connected (${this.formatAdminAccessMode(overview.accessMode)})`
      : this.getAdminMonitorFailureMessage(reason, status);
    const statusTone = overview ? "ok" : reason === "network_error" ? "warn" : "error";
    const metricsMarkup = overview
      ? `
        <div class="settings-admin-metrics-grid">
          <div class="settings-admin-metric">
            <span>Active Rooms</span>
            <strong>${overview.metrics.activeSessionCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>Humans</span>
            <strong>${overview.metrics.humanCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>Bots</span>
            <strong>${overview.metrics.botCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>Public Base</span>
            <strong>${overview.metrics.publicDefaultCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>Overflow</span>
            <strong>${overview.metrics.publicOverflowCount}</strong>
          </div>
          <div class="settings-admin-metric">
            <span>Private</span>
            <strong>${overview.metrics.privateRoomCount}</strong>
          </div>
        </div>
      `
      : "";
    const roomsMarkup = overview
      ? this.renderAdminRoomListMarkup(overview, now)
      : `
        <p class="settings-admin-empty">
          Monitor data is unavailable right now. Configure token access or retry.
        </p>
      `;
    const roleLine = currentRole
      ? `Role: ${currentRole}${options.roleSource ? ` (${options.roleSource})` : ""}`
      : "Role: none";
    const roleManagerMarkup =
      currentRole === "owner"
        ? this.renderAdminRoleManagerMarkup(options.roleRecords, options.roleReason, options.roleStatus)
        : currentRole
          ? `<p class="settings-admin-empty">Role manager requires owner access.</p>`
          : `<p class="settings-admin-empty">Sign in with an admin role to manage endpoint access.</p>`;

    return `
      <div class="settings-admin-monitor">
        <div class="settings-admin-header">
          <div class="settings-admin-title">Dev Monitor</div>
          <div class="settings-admin-status settings-admin-status--${statusTone}">
            ${escapeHtml(statusText)}
          </div>
        </div>
        <div class="settings-admin-role">${escapeHtml(roleLine)}</div>
        <div class="settings-admin-actions">
          <button type="button" class="btn btn-secondary settings-account-btn" data-action="settings-admin-refresh">
            Refresh Monitor
          </button>
        </div>
        <div class="settings-admin-token-row">
          <label for="settings-admin-token">Admin Token</label>
          <div class="settings-account-name-inputs">
            <input
              id="settings-admin-token"
              type="password"
              placeholder="Optional for open mode"
              autocomplete="off"
              spellcheck="false"
              value="${escapeAttribute(tokenValue)}"
            />
            <button type="button" class="btn btn-primary settings-account-btn" data-action="settings-admin-save-token">
              Save
            </button>
            <button type="button" class="btn btn-outline settings-account-btn" data-action="settings-admin-clear-token">
              Clear
            </button>
          </div>
        </div>
        ${metricsMarkup}
        ${roomsMarkup}
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
          No known users yet. Ask users to sign in once before assigning roles.
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
                <option value="" ${normalizedRole === null ? "selected" : ""}>none</option>
                <option value="viewer" ${normalizedRole === "viewer" ? "selected" : ""}>viewer</option>
                <option value="operator" ${normalizedRole === "operator" ? "selected" : ""}>operator</option>
                <option value="owner" ${normalizedRole === "owner" ? "selected" : ""}>owner</option>
              </select>
              <button
                type="button"
                class="btn btn-secondary settings-account-btn"
                data-action="settings-admin-save-role"
                ${locked ? "disabled" : ""}
              >
                ${locked ? "Locked" : "Apply"}
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="settings-admin-role-manager">
        <div class="settings-admin-role-manager-title">Role Management</div>
        ${rows}
      </div>
    `;
  }

  private renderAdminRoomListMarkup(overview: AdminMonitorOverview, now: number): string {
    if (!overview.rooms.length) {
      return `
        <p class="settings-admin-empty">
          No active rooms currently.
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
          activeTurnPlayer?.displayName?.trim() || activeTurnPlayerId || "No active player";
        const phaseLabel = room.turnState ? this.formatAdminTurnPhase(room.turnState.phase) : "Waiting";
        const secondsToTurnExpire =
          room.turnState && typeof room.turnState.turnExpiresAt === "number"
            ? Math.max(0, Math.ceil((room.turnState.turnExpiresAt - now) / 1000))
            : null;
        const secondsToSessionExpire = Math.max(0, Math.ceil((room.expiresAt - now) / 1000));
        const roomTypeLabel = this.formatAdminRoomType(room.roomType);

        return `
          <div class="settings-admin-room-card">
            <div class="settings-admin-room-top">
              <div class="settings-admin-room-code">${escapeHtml(room.roomCode)}</div>
              <div class="settings-admin-room-type">${escapeHtml(roomTypeLabel)}</div>
            </div>
            <div class="settings-admin-room-meta">
              Humans ${room.humanCount}/${room.maxHumanCount} • Ready ${room.readyHumanCount} • Bots ${room.botCount} • Connected ${room.connectedSocketCount}
            </div>
            <div class="settings-admin-room-turn">
              <strong>${escapeHtml(activeTurnLabel)}</strong> • ${escapeHtml(phaseLabel)}
              ${secondsToTurnExpire === null ? "" : ` • turn ${secondsToTurnExpire}s`}
              • idle ${Math.floor(room.idleMs / 1000)}s • room ${secondsToSessionExpire}s
            </div>
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

  private getAdminMonitorFailureMessage(reason?: string, status?: number): string {
    switch (reason) {
      case "missing_admin_auth":
        return "Sign in or provide admin token";
      case "missing_admin_token":
        return "Admin token required by API";
      case "invalid_admin_token":
        return "Admin token rejected";
      case "missing_admin_role":
        return "Role value is required";
      case "admin_role_required":
        return "Admin role is required";
      case "admin_role_forbidden":
        return "Your role does not have permission";
      case "bootstrap_owner_locked":
        return "Bootstrap owner role is locked";
      case "missing_authorization_header":
      case "invalid_bearer_header":
      case "invalid_auth":
      case "anonymous_not_allowed":
        return "Sign in to access admin endpoints";
      case "invalid_admin_payload":
        return "Admin response shape was invalid";
      case "admin_disabled":
        return "Admin monitoring is disabled on server";
      case "network_error":
        return "Monitor request failed (network)";
      default: {
        if (status === 401) {
          return "Unauthorized (check auth token/role)";
        }
        if (status === 403) {
          return "Admin access denied";
        }
        if (status && Number.isFinite(status)) {
          return `Monitor request failed (HTTP ${status})`;
        }
        return "Monitor unavailable";
      }
    }
  }

  private formatAdminAccessMode(mode: string | undefined): string {
    switch (mode) {
      case "open":
        return "open mode";
      case "token":
        return "token mode";
      case "role":
        return "role mode";
      case "hybrid":
        return "hybrid mode";
      case "disabled":
        return "disabled";
      default:
        return "unknown";
    }
  }

  private normalizeAdminRoleValue(role: unknown): AdminUserRole | null {
    if (role === "viewer" || role === "operator" || role === "owner") {
      return role;
    }
    return null;
  }

  private formatAdminRoomType(roomType: string): string {
    switch (roomType) {
      case "public_default":
        return "Public Base";
      case "public_overflow":
        return "Public Overflow";
      default:
        return "Private";
    }
  }

  private formatAdminTurnPhase(phase: string): string {
    switch (phase) {
      case "await_roll":
        return "Await Roll";
      case "await_score":
        return "Await Score";
      case "ready_to_end":
        return "Ready To End";
      default:
        return "Waiting";
    }
  }

  private startAdminMonitorRefresh(): void {
    if (!environment.debug) {
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
    return (
      activeElement.id === "settings-leaderboard-name" ||
      activeElement.id === "settings-admin-token" ||
      activeElement.matches("select[data-admin-role-select]")
    );
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
        label: "Offline",
        tone: "offline",
        title: "Offline: local progress is cached and will sync when connection returns.",
      };
    }

    if (dataSync.state === "syncing" || leaderboardSync.state === "syncing") {
      return {
        label: "Syncing",
        tone: "syncing",
        title: "Sync in progress.",
      };
    }

    if (dataSync.state === "error" || leaderboardSync.state === "error") {
      return {
        label: "Retrying",
        tone: "error",
        title: "A recent sync attempt failed. The app will retry automatically.",
      };
    }

    if (pendingCount > 0 || dataSync.profileDirty) {
      return {
        label: pendingCount > 0 ? `Pending ${pendingCount}` : "Pending",
        tone: "pending",
        title: "There are local changes waiting to sync.",
      };
    }

    const latestSuccessAt = Math.max(
      dataSync.lastSuccessAt,
      leaderboardSync.lastSuccessAt,
      leaderboardSync.lastFetchedAt
    );
    const suffix =
      latestSuccessAt > 0
        ? ` Last update ${formatRelativeSyncTime(latestSuccessAt)}.`
        : "";

    return {
      label: "Up to date",
      tone: "ok",
      title: `All local data is synced.${suffix}`,
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
      easy: "✨ Shows hints highlighting best scoring choices. Future updates will add undo/redo options.",
      normal: "🎲 Standard BISCUITS rules. No hints or special assistance.",
      hard: "🔥 Coming soon: Stricter rules and no hints. For experienced players only.",
    };

    infoText.textContent = descriptions[difficulty];
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
    return "just now";
  }
  if (deltaMs < 10_000) {
    return "just now";
  }
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
    return true;
  }
  return navigator.onLine;
}
