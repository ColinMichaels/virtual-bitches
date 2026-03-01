/**
 * Debug View for testing dice rotations and texture mappings.
 * Includes routed notification monitor and protected admin debug controls.
 */

import { environment } from "@env";
import { DieKind } from "../engine/types.js";
import { DiceRenderer } from "../render/dice.js";
import { GameScene } from "../render/scene.js";
import { cameraService } from "../services/cameraService.js";
import {
  adminApiService,
  type AdminAuditEntry,
  type AdminMonitorMetrics,
  type AdminMonitorOverview,
  type AdminMonitorRoomParticipant,
  type AdminMonitorRoomSummary,
  type AdminMutationResult,
  type AdminRequestAuthOptions,
  type AdminSessionConductPlayerRecord,
} from "../services/adminApi.js";
import { firebaseAuthService } from "../services/firebaseAuth.js";
import { settingsService } from "../services/settings.js";
import { themeManager } from "../services/themeManager.js";
import { logger } from "../utils/logger.js";
import { confirmAction } from "./confirmModal.js";
import { notificationService } from "./notifications.js";

const log = logger.create("DebugView");
const LOCAL_DEBUG_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const ADMIN_MONITOR_REFRESH_MS = 7000;
const ADMIN_DEBUG_REQUESTER_ID = "admin-debug-console";

function isLocalDebugHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return LOCAL_DEBUG_HOSTNAMES.has(window.location.hostname);
}

const ENABLE_ADMIN_DEBUG_TAB = isLocalDebugHost();
const ALLOW_LOCAL_ADMIN_AUTH_BYPASS = isLocalDebugHost();

type DebugTab = "dice" | "camera" | "notifications" | "admin";
type AdminPanelTab = "moderation" | "stats";

interface AdminConductCacheEntry {
  players: AdminSessionConductPlayerRecord[];
  status?: number;
  reason?: string;
  timestamp: number;
  totalPlayerRecords: number;
}

const DICE_CONFIG: Array<{ kind: DieKind; faces: number; label: string }> = [
  { kind: "d4", faces: 4, label: "D4 (4 faces)" },
  { kind: "d6", faces: 6, label: "D6 (6 faces)" },
  { kind: "d8", faces: 8, label: "D8 (8 faces)" },
  { kind: "d10", faces: 10, label: "D10 (10 faces)" },
  { kind: "d12", faces: 12, label: "D12 (12 faces)" },
  { kind: "d20", faces: 20, label: "D20 (20 faces)" },
];

export class DebugView {
  private container!: HTMLElement;
  private isVisible = false;
  private diceRenderer: DiceRenderer;
  private scene: GameScene;
  private onToggle: (isDebugMode: boolean) => void;
  private currentDieIndex = 2; // Start with d8 (index 2)
  private useLightMaterial = false; // Toggle between dark/light material variants
  private activeTab: DebugTab = "dice";
  private dicePreviewActive = false;
  private cameraBeforeDicePreview: ReturnType<GameScene["getCameraPosition"]> | null = null;
  private cameraDebugMetricsHandle?: ReturnType<typeof setInterval>;

  private adminTabEnabled = false;
  private adminAccessStatusMessage = "Admin debug controls are disabled pending feature validation.";
  private adminPanelTab: AdminPanelTab = "moderation";
  private adminOverview: AdminMonitorOverview | null = null;
  private adminOverviewReason?: string;
  private adminOverviewStatus?: number;
  private adminAuditEntries: AdminAuditEntry[] | null = null;
  private adminAuditReason?: string;
  private adminAuditStatus?: number;
  private adminSelectedSessionId = "";
  private adminSelectedPlayerId = "";
  private adminWarningDraft = "Please keep gameplay and chat respectful. Continued violations may lead to removal.";
  private adminConductBySession = new Map<string, AdminConductCacheEntry>();
  private adminLastUpdatedAt = 0;
  private adminLoading = false;
  private adminActionInFlight = false;
  private adminRefreshHandle?: ReturnType<typeof setInterval>;

  private readonly onFirebaseAuthChanged = () => {
    this.refreshAdminTabAccess();
  };

  constructor(diceRenderer: DiceRenderer, scene: GameScene, onToggle: (isDebugMode: boolean) => void) {
    this.diceRenderer = diceRenderer;
    this.scene = scene;
    this.onToggle = onToggle;
    this.createUI();
  }

  private createUI(): void {
    this.container = document.createElement("div");
    this.container.id = "debug-view";
    this.container.className = "debug-view";
    this.container.style.display = "none";

    this.container.innerHTML = `
      <div class="debug-panel">
        <div class="settings-header debug-settings-header">
          <div class="modal-header">
            <h2>Debug View</h2>
            <button id="debug-close-btn" class="debug-close-btn" type="button" aria-label="Close debug view">✕</button>
          </div>

          <div class="settings-tabs debug-settings-tabs" role="tablist" aria-label="Debug tabs">
            <button class="settings-tab-btn active" type="button" data-debug-tab="dice">Dice Mapping</button>
            <button class="settings-tab-btn" type="button" data-debug-tab="camera">Camera Debug</button>
            <button class="settings-tab-btn debug-tab-btn-with-badge" type="button" data-debug-tab="notifications">
              <span>Debug Monitor</span>
              <span id="debug-notification-unread" class="notification-debug-unread is-hidden" aria-live="polite"></span>
            </button>
            <button
              class="settings-tab-btn debug-admin-tab"
              type="button"
              data-debug-tab="admin"
              disabled
              aria-disabled="true"
              title="Admin debug controls are not enabled yet"
            >
              Admin
            </button>
          </div>
        </div>

        <div class="settings-body debug-settings-body">
          <div class="settings-tab-panel is-active" data-debug-tab-panel="dice">
            <div class="settings-section">
              <h3>Dice Selection</h3>
              <p class="setting-description">Check each value shows the expected top face in the 3D scene.</p>
              <div class="debug-die-selector">
                <button id="debug-prev-btn" class="debug-nav-btn" type="button">← Prev</button>
                <div class="debug-die-info">
                  <h3 id="debug-die-label">D8 (8 faces)</h3>
                  <p>Check each value shows correct face</p>
                </div>
                <button id="debug-next-btn" class="debug-nav-btn" type="button">Next →</button>
              </div>
              <div class="debug-values" id="debug-values"></div>
            </div>

            <div class="settings-section debug-texture-controls-section">
              <h3>Texture Mapping Controls</h3>

              <div class="setting-row debug-setting-row">
                <label for="debug-theme-select">Theme</label>
                <select id="debug-theme-select" class="debug-theme-select"></select>
              </div>

              <div class="setting-row debug-setting-row">
                <label for="debug-material-variant">Material Variant</label>
                <select id="debug-material-variant" class="debug-material-variant">
                  <option value="dark">Dark (light pips)</option>
                  <option value="light">Light (dark pips)</option>
                </select>
              </div>

              <div class="setting-row debug-slider-row">
                <label for="scale-u-slider">Scale U</label>
                <input type="range" id="scale-u-slider" min="0.5" max="3.0" step="0.01" value="1.9">
                <span id="scale-u-value">1.9</span>
              </div>

              <div class="setting-row debug-slider-row">
                <label for="scale-v-slider">Scale V</label>
                <input type="range" id="scale-v-slider" min="0.5" max="3.0" step="0.01" value="1.9">
                <span id="scale-v-value">1.9</span>
              </div>

              <div class="setting-row debug-slider-row">
                <label for="offset-u-slider">Offset U</label>
                <input type="range" id="offset-u-slider" min="-0.5" max="0.5" step="0.01" value="0.05">
                <span id="offset-u-value">0.05</span>
              </div>

              <div class="setting-row debug-slider-row">
                <label for="offset-v-slider">Offset V</label>
                <input type="range" id="offset-v-slider" min="-0.5" max="0.5" step="0.01" value="0.05">
                <span id="offset-v-value">0.05</span>
              </div>

              <div class="debug-action-buttons">
                <button id="debug-save-btn" class="debug-save-btn" type="button">Save to Console</button>
                <button id="debug-reset-btn" class="debug-reset-btn" type="button">Reset to Theme Defaults</button>
              </div>
            </div>

            <div class="settings-section debug-info-section">
              <h3>Current Theme Info</h3>
              <div id="debug-theme-info"></div>
            </div>

            <div class="settings-section debug-instructions">
              <h3>Quick Instructions</h3>
              <ul>
                <li>Look at each die in the 3D scene.</li>
                <li>Verify the top face matches the label.</li>
                <li>Use Prev/Next to switch dice types.</li>
                <li>Adjust texture sliders and save values.</li>
              </ul>
              <p>
                For d10/d12/d20 with smooth-pip, fallback smooth-number textures are expected.
              </p>
            </div>
          </div>

          <div class="settings-tab-panel" data-debug-tab-panel="camera">
            <div class="settings-section">
              <h3>Camera Debug Controls</h3>
              <p class="setting-description">
                Save/load camera presets, inspect live camera values, and test view transitions.
              </p>

              <div class="debug-camera-metrics-grid">
                <div class="debug-camera-metric">
                  <span>Alpha</span>
                  <strong id="debug-camera-alpha">0.00</strong>
                </div>
                <div class="debug-camera-metric">
                  <span>Beta</span>
                  <strong id="debug-camera-beta">0.00</strong>
                </div>
                <div class="debug-camera-metric">
                  <span>Radius</span>
                  <strong id="debug-camera-radius">0.0</strong>
                </div>
                <div class="debug-camera-metric">
                  <span>Target</span>
                  <strong id="debug-camera-target">0.0, 0.0, 0.0</strong>
                </div>
              </div>

              <div class="debug-camera-view-buttons">
                <button class="btn btn-secondary settings-account-btn" type="button" data-action="debug-camera-view-default">Default</button>
                <button class="btn btn-secondary settings-account-btn" type="button" data-action="debug-camera-view-top">Top</button>
                <button class="btn btn-secondary settings-account-btn" type="button" data-action="debug-camera-view-side">Side</button>
                <button class="btn btn-secondary settings-account-btn" type="button" data-action="debug-camera-view-front">Front</button>
              </div>
            </div>

            <div class="settings-section">
              <h3>Preset Management</h3>
              <div class="setting-row">
                <label for="debug-camera-preset-name">Preset Name</label>
                <input
                  id="debug-camera-preset-name"
                  type="text"
                  maxlength="30"
                  placeholder="Camera preset name"
                />
              </div>
              <div class="debug-camera-preset-actions">
                <button class="btn btn-primary settings-account-btn" type="button" data-action="debug-camera-save-preset">Save Current</button>
                <button class="btn btn-outline settings-account-btn" type="button" data-action="debug-camera-open-manager">Open Full Manager</button>
              </div>
              <p id="debug-camera-slot-summary" class="setting-description"></p>
              <div id="debug-camera-preset-list" class="debug-camera-preset-list"></div>
            </div>

            <div class="settings-section">
              <h3>Transition Settings</h3>
              <div class="setting-row">
                <label>
                  <input id="debug-camera-smooth" type="checkbox" />
                  Smooth transitions
                </label>
              </div>
              <div class="setting-row">
                <label for="debug-camera-transition-duration">Transition Duration</label>
                <input id="debug-camera-transition-duration" type="range" min="0.2" max="2.5" step="0.05" />
                <span id="debug-camera-transition-duration-value">0.75s</span>
              </div>
              <div class="setting-row">
                <label for="debug-camera-sensitivity">Camera Sensitivity</label>
                <input id="debug-camera-sensitivity" type="range" min="0.5" max="2" step="0.05" />
                <span id="debug-camera-sensitivity-value">1.00x</span>
              </div>
            </div>
          </div>

          <div class="settings-tab-panel" data-debug-tab-panel="notifications">
            <div class="settings-section">
              <div class="notification-debug-header">
                <strong class="notification-debug-title">Debug Monitor</strong>
                <button id="debug-monitor-clear" type="button" class="notification-debug-clear">Clear</button>
              </div>
              <p class="setting-description">Inspect routed notifications and control channel visibility.</p>
              <div class="notification-debug-filters">
                <label class="notification-debug-filter">
                  <input id="debug-monitor-filter-gameplay" type="checkbox" />
                  <span>Gameplay</span>
                </label>
                <label class="notification-debug-filter">
                  <input id="debug-monitor-filter-private" type="checkbox" />
                  <span>Private</span>
                </label>
                <label class="notification-debug-filter">
                  <input id="debug-monitor-filter-debug" type="checkbox" />
                  <span>Debug</span>
                </label>
              </div>
              <div class="notification-debug-list-wrap debug-monitor-list-wrap">
                <ul id="debug-monitor-list" class="notification-debug-list" aria-live="polite"></ul>
              </div>
            </div>
          </div>

          <div class="settings-tab-panel" data-debug-tab-panel="admin">
            <div id="debug-admin-root" class="debug-admin-root"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.query<HTMLButtonElement>("#debug-close-btn")?.addEventListener("click", () => this.hide());
    this.query<HTMLButtonElement>("#debug-prev-btn")?.addEventListener("click", () => this.previousDie());
    this.query<HTMLButtonElement>("#debug-next-btn")?.addEventListener("click", () => this.nextDie());
    this.query<HTMLButtonElement>("#debug-save-btn")?.addEventListener("click", () => this.saveTextureSettings());
    this.query<HTMLButtonElement>("#debug-reset-btn")?.addEventListener("click", () => this.resetToThemeDefaults());

    this.query<HTMLSelectElement>("#debug-theme-select")?.addEventListener("change", (e) => {
      const themeName = (e.target as HTMLSelectElement).value;
      themeManager.setTheme(themeName);
      this.loadThemeTextureSettings();
      setTimeout(() => this.renderCurrentDie(), 500);
    });

    this.query<HTMLSelectElement>("#debug-material-variant")?.addEventListener("change", (e) => {
      this.useLightMaterial = (e.target as HTMLSelectElement).value === "light";
      this.renderCurrentDie();
    });

    this.query<HTMLInputElement>("#scale-u-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const valueEl = this.query<HTMLElement>("#scale-u-value");
      if (valueEl) {
        valueEl.textContent = value.toFixed(2);
      }
      this.updateTextureMapping();
    });

    this.query<HTMLInputElement>("#scale-v-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const valueEl = this.query<HTMLElement>("#scale-v-value");
      if (valueEl) {
        valueEl.textContent = value.toFixed(2);
      }
      this.updateTextureMapping();
    });

    this.query<HTMLInputElement>("#offset-u-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const valueEl = this.query<HTMLElement>("#offset-u-value");
      if (valueEl) {
        valueEl.textContent = value.toFixed(2);
      }
      this.updateTextureMapping();
    });

    this.query<HTMLInputElement>("#offset-v-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      const valueEl = this.query<HTMLElement>("#offset-v-value");
      if (valueEl) {
        valueEl.textContent = value.toFixed(2);
      }
      this.updateTextureMapping();
    });

    this.container.querySelectorAll<HTMLButtonElement>(".settings-tab-btn[data-debug-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.debugTab as DebugTab | undefined;
        if (!target || button.disabled) {
          return;
        }
        this.switchTab(target);
      });
    });

    const debugEntryList = this.query<HTMLElement>("#debug-monitor-list");
    const toggleGameplay = this.query<HTMLInputElement>("#debug-monitor-filter-gameplay");
    const togglePrivate = this.query<HTMLInputElement>("#debug-monitor-filter-private");
    const toggleDebug = this.query<HTMLInputElement>("#debug-monitor-filter-debug");
    if (debugEntryList && toggleGameplay && togglePrivate && toggleDebug) {
      notificationService.attachDebugMonitor({
        entryList: debugEntryList,
        toggleGameplay,
        togglePrivate,
        toggleDebug,
        unreadBadge: this.query<HTMLElement>("#debug-notification-unread"),
        clearButton: this.query<HTMLButtonElement>("#debug-monitor-clear"),
      });
    }

    const adminRoot = this.query<HTMLElement>("#debug-admin-root");
    adminRoot?.addEventListener("click", (event) => {
      void this.handleAdminClick(event);
    });
    adminRoot?.addEventListener("change", (event) => {
      void this.handleAdminChange(event);
    });
    adminRoot?.addEventListener("input", (event) => {
      this.handleAdminInput(event);
    });

    this.container.addEventListener("click", (event) => {
      void this.handleCameraDebugClick(event);
    });
    this.query<HTMLInputElement>("#debug-camera-smooth")?.addEventListener("change", () => {
      const smooth = this.query<HTMLInputElement>("#debug-camera-smooth")?.checked === true;
      const currentCameraSettings = this.getCameraSettingsSnapshot();
      settingsService.updateCamera({
        smoothTransitions: smooth,
        transitionDuration: currentCameraSettings.transitionDuration,
        sensitivity: currentCameraSettings.sensitivity,
      });
    });
    this.query<HTMLInputElement>("#debug-camera-transition-duration")?.addEventListener("input", () => {
      const slider = this.query<HTMLInputElement>("#debug-camera-transition-duration");
      const value = Number.parseFloat(slider?.value ?? "0.75");
      const safe = Number.isFinite(value) ? Math.max(0.2, Math.min(2.5, value)) : 0.75;
      const valueEl = this.query<HTMLElement>("#debug-camera-transition-duration-value");
      if (valueEl) {
        valueEl.textContent = `${safe.toFixed(2)}s`;
      }
      const currentCameraSettings = this.getCameraSettingsSnapshot();
      settingsService.updateCamera({
        smoothTransitions: currentCameraSettings.smoothTransitions,
        transitionDuration: safe,
        sensitivity: currentCameraSettings.sensitivity,
      });
    });
    this.query<HTMLInputElement>("#debug-camera-sensitivity")?.addEventListener("input", () => {
      const slider = this.query<HTMLInputElement>("#debug-camera-sensitivity");
      const value = Number.parseFloat(slider?.value ?? "1");
      const safe = Number.isFinite(value) ? Math.max(0.5, Math.min(2, value)) : 1;
      const valueEl = this.query<HTMLElement>("#debug-camera-sensitivity-value");
      if (valueEl) {
        valueEl.textContent = `${safe.toFixed(2)}x`;
      }
      const currentCameraSettings = this.getCameraSettingsSnapshot();
      settingsService.updateCamera({
        smoothTransitions: currentCameraSettings.smoothTransitions,
        transitionDuration: currentCameraSettings.transitionDuration,
        sensitivity: safe,
      });
    });

    this.populateThemeDropdown();
    this.refreshCameraDebugPanel();
    this.refreshAdminTabAccess();

    document.addEventListener("auth:firebaseUserChanged", this.onFirebaseAuthChanged as EventListener);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isVisible) {
        this.hide();
      }
    });
  }

  private query<T extends HTMLElement>(selector: string): T | null {
    return this.container.querySelector(selector) as T | null;
  }

  private updateNotificationMonitorOpenState(): void {
    notificationService.setDebugPanelOpen(this.isVisible && this.activeTab === "notifications");
  }

  private getCameraSettingsSnapshot(): {
    sensitivity: number;
    smoothTransitions: boolean;
    transitionDuration: number;
  } {
    const settings = settingsService.getSettings();
    const sensitivity = Number(settings.camera?.sensitivity ?? settings.controls.cameraSensitivity ?? 1);
    const transitionDuration = Number(settings.camera?.transitionDuration ?? 0.75);
    return {
      sensitivity: Number.isFinite(sensitivity) ? Math.max(0.5, Math.min(2, sensitivity)) : 1,
      smoothTransitions: settings.camera?.smoothTransitions === true,
      transitionDuration: Number.isFinite(transitionDuration)
        ? Math.max(0.2, Math.min(2.5, transitionDuration))
        : 0.75,
    };
  }

  private updateCameraDebugControlValues(): void {
    const settings = this.getCameraSettingsSnapshot();
    const smoothToggle = this.query<HTMLInputElement>("#debug-camera-smooth");
    const transitionSlider = this.query<HTMLInputElement>("#debug-camera-transition-duration");
    const transitionValue = this.query<HTMLElement>("#debug-camera-transition-duration-value");
    const sensitivitySlider = this.query<HTMLInputElement>("#debug-camera-sensitivity");
    const sensitivityValue = this.query<HTMLElement>("#debug-camera-sensitivity-value");

    if (smoothToggle) {
      smoothToggle.checked = settings.smoothTransitions;
    }
    if (transitionSlider) {
      transitionSlider.value = settings.transitionDuration.toFixed(2);
    }
    if (transitionValue) {
      transitionValue.textContent = `${settings.transitionDuration.toFixed(2)}s`;
    }
    if (sensitivitySlider) {
      sensitivitySlider.value = settings.sensitivity.toFixed(2);
    }
    if (sensitivityValue) {
      sensitivityValue.textContent = `${settings.sensitivity.toFixed(2)}x`;
    }
  }

  private updateCameraDebugMetrics(): void {
    const pose = this.scene.getCameraPosition();
    const alphaEl = this.query<HTMLElement>("#debug-camera-alpha");
    const betaEl = this.query<HTMLElement>("#debug-camera-beta");
    const radiusEl = this.query<HTMLElement>("#debug-camera-radius");
    const targetEl = this.query<HTMLElement>("#debug-camera-target");
    if (alphaEl) {
      alphaEl.textContent = pose.alpha.toFixed(2);
    }
    if (betaEl) {
      betaEl.textContent = pose.beta.toFixed(2);
    }
    if (radiusEl) {
      radiusEl.textContent = pose.radius.toFixed(2);
    }
    if (targetEl) {
      targetEl.textContent = `${pose.target.x.toFixed(1)}, ${pose.target.y.toFixed(1)}, ${pose.target.z.toFixed(1)}`;
    }
  }

  private refreshCameraDebugPresetList(): void {
    const list = this.query<HTMLElement>("#debug-camera-preset-list");
    const summary = this.query<HTMLElement>("#debug-camera-slot-summary");
    if (!list || !summary) {
      return;
    }

    const stats = cameraService.getStats();
    const maxSlots = stats.maxSlots === Infinity ? "∞" : String(stats.maxSlots);
    summary.textContent = `${stats.positionCount}/${maxSlots} presets saved`;
    const positions = cameraService.listPositions();
    if (!positions.length) {
      list.innerHTML = `<p class="settings-admin-empty">No camera presets saved yet.</p>`;
      return;
    }

    list.innerHTML = positions
      .map((position) => {
        const details = `α ${position.alpha.toFixed(2)} • β ${position.beta.toFixed(2)} • r ${position.radius.toFixed(1)}`;
        return `
          <div class="debug-camera-preset-item" data-preset-id="${escapeAttribute(position.id)}">
            <div class="debug-camera-preset-main">
              <strong>${position.isFavorite ? "⭐ " : ""}${escapeHtml(position.name)}</strong>
              <span>${escapeHtml(details)}</span>
            </div>
            <div class="debug-camera-preset-actions">
              <button type="button" class="btn btn-secondary settings-account-btn" data-action="debug-camera-load-preset" data-preset-id="${escapeAttribute(position.id)}">Load</button>
              <button type="button" class="btn btn-outline settings-account-btn" data-action="debug-camera-favorite-preset" data-preset-id="${escapeAttribute(position.id)}">${position.isFavorite ? "Unpin" : "Pin"}</button>
              <button type="button" class="btn btn-danger settings-account-btn" data-action="debug-camera-delete-preset" data-preset-id="${escapeAttribute(position.id)}">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  private startCameraDebugMetricsLoop(): void {
    this.stopCameraDebugMetricsLoop();
    this.cameraDebugMetricsHandle = setInterval(() => {
      this.updateCameraDebugMetrics();
    }, 180);
  }

  private stopCameraDebugMetricsLoop(): void {
    if (!this.cameraDebugMetricsHandle) {
      return;
    }
    clearInterval(this.cameraDebugMetricsHandle);
    this.cameraDebugMetricsHandle = undefined;
  }

  private refreshCameraDebugPanel(): void {
    this.updateCameraDebugControlValues();
    this.updateCameraDebugMetrics();
    this.refreshCameraDebugPresetList();
  }

  private switchTab(tab: DebugTab): void {
    this.activeTab = tab;
    this.container.querySelectorAll<HTMLElement>(".settings-tab-btn[data-debug-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.debugTab === tab);
    });
    this.container.querySelectorAll<HTMLElement>(".settings-tab-panel[data-debug-tab-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.debugTabPanel === tab);
    });
    this.updateNotificationMonitorOpenState();
    this.setDicePreviewActive(tab === "dice");
    if (tab === "camera") {
      this.refreshCameraDebugPanel();
      this.startCameraDebugMetricsLoop();
    } else {
      this.stopCameraDebugMetricsLoop();
    }
    this.updateAdminRefreshLoop();

    if (tab === "admin" && this.adminTabEnabled) {
      void this.refreshAdminData({ force: false });
    }
  }

  private setDicePreviewActive(active: boolean): void {
    if (active === this.dicePreviewActive) {
      return;
    }

    this.dicePreviewActive = active;
    if (active) {
      this.cameraBeforeDicePreview = this.scene.getCameraPosition();
      this.scene.setCameraView("debug");
      this.loadThemeTextureSettings();
      this.updateThemeInfo();
      this.renderCurrentDie();
      return;
    }

    this.diceRenderer.clearDebugDice();
    if (this.cameraBeforeDicePreview) {
      this.restoreCameraPose(this.cameraBeforeDicePreview);
      this.cameraBeforeDicePreview = null;
      return;
    }
    this.scene.setCameraView("default");
  }

  private restoreCameraPose(pose: ReturnType<GameScene["getCameraPosition"]>): void {
    this.scene.setCameraPosition(
      {
        id: "debug-view-restore",
        name: "Debug Restore",
        alpha: pose.alpha,
        beta: pose.beta,
        radius: pose.radius,
        target: { ...pose.target },
        createdAt: Date.now(),
        isFavorite: false,
      },
      false
    );
  }

  private switchAdminPanelTab(tab: AdminPanelTab): void {
    this.adminPanelTab = tab;
    this.renderAdminPanel();
  }

  private refreshAdminTabAccess(): void {
    const adminTabButton = this.query<HTMLButtonElement>('.settings-tab-btn[data-debug-tab="admin"]');
    if (!adminTabButton) {
      return;
    }

    const authConfigured = firebaseAuthService.isConfigured();
    const isAuthenticated = firebaseAuthService.isAuthenticated();
    const environmentAllows = environment.adminUiEnabled || environment.debug;
    const authSatisfied =
      !authConfigured || isAuthenticated || (ALLOW_LOCAL_ADMIN_AUTH_BYPASS && environment.debug);
    const isAdminTabEnabled = ENABLE_ADMIN_DEBUG_TAB && environmentAllows && authSatisfied;

    this.adminTabEnabled = isAdminTabEnabled;
    adminTabButton.disabled = !isAdminTabEnabled;
    adminTabButton.setAttribute("aria-disabled", isAdminTabEnabled ? "false" : "true");
    adminTabButton.classList.toggle("is-locked", !isAdminTabEnabled);

    if (isAdminTabEnabled) {
      if (ALLOW_LOCAL_ADMIN_AUTH_BYPASS && authConfigured && !isAuthenticated) {
        this.adminAccessStatusMessage =
          "Admin debug controls are enabled for local testing (auth bypass active).";
      } else {
        this.adminAccessStatusMessage = "Admin debug controls are enabled for this profile.";
      }
    } else {
      const reasons: string[] = [];
      if (!ENABLE_ADMIN_DEBUG_TAB) {
        reasons.push("local debug host access is required");
      }
      if (!environmentAllows) {
        reasons.push("environment access is disabled");
      }
      if (!authSatisfied && authConfigured && !isAuthenticated) {
        reasons.push("an authenticated account is required");
      }
      const detail = reasons.length > 0 ? reasons.join(", ") : "access requirements are not met";
      this.adminAccessStatusMessage = `Admin debug controls are currently locked: ${detail}.`;
    }

    if (!isAdminTabEnabled && this.activeTab === "admin") {
      this.switchTab("dice");
    }

    this.renderAdminPanel();
    this.updateAdminRefreshLoop();

    if (isAdminTabEnabled && this.activeTab === "admin" && this.isVisible) {
      void this.refreshAdminData({ force: false });
    }
  }

  private updateAdminRefreshLoop(): void {
    const shouldRun = this.isVisible && this.activeTab === "admin" && this.adminTabEnabled;
    if (!shouldRun) {
      if (this.adminRefreshHandle) {
        clearInterval(this.adminRefreshHandle);
        this.adminRefreshHandle = undefined;
      }
      return;
    }

    if (this.adminRefreshHandle) {
      return;
    }

    this.adminRefreshHandle = setInterval(() => {
      if (this.adminActionInFlight) {
        return;
      }
      void this.refreshAdminData({ force: false });
    }, ADMIN_MONITOR_REFRESH_MS);
  }

  private async getAdminRequestAuthOptions(): Promise<AdminRequestAuthOptions> {
    const firebaseIdToken = await firebaseAuthService.getIdToken();
    const adminToken = adminApiService.getAdminToken();
    return {
      firebaseIdToken,
      adminToken,
    };
  }

  private async refreshAdminData(options: { force?: boolean } = {}): Promise<void> {
    if (!this.adminTabEnabled) {
      return;
    }
    if (this.adminLoading && !options.force) {
      return;
    }

    this.adminLoading = true;
    this.renderAdminPanel();

    try {
      const authOptions = await this.getAdminRequestAuthOptions();
      const [overviewResult, auditResult] = await Promise.all([
        adminApiService.getOverview(24, authOptions),
        adminApiService.getAudit(60, authOptions),
      ]);

      this.adminOverview = overviewResult.overview;
      this.adminOverviewReason = overviewResult.reason;
      this.adminOverviewStatus = overviewResult.status;

      this.adminAuditEntries = auditResult.entries;
      this.adminAuditReason = auditResult.reason;
      this.adminAuditStatus = auditResult.status;

      this.syncAdminSelections();
      if (this.adminSelectedSessionId) {
        await this.refreshConductForSession(this.adminSelectedSessionId, authOptions);
      }
      this.adminLastUpdatedAt = Date.now();
    } catch (error) {
      log.warn("Failed to refresh debug admin panel", error);
      this.adminOverview = null;
      this.adminOverviewReason = "network_error";
      this.adminOverviewStatus = undefined;
      this.adminAuditEntries = null;
      this.adminAuditReason = "network_error";
      this.adminAuditStatus = undefined;
    } finally {
      this.adminLoading = false;
      this.renderAdminPanel();
    }
  }

  private async refreshConductForSession(
    sessionId: string,
    authOptions: AdminRequestAuthOptions
  ): Promise<void> {
    const normalized = sessionId.trim();
    if (!normalized) {
      return;
    }

    const conductResult = await adminApiService.getSessionConductState(normalized, 300, authOptions);
    if (!conductResult.conduct) {
      this.adminConductBySession.set(normalized, {
        players: [],
        status: conductResult.status,
        reason: conductResult.reason,
        timestamp: Date.now(),
        totalPlayerRecords: 0,
      });
      return;
    }

    this.adminConductBySession.set(normalized, {
      players: conductResult.conduct.players,
      status: conductResult.status,
      reason: conductResult.reason,
      timestamp: conductResult.conduct.timestamp,
      totalPlayerRecords: conductResult.conduct.totalPlayerRecords,
    });
  }

  private syncAdminSelections(): void {
    const rooms = this.adminOverview?.rooms ?? [];
    if (!rooms.length) {
      this.adminSelectedSessionId = "";
      this.adminSelectedPlayerId = "";
      return;
    }

    const selectedRoom = rooms.find((room) => room.sessionId === this.adminSelectedSessionId) ?? rooms[0];
    this.adminSelectedSessionId = selectedRoom.sessionId;

    const candidates = this.getRoomModerationCandidates(selectedRoom);
    if (!candidates.length) {
      this.adminSelectedPlayerId = "";
      return;
    }

    const playerExists = candidates.some((player) => player.playerId === this.adminSelectedPlayerId);
    if (!playerExists) {
      this.adminSelectedPlayerId = candidates[0].playerId;
    }
  }

  private getSelectedRoom(): AdminMonitorRoomSummary | null {
    if (!this.adminOverview?.rooms?.length) {
      return null;
    }
    return (
      this.adminOverview.rooms.find((room) => room.sessionId === this.adminSelectedSessionId) ??
      this.adminOverview.rooms[0] ??
      null
    );
  }

  private getRoomModerationCandidates(room: AdminMonitorRoomSummary): AdminMonitorRoomParticipant[] {
    return room.participants.filter((participant) => !participant.isBot);
  }

  private getSelectedPlayer(room: AdminMonitorRoomSummary | null): AdminMonitorRoomParticipant | null {
    if (!room) {
      return null;
    }
    const candidates = this.getRoomModerationCandidates(room);
    if (!candidates.length) {
      return null;
    }
    return candidates.find((participant) => participant.playerId === this.adminSelectedPlayerId) ?? candidates[0];
  }

  private getConductEntry(sessionId: string): AdminConductCacheEntry | null {
    return this.adminConductBySession.get(sessionId) ?? null;
  }

  private getSelectedPlayerConductRecord(
    sessionId: string,
    playerId: string
  ): AdminSessionConductPlayerRecord | null {
    const entry = this.getConductEntry(sessionId);
    if (!entry) {
      return null;
    }
    return entry.players.find((record) => record.playerId === playerId) ?? null;
  }

  private renderAdminPanel(): void {
    const adminRoot = this.query<HTMLElement>("#debug-admin-root");
    if (!adminRoot) {
      return;
    }

    if (!this.adminTabEnabled) {
      adminRoot.innerHTML = `
        <div class="settings-section">
          <h3>Admin Debug (Protected)</h3>
          <p class="setting-description">${escapeHtml(this.adminAccessStatusMessage)}</p>
        </div>
      `;
      return;
    }

    const tokenValue = adminApiService.getAdminToken();
    const room = this.getSelectedRoom();
    const player = this.getSelectedPlayer(room);

    const statusText = this.adminOverview
      ? `Connected (${this.adminOverview.accessMode})`
      : this.getAdminFailureMessage(this.adminOverviewReason, this.adminOverviewStatus);
    const statusTone = this.adminOverview
      ? "ok"
      : this.adminOverviewReason === "network_error"
        ? "warn"
        : "error";

    const roomOptions = (this.adminOverview?.rooms ?? [])
      .map((entry) => {
        const label = `${entry.roomCode} • ${entry.humanCount}/${entry.maxHumanCount} humans`;
        return `<option value="${escapeAttribute(entry.sessionId)}" ${entry.sessionId === this.adminSelectedSessionId ? "selected" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");

    const playerOptions = room
      ? this.getRoomModerationCandidates(room)
          .map((entry) => {
            const label = entry.displayName?.trim() || entry.playerId;
            return `<option value="${escapeAttribute(entry.playerId)}" ${entry.playerId === player?.playerId ? "selected" : ""}>${escapeHtml(label)}</option>`;
          })
          .join("")
      : "";

    const conductRecord =
      room && player
        ? this.getSelectedPlayerConductRecord(room.sessionId, player.playerId)
        : null;
    const conductEntry = room ? this.getConductEntry(room.sessionId) : null;
    const conductInfoMarkup = this.renderConductInfoMarkup(player, conductRecord, conductEntry);
    const playerFlagsMarkup = this.renderPlayerFlagsMarkup(player);

    const canRunPlayerActions =
      !this.adminActionInFlight &&
      !this.adminLoading &&
      Boolean(room && player);

    const moderationPanelMarkup = `
      <div class="settings-tab-panel ${this.adminPanelTab === "moderation" ? "is-active" : ""}" data-debug-admin-tab-panel="moderation">
        <div class="settings-section">
          <h3>Player Moderation</h3>
          <p class="setting-description">Warn, kick, or ban room participants while monitoring conduct strikes and player flags.</p>

          <div class="setting-row debug-setting-row">
            <label for="debug-admin-room-select">Room</label>
            <select id="debug-admin-room-select" ${this.adminActionInFlight ? "disabled" : ""}>
              ${roomOptions || "<option value=\"\">No active rooms</option>"}
            </select>
          </div>

          <div class="setting-row debug-setting-row">
            <label for="debug-admin-player-select">Player</label>
            <select id="debug-admin-player-select" ${canRunPlayerActions ? "" : "disabled"}>
              ${playerOptions || "<option value=\"\">No human players</option>"}
            </select>
          </div>

          <div class="debug-admin-info-grid">
            <div class="debug-admin-info-card">
              <div class="debug-admin-info-title">Player Flags</div>
              ${playerFlagsMarkup}
            </div>
            <div class="debug-admin-info-card">
              <div class="debug-admin-info-title">Conduct / Strikes</div>
              ${conductInfoMarkup}
            </div>
          </div>

          <div class="setting-row debug-setting-row debug-admin-warning-row">
            <label for="debug-admin-warning-text">Warning</label>
            <textarea
              id="debug-admin-warning-text"
              rows="2"
              maxlength="280"
              placeholder="Type warning message"
              ${canRunPlayerActions ? "" : "disabled"}
            >${escapeHtml(this.adminWarningDraft)}</textarea>
          </div>

          <div class="debug-admin-action-row">
            <button type="button" class="btn btn-outline settings-account-btn" data-action="debug-admin-warn-player" ${canRunPlayerActions ? "" : "disabled"}>Warn</button>
            <button type="button" class="btn btn-secondary settings-account-btn" data-action="debug-admin-kick-player" ${canRunPlayerActions ? "" : "disabled"}>Kick</button>
            <button type="button" class="btn btn-danger settings-account-btn" data-action="debug-admin-ban-player" ${canRunPlayerActions ? "" : "disabled"}>Ban</button>
          </div>
        </div>
      </div>
    `;

    const statsPanelMarkup = `
      <div class="settings-tab-panel ${this.adminPanelTab === "stats" ? "is-active" : ""}" data-debug-admin-tab-panel="stats">
        <div class="settings-section">
          <h3>Game Stats & Log Viewer</h3>
          <p class="setting-description">Live room metrics, queue/turn health, and latest admin activity stream.</p>
          ${this.renderAdminMetricsMarkup(this.adminOverview?.metrics ?? null)}
        </div>

        <div class="settings-section">
          <h3>Live Room Snapshot</h3>
          ${this.renderRoomSnapshotMarkup(this.adminOverview?.rooms ?? [])}
        </div>

        <div class="settings-section">
          <h3>Play-by-Play Logs (Admin Audit)</h3>
          ${this.renderAuditMarkup(this.adminAuditEntries, this.adminAuditReason, this.adminAuditStatus)}
        </div>

        <div class="settings-section debug-admin-future-section">
          <h3>Future Features</h3>
          <ul>
            <li>Graph dashboards for room throughput and retention trends.</li>
            <li>Historical game trends, play percentages, and difficulty mix.</li>
            <li>Game history explorer with searchable event timeline.</li>
          </ul>
        </div>
      </div>
    `;

    const updatedLabel = this.adminLastUpdatedAt
      ? `Last update: ${escapeHtml(formatTimestamp(this.adminLastUpdatedAt))}`
      : "Last update: not yet loaded";

    adminRoot.innerHTML = `
      <div class="settings-section">
        <h3>Admin Debug (Protected)</h3>
        <p id="debug-admin-status" class="setting-description">${escapeHtml(this.adminAccessStatusMessage)}</p>

        <div class="settings-admin-monitor debug-admin-monitor-shell">
          <div class="settings-admin-header">
            <div class="settings-admin-title">Admin Monitor</div>
            <div class="settings-admin-status settings-admin-status--${statusTone}">${escapeHtml(statusText)}</div>
          </div>

          <div class="debug-admin-meta-row">
            <span>${updatedLabel}</span>
            ${this.adminLoading ? "<span>Refreshing...</span>" : ""}
          </div>

          <div class="settings-admin-token-row">
            <label for="debug-admin-token">Admin Token</label>
            <div class="settings-account-name-inputs">
              <input
                id="debug-admin-token"
                type="password"
                autocomplete="off"
                spellcheck="false"
                value="${escapeAttribute(tokenValue)}"
                placeholder="Optional x-admin-token"
                ${this.adminActionInFlight ? "disabled" : ""}
              />
              <button type="button" class="btn btn-primary settings-account-btn" data-action="debug-admin-save-token" ${this.adminActionInFlight ? "disabled" : ""}>Save</button>
              <button type="button" class="btn btn-outline settings-account-btn" data-action="debug-admin-clear-token" ${this.adminActionInFlight ? "disabled" : ""}>Clear</button>
              <button type="button" class="btn btn-secondary settings-account-btn" data-action="debug-admin-refresh" ${this.adminActionInFlight ? "disabled" : ""}>Refresh</button>
            </div>
          </div>

          <div class="settings-tabs debug-admin-subtabs" role="tablist" aria-label="Admin debug tabs">
            <button class="settings-tab-btn ${this.adminPanelTab === "moderation" ? "active" : ""}" type="button" data-debug-admin-tab="moderation">Player Moderation</button>
            <button class="settings-tab-btn ${this.adminPanelTab === "stats" ? "active" : ""}" type="button" data-debug-admin-tab="stats">Game Stats & Logs</button>
          </div>

          ${moderationPanelMarkup}
          ${statsPanelMarkup}
        </div>
      </div>
    `;
  }

  private renderPlayerFlagsMarkup(player: AdminMonitorRoomParticipant | null): string {
    if (!player) {
      return `<p class="settings-admin-empty">Select a player to view flags.</p>`;
    }

    const flags = [
      `Connected: ${player.connected ? "yes" : "no"}`,
      `Seated: ${player.isSeated === true ? "yes" : "no"}`,
      `Ready: ${player.isReady ? "yes" : "no"}`,
      `Turn Complete: ${player.isComplete ? "yes" : "no"}`,
      `Queued Next Round: ${player.queuedForNextGame === true ? "yes" : "no"}`,
    ];

    return `
      <ul class="debug-admin-flag-list">
        ${flags.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}
      </ul>
    `;
  }

  private renderConductInfoMarkup(
    player: AdminMonitorRoomParticipant | null,
    record: AdminSessionConductPlayerRecord | null,
    entry: AdminConductCacheEntry | null
  ): string {
    if (!player) {
      return `<p class="settings-admin-empty">Select a player to view conduct status.</p>`;
    }

    if (!entry) {
      return `<p class="settings-admin-empty">Conduct snapshot not loaded yet.</p>`;
    }

    if (!record) {
      if (entry.reason) {
        return `<p class="settings-admin-empty">Conduct data unavailable: ${escapeHtml(this.getAdminFailureMessage(entry.reason, entry.status))}</p>`;
      }
      return `<p class="settings-admin-empty">No strike record for this player in this room.</p>`;
    }

    const muteLabel = record.isMuted
      ? `Muted (${formatMsAsSeconds(record.muteRemainingMs)} remaining)`
      : "Not muted";

    return `
      <div class="debug-admin-conduct-list">
        <div><span>Current Strikes</span><strong>${record.strikeCount}</strong></div>
        <div><span>Total Strikes</span><strong>${record.totalStrikes}</strong></div>
        <div><span>Mute Status</span><strong>${escapeHtml(muteLabel)}</strong></div>
        <div><span>Last Violation</span><strong>${escapeHtml(formatTimestamp(record.lastViolationAt))}</strong></div>
      </div>
    `;
  }

  private renderAdminMetricsMarkup(metrics: AdminMonitorMetrics | null): string {
    if (!metrics) {
      return `<p class="settings-admin-empty">Metrics unavailable until monitor data loads.</p>`;
    }

    const cards: Array<{ label: string; value: string | number }> = [
      { label: "Active Rooms", value: metrics.activeSessionCount },
      { label: "Humans", value: metrics.humanCount },
      { label: "Bots", value: metrics.botCount },
      { label: "Ready Humans", value: metrics.readyHumanCount },
      { label: "Connected Sockets", value: metrics.connectedSocketCount },
      { label: "Conduct Tracked", value: Math.max(0, Math.floor(metrics.conductTrackedPlayerCount ?? 0)) },
      { label: "Conduct Muted", value: Math.max(0, Math.floor(metrics.conductMutedPlayerCount ?? 0)) },
      { label: "Turn Timeout Auto", value: metrics.turnTimeoutAutoAdvanceCount },
      { label: "Bot Auto Advance", value: metrics.botTurnAutoAdvanceCount },
    ];

    return `
      <div class="settings-admin-metrics-grid debug-admin-metrics-grid">
        ${cards
          .map(
            (card) => `
              <div class="settings-admin-metric">
                <span>${escapeHtml(card.label)}</span>
                <strong>${escapeHtml(String(card.value))}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  private renderRoomSnapshotMarkup(rooms: AdminMonitorRoomSummary[]): string {
    if (!rooms.length) {
      return `<p class="settings-admin-empty">No active rooms reported.</p>`;
    }

    const rows = rooms
      .slice(0, 12)
      .map((room) => {
        const turnLabel = room.turnState?.activeTurnPlayerId ?? "none";
        const phaseLabel = room.turnState?.phase ?? "waiting";
        const meta = `${room.humanCount}/${room.maxHumanCount} humans • ${room.botCount} bots • ${room.connectedSocketCount} connected`;
        return `
          <div class="settings-admin-room-card">
            <div class="settings-admin-room-top">
              <div class="settings-admin-room-code">${escapeHtml(room.roomCode)}</div>
              <div class="settings-admin-room-type">${escapeHtml(room.roomType)}</div>
            </div>
            <div class="settings-admin-room-meta">${escapeHtml(meta)}</div>
            <div class="settings-admin-room-turn">
              <strong>${escapeHtml(turnLabel)}</strong> • ${escapeHtml(phaseLabel)} • idle ${escapeHtml(formatMsAsSeconds(room.idleMs))}
            </div>
          </div>
        `;
      })
      .join("");

    return `<div class="settings-admin-room-list">${rows}</div>`;
  }

  private renderAuditMarkup(
    auditEntries: AdminAuditEntry[] | null,
    reason?: string,
    status?: number
  ): string {
    if (!auditEntries) {
      return `
        <p class="settings-admin-empty">
          Audit unavailable: ${escapeHtml(this.getAdminFailureMessage(reason, status))}
        </p>
      `;
    }

    if (!auditEntries.length) {
      return `<p class="settings-admin-empty">No admin audit entries recorded yet.</p>`;
    }

    const rows = auditEntries
      .slice(0, 40)
      .map((entry) => {
        const actor =
          entry.actor.uid?.trim() ||
          entry.actor.email?.trim() ||
          entry.actor.authType?.trim() ||
          "unknown";
        const summary =
          entry.summary?.trim() ||
          `${entry.action}${entry.target.sessionId ? ` • ${entry.target.sessionId}` : ""}`;

        return `
          <div class="settings-admin-audit-row">
            <div class="settings-admin-audit-main">
              <strong>${escapeHtml(entry.action)}</strong>
              <span>${escapeHtml(summary)}</span>
            </div>
            <div class="settings-admin-audit-meta">
              <span>${escapeHtml(actor)}</span>
              <span>${escapeHtml(formatTimestamp(entry.timestamp))}</span>
            </div>
          </div>
        `;
      })
      .join("");

    return `<div class="settings-admin-audit-list">${rows}</div>`;
  }

  private getAdminFailureMessage(reason?: string, status?: number): string {
    switch (reason) {
      case "missing_admin_auth":
        return "missing admin credentials";
      case "missing_admin_token":
        return "missing admin token";
      case "invalid_admin_token":
        return "invalid admin token";
      case "missing_admin_role":
        return "missing admin role";
      case "admin_role_required":
      case "admin_role_forbidden":
        return "admin role permissions required";
      case "invalid_session_id":
        return "invalid session";
      case "invalid_player_id":
        return "invalid player";
      case "unknown_session":
        return "session not found";
      case "unknown_player":
        return "player not found";
      case "network_error":
        return "network error";
      case "missing_message":
        return "warning message is required";
      case "missing_target_player":
        return "target player required";
      default: {
        if (status === 401) {
          return "unauthorized";
        }
        if (status === 403) {
          return "forbidden";
        }
        if (status && Number.isFinite(status)) {
          return `HTTP ${status}`;
        }
        return reason || "unavailable";
      }
    }
  }

  private async handleCameraDebugClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) {
      return;
    }

    const action = button.dataset.action;
    if (!action || !action.startsWith("debug-camera-")) {
      return;
    }

    if (action === "debug-camera-view-default") {
      this.scene.setCameraView("default");
      this.updateCameraDebugMetrics();
      return;
    }
    if (action === "debug-camera-view-top") {
      this.scene.setCameraView("top");
      this.updateCameraDebugMetrics();
      return;
    }
    if (action === "debug-camera-view-side") {
      this.scene.setCameraView("side");
      this.updateCameraDebugMetrics();
      return;
    }
    if (action === "debug-camera-view-front") {
      this.scene.setCameraView("front");
      this.updateCameraDebugMetrics();
      return;
    }
    if (action === "debug-camera-open-manager") {
      document.dispatchEvent(new CustomEvent("camera:openControls"));
      return;
    }
    if (action === "debug-camera-save-preset") {
      const input = this.query<HTMLInputElement>("#debug-camera-preset-name");
      const desiredName = input?.value.trim() || `Preset ${cameraService.listPositions().length + 1}`;
      const pose = this.scene.getCameraPosition();
      const id = cameraService.savePosition(desiredName, {
        alpha: pose.alpha,
        beta: pose.beta,
        radius: pose.radius,
        target: { ...pose.target },
      });
      if (!id) {
        notificationService.show("Camera preset limit reached for current tier.", "warning", 2400);
        return;
      }
      if (input) {
        input.value = "";
      }
      notificationService.show(`Saved preset: ${desiredName}`, "success", 1800);
      this.refreshCameraDebugPresetList();
      return;
    }

    const presetId = button.dataset.presetId?.trim() || "";
    if (!presetId) {
      return;
    }

    if (action === "debug-camera-load-preset") {
      const preset = cameraService.loadPosition(presetId);
      if (!preset) {
        notificationService.show("Camera preset not found.", "warning", 2000);
        this.refreshCameraDebugPresetList();
        return;
      }
      this.scene.setCameraPosition(preset, true);
      this.updateCameraDebugMetrics();
      return;
    }

    if (action === "debug-camera-favorite-preset") {
      cameraService.toggleFavorite(presetId);
      this.refreshCameraDebugPresetList();
      return;
    }

    if (action === "debug-camera-delete-preset") {
      const preset = cameraService.listPositions().find((entry) => entry.id === presetId);
      if (!preset) {
        this.refreshCameraDebugPresetList();
        return;
      }
      const confirmed = await confirmAction({
        title: `Delete ${preset.name}?`,
        message: "This camera preset will be removed from local saved views.",
        confirmLabel: "Delete Preset",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      cameraService.deletePosition(presetId);
      this.refreshCameraDebugPresetList();
    }
  }

  private async handleAdminClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    const button = target.closest<HTMLButtonElement>("button[data-action], button[data-debug-admin-tab]");
    if (!button) {
      return;
    }

    const tabTarget = button.dataset.debugAdminTab as AdminPanelTab | undefined;
    if (tabTarget) {
      this.switchAdminPanelTab(tabTarget);
      return;
    }

    const action = button.dataset.action;
    if (!action || this.adminActionInFlight) {
      return;
    }

    if (action === "debug-admin-refresh") {
      await this.refreshAdminData({ force: true });
      return;
    }

    if (action === "debug-admin-save-token") {
      const input = this.query<HTMLInputElement>("#debug-admin-token");
      adminApiService.setAdminToken(input?.value ?? "");
      notificationService.show("Admin token saved", "success", 1800);
      await this.refreshAdminData({ force: true });
      return;
    }

    if (action === "debug-admin-clear-token") {
      adminApiService.setAdminToken("");
      notificationService.show("Admin token cleared", "info", 1800);
      await this.refreshAdminData({ force: true });
      return;
    }

    if (action === "debug-admin-warn-player") {
      await this.warnSelectedPlayer();
      return;
    }

    if (action === "debug-admin-kick-player") {
      await this.kickSelectedPlayer();
      return;
    }

    if (action === "debug-admin-ban-player") {
      await this.banSelectedPlayer();
    }
  }

  private async handleAdminChange(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.id === "debug-admin-room-select") {
      const select = target as HTMLSelectElement;
      this.adminSelectedSessionId = select.value;
      const room = this.getSelectedRoom();
      const fallbackPlayer = room ? this.getRoomModerationCandidates(room)[0] : null;
      this.adminSelectedPlayerId = fallbackPlayer?.playerId ?? "";
      this.renderAdminPanel();
      if (this.adminSelectedSessionId) {
        const authOptions = await this.getAdminRequestAuthOptions();
        await this.refreshConductForSession(this.adminSelectedSessionId, authOptions);
        this.renderAdminPanel();
      }
      return;
    }

    if (target.id === "debug-admin-player-select") {
      const select = target as HTMLSelectElement;
      this.adminSelectedPlayerId = select.value;
      this.renderAdminPanel();
    }
  }

  private handleAdminInput(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (target.id === "debug-admin-warning-text") {
      this.adminWarningDraft = (target as HTMLTextAreaElement).value;
    }
  }

  private async warnSelectedPlayer(): Promise<void> {
    const room = this.getSelectedRoom();
    const player = this.getSelectedPlayer(room);
    if (!room || !player) {
      notificationService.show("Select a room/player before warning.", "warning", 2200);
      return;
    }

    const warningMessage = this.adminWarningDraft.trim();
    if (!warningMessage) {
      notificationService.show("Warning message cannot be empty.", "warning", 2200);
      return;
    }

    await this.runAdminMutation("warn", async (authOptions) =>
      adminApiService.sendSessionChannelMessage(
        room.sessionId,
        {
          channel: "direct",
          targetPlayerId: player.playerId,
          title: "Moderator Warning",
          topic: "moderation_warning",
          severity: "warning",
          sourceRole: "admin",
          sourcePlayerId: ADMIN_DEBUG_REQUESTER_ID,
          message: warningMessage,
        },
        authOptions
      )
    );
  }

  private async kickSelectedPlayer(): Promise<void> {
    const room = this.getSelectedRoom();
    const player = this.getSelectedPlayer(room);
    if (!room || !player) {
      notificationService.show("Select a room/player before kicking.", "warning", 2200);
      return;
    }

    const playerLabel = player.displayName?.trim() || player.playerId;
    const confirmed = await confirmAction({
      title: `Kick ${playerLabel}?`,
      message: "This removes the player from the active room session.",
      confirmLabel: "Kick Player",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    await this.runAdminMutation("kick", async (authOptions) =>
      adminApiService.removeParticipant(room.sessionId, player.playerId, authOptions)
    );
  }

  private async banSelectedPlayer(): Promise<void> {
    const room = this.getSelectedRoom();
    const player = this.getSelectedPlayer(room);
    if (!room || !player) {
      notificationService.show("Select a room/player before banning.", "warning", 2200);
      return;
    }

    const playerLabel = player.displayName?.trim() || player.playerId;
    const confirmed = await confirmAction({
      title: `Ban ${playerLabel}?`,
      message: "This removes the player and blocks rejoin to this room.",
      confirmLabel: "Ban Player",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    await this.runAdminMutation("ban", async (authOptions) =>
      adminApiService.moderateSessionParticipant(
        room.sessionId,
        ADMIN_DEBUG_REQUESTER_ID,
        player.playerId,
        "ban",
        authOptions
      )
    );
  }

  private async runAdminMutation(
    label: "warn" | "kick" | "ban",
    execute: (authOptions: AdminRequestAuthOptions) => Promise<AdminMutationResult>
  ): Promise<void> {
    this.adminActionInFlight = true;
    this.renderAdminPanel();

    try {
      const authOptions = await this.getAdminRequestAuthOptions();
      const result = await execute(authOptions);
      if (!result.ok) {
        const reason = this.getAdminFailureMessage(result.reason, result.status);
        notificationService.show(`Failed to ${label}: ${reason}`, "error", 2600);
        return;
      }

      notificationService.show(`Player ${label} action completed.`, "success", 2200);
      await this.refreshAdminData({ force: true });
    } catch (error) {
      log.warn(`Failed to run admin ${label} action`, error);
      notificationService.show(`Failed to ${label}: network error`, "error", 2600);
    } finally {
      this.adminActionInFlight = false;
      this.renderAdminPanel();
    }
  }

  private updateTextureMapping(): void {
    const scaleU = parseFloat(this.query<HTMLInputElement>("#scale-u-slider")?.value ?? "1.0");
    const scaleV = parseFloat(this.query<HTMLInputElement>("#scale-v-slider")?.value ?? "1.0");
    const offsetU = parseFloat(this.query<HTMLInputElement>("#offset-u-slider")?.value ?? "0.0");
    const offsetV = parseFloat(this.query<HTMLInputElement>("#offset-v-slider")?.value ?? "0.0");

    const currentDie = DICE_CONFIG[this.currentDieIndex];

    log.debug(
      `Debug view updating texture mapping for ${currentDie.kind}: scale(${scaleU}, ${scaleV}) offset(${offsetU}, ${offsetV})`
    );

    this.diceRenderer.updateTextureMapping(scaleU, scaleV, offsetU, offsetV, currentDie.kind);
  }

  private saveTextureSettings(): void {
    const scaleU = parseFloat(this.query<HTMLInputElement>("#scale-u-slider")?.value ?? "1.0");
    const scaleV = parseFloat(this.query<HTMLInputElement>("#scale-v-slider")?.value ?? "1.0");
    const offsetU = parseFloat(this.query<HTMLInputElement>("#offset-u-slider")?.value ?? "0.0");
    const offsetV = parseFloat(this.query<HTMLInputElement>("#offset-v-slider")?.value ?? "0.0");

    const currentThemeConfig = themeManager.getCurrentThemeConfig();
    if (!currentThemeConfig) {
      return;
    }

    const currentDie = DICE_CONFIG[this.currentDieIndex];

    let themeName = currentThemeConfig.name;
    let themeSystemName = currentThemeConfig.systemName;
    if (currentThemeConfig.useFallbackFor?.includes(currentDie.kind) && currentThemeConfig.fallbackTheme) {
      const fallbackConfig = themeManager.getThemeConfig(currentThemeConfig.fallbackTheme);
      if (fallbackConfig) {
        themeName = fallbackConfig.name;
        themeSystemName = fallbackConfig.systemName;
      }
    }

    log.info("=== Texture Mapping Settings ===");
    log.info(`Theme: ${themeName} (${themeSystemName})`);
    log.info(`Current Die: ${currentDie.kind}`);
    log.info(`File: public/assets/themes/${themeSystemName}/theme.config.json`);
    log.info("\nAdd to material config:");
    log.info(`\"textureScale\": {`);
    log.info(`  \"u\": ${scaleU},`);
    log.info(`  \"v\": ${scaleV}`);
    log.info("},");
    log.info(`\"textureOffset\": {`);
    log.info(`  \"u\": ${offsetU},`);
    log.info(`  \"v\": ${offsetV}`);
    log.info("}");
    log.info("================================");
  }

  private populateThemeDropdown(): void {
    const select = this.query<HTMLSelectElement>("#debug-theme-select");
    if (!select) {
      return;
    }

    const themes = themeManager.getAvailableThemes();
    const currentTheme = themeManager.getCurrentTheme();

    select.innerHTML = themes
      .map(
        ({ name, config }) =>
          `<option value="${name}" ${name === currentTheme ? "selected" : ""}>${config.name}</option>`
      )
      .join("");
  }

  private loadThemeTextureSettings(): void {
    const currentThemeConfig = themeManager.getCurrentThemeConfig();
    if (!currentThemeConfig) {
      return;
    }

    const currentDie = DICE_CONFIG[this.currentDieIndex];

    let themeConfig = currentThemeConfig;
    if (currentThemeConfig.useFallbackFor?.includes(currentDie.kind) && currentThemeConfig.fallbackTheme) {
      const fallbackConfig = themeManager.getThemeConfig(currentThemeConfig.fallbackTheme);
      if (fallbackConfig) {
        themeConfig = fallbackConfig;
        log.debug(`Loading texture settings from fallback theme: ${fallbackConfig.name}`);
      }
    }

    const textureScale = (themeConfig.material as any).textureScale || { u: 1.0, v: 1.0 };
    const textureOffset = (themeConfig.material as any).textureOffset || { u: 0.0, v: 0.0 };

    const scaleUSlider = this.query<HTMLInputElement>("#scale-u-slider");
    const scaleVSlider = this.query<HTMLInputElement>("#scale-v-slider");
    const offsetUSlider = this.query<HTMLInputElement>("#offset-u-slider");
    const offsetVSlider = this.query<HTMLInputElement>("#offset-v-slider");

    if (scaleUSlider) {
      scaleUSlider.value = textureScale.u.toString();
      const valueEl = this.query<HTMLElement>("#scale-u-value");
      if (valueEl) {
        valueEl.textContent = textureScale.u.toFixed(2);
      }
    }
    if (scaleVSlider) {
      scaleVSlider.value = textureScale.v.toString();
      const valueEl = this.query<HTMLElement>("#scale-v-value");
      if (valueEl) {
        valueEl.textContent = textureScale.v.toFixed(2);
      }
    }
    if (offsetUSlider) {
      offsetUSlider.value = textureOffset.u.toString();
      const valueEl = this.query<HTMLElement>("#offset-u-value");
      if (valueEl) {
        valueEl.textContent = textureOffset.u.toFixed(2);
      }
    }
    if (offsetVSlider) {
      offsetVSlider.value = textureOffset.v.toString();
      const valueEl = this.query<HTMLElement>("#offset-v-value");
      if (valueEl) {
        valueEl.textContent = textureOffset.v.toFixed(2);
      }
    }

    this.updateTextureMapping();

    log.debug(`Loaded texture settings for ${themeConfig.name}:`, textureScale, textureOffset);
  }

  private resetToThemeDefaults(): void {
    log.info("Resetting to theme defaults");
    this.loadThemeTextureSettings();
  }

  private updateThemeInfo(): void {
    const currentThemeConfig = themeManager.getCurrentThemeConfig();
    const infoEl = this.query<HTMLElement>("#debug-theme-info");
    if (!currentThemeConfig || !infoEl) {
      return;
    }

    const currentDie = DICE_CONFIG[this.currentDieIndex];

    let themeConfig = currentThemeConfig;
    if (currentThemeConfig.useFallbackFor?.includes(currentDie.kind) && currentThemeConfig.fallbackTheme) {
      const fallbackConfig = themeManager.getThemeConfig(currentThemeConfig.fallbackTheme);
      if (fallbackConfig) {
        themeConfig = fallbackConfig;
      }
    }

    let info = `<p><strong>Theme:</strong> ${currentThemeConfig.name}</p>`;
    info += `<p><strong>Material Type:</strong> ${themeConfig.material.type}</p>`;

    if (currentThemeConfig.useFallbackFor?.includes(currentDie.kind)) {
      info += `<p><strong>Fallback:</strong> ${currentThemeConfig.fallbackTheme}</p>`;
      info += `<p><em>This die type uses fallback theme textures.</em></p>`;
    } else {
      info += `<p><strong>Fallback:</strong> ${currentThemeConfig.fallbackTheme || "None"}</p>`;
    }

    infoEl.innerHTML = info;

    this.updateMaterialVariantVisibility(themeConfig.material.type);
  }

  private updateMaterialVariantVisibility(materialType: string): void {
    const variantControl = this.query<HTMLElement>("#debug-material-variant")?.parentElement;
    if (!variantControl) {
      return;
    }

    variantControl.style.display = materialType === "color" ? "flex" : "none";
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = "block";
    this.onToggle(true);
    this.updateNotificationMonitorOpenState();
    this.refreshAdminTabAccess();
    this.setDicePreviewActive(this.activeTab === "dice");
    if (this.activeTab === "camera") {
      this.refreshCameraDebugPanel();
      this.startCameraDebugMetricsLoop();
    } else {
      this.stopCameraDebugMetricsLoop();
    }
    this.updateAdminRefreshLoop();

    if (this.activeTab === "admin" && this.adminTabEnabled) {
      void this.refreshAdminData({ force: false });
    }
  }

  hide(): void {
    this.isVisible = false;
    this.container.style.display = "none";
    this.onToggle(false);
    this.setDicePreviewActive(false);
    this.stopCameraDebugMetricsLoop();
    this.updateNotificationMonitorOpenState();
    this.updateAdminRefreshLoop();
  }

  private previousDie(): void {
    this.currentDieIndex = (this.currentDieIndex - 1 + DICE_CONFIG.length) % DICE_CONFIG.length;
    this.renderCurrentDie();
  }

  private nextDie(): void {
    this.currentDieIndex = (this.currentDieIndex + 1) % DICE_CONFIG.length;
    this.renderCurrentDie();
  }

  private renderCurrentDie(): void {
    this.diceRenderer.clearDebugDice();

    const config = DICE_CONFIG[this.currentDieIndex];

    const labelEl = this.query<HTMLElement>("#debug-die-label");
    if (labelEl) {
      labelEl.textContent = config.label;
    }

    const valuesContainer = this.query<HTMLElement>("#debug-values");
    if (valuesContainer) {
      valuesContainer.innerHTML = "";

      for (let value = 1; value <= config.faces; value += 1) {
        const displayValue = config.kind === "d10" ? (value === 10 ? 0 : value) : value;

        const valueLabel = document.createElement("div");
        valueLabel.className = "debug-value-label";
        valueLabel.textContent = String(displayValue);
        valuesContainer.appendChild(valueLabel);
      }
    }

    this.loadThemeTextureSettings();
    this.updateThemeInfo();

    this.diceRenderer.createDebugDice(config.kind, config.faces, this.useLightMaterial);
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
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function formatTimestamp(value: number | null | undefined): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  try {
    return new Date(Number(value)).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "unknown";
  }
}

function formatMsAsSeconds(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.ceil(safe / 1000)}s`;
}
