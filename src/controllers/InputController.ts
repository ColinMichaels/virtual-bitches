/**
 * Input Controller
 * Handles all user input: buttons, keyboard shortcuts, mobile menu
 */

import { audioService } from "../services/audio.js";
import { hapticsService } from "../services/haptics.js";
import { cameraService, type CameraPosition } from "../services/cameraService.js";
import type { GameState } from "../engine/types.js";
import type { LeaderboardModal } from "../ui/leaderboard.js";
import type { RulesModal } from "../ui/rules.js";
import type { GameScene } from "../render/scene.js";
import type { DebugView } from "../ui/debugView.js";
import type { CameraControlsPanel } from "../ui/cameraControls.js";
import type { ChaosUpgradeMenu } from "../ui/chaosUpgradeMenu.js";
import type { ProfileModal } from "../ui/profile.js";
import type { IControlInversionService } from "../services/controlInversion.js";

/**
 * Callback interface for game actions
 */
export interface GameCallbacks {
  handleAction: () => void;
  handleDeselectAll: () => void;
  handleUndo: () => void;
  handleCopyInviteLink: () => void;
  handleNewGame: () => void;
  handleWaitForNextGame: () => void;
  handleReturnToMainMenu: () => void;
  startNewGame: () => void;
  canManualNewGame: () => boolean;
  togglePause: () => void;
  handleDieClick: (dieId: string) => void;
  highlightFocusedDie: (dieId: string) => void;
  getGameState: () => GameState;
  isAnimating: () => boolean;
  isPaused: () => boolean;
  getSelectedDieIndex: () => number;
  setSelectedDieIndex: (index: number) => void;
  focusCameraOnDie: (dieId: string) => void;
  canCyclePlayerFocus: () => boolean;
  cyclePlayerFocus: (direction: 1 | -1) => void;
  openMultiplayerPublicMessageComposer: () => void;
  openMultiplayerWhisperComposer: () => void;
}

export class InputController {
  private callbacks: GameCallbacks;
  private scene: GameScene;
  private leaderboardModal: LeaderboardModal;
  private rulesModal: RulesModal;
  private debugView: DebugView;
  private cameraControlsPanel: CameraControlsPanel;
  private chaosUpgradeMenu: ChaosUpgradeMenu;
  private profileModal: ProfileModal;
  private controlInversionService: IControlInversionService;

  // DOM elements
  private actionBtn: HTMLButtonElement;
  private deselectBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private newGameBtn: HTMLButtonElement;
  private waitNextGameBtn: HTMLButtonElement | null;
  private returnMainMenuBtn: HTMLButtonElement | null;
  private viewLeaderboardBtn: HTMLButtonElement;
  private settingsGearBtn: HTMLButtonElement;
  private inviteLinkBtn: HTMLButtonElement | null;
  private leaderboardBtn: HTMLButtonElement;
  private profileBtn: HTMLButtonElement | null;
  private cameraPositionsBtn: HTMLButtonElement;
  private chaosUpgradesBtn: HTMLButtonElement;

  constructor(
    callbacks: GameCallbacks,
    scene: GameScene,
    leaderboardModal: LeaderboardModal,
    rulesModal: RulesModal,
    debugView: DebugView,
    cameraControlsPanel: CameraControlsPanel,
    chaosUpgradeMenu: ChaosUpgradeMenu,
    profileModal: ProfileModal,
    controlInversionService: IControlInversionService
  ) {
    this.callbacks = callbacks;
    this.scene = scene;
    this.leaderboardModal = leaderboardModal;
    this.rulesModal = rulesModal;
    this.debugView = debugView;
    this.cameraControlsPanel = cameraControlsPanel;
    this.chaosUpgradeMenu = chaosUpgradeMenu;
    this.profileModal = profileModal;
    this.controlInversionService = controlInversionService;

    // Get DOM elements
    this.actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
    this.deselectBtn = document.getElementById("deselect-btn") as HTMLButtonElement;
    this.undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement;
    this.waitNextGameBtn = document.getElementById("wait-next-game-btn") as HTMLButtonElement | null;
    this.returnMainMenuBtn = document.getElementById("return-main-menu-btn") as HTMLButtonElement | null;
    this.viewLeaderboardBtn = document.getElementById("view-leaderboard-btn") as HTMLButtonElement;
    this.settingsGearBtn = document.getElementById("settings-gear-btn") as HTMLButtonElement;
    this.inviteLinkBtn = document.getElementById("invite-link-btn") as HTMLButtonElement | null;
    this.leaderboardBtn = document.getElementById("leaderboard-btn") as HTMLButtonElement;
    this.profileBtn = document.getElementById("profile-btn") as HTMLButtonElement | null;
    this.cameraPositionsBtn = document.getElementById("camera-positions-btn") as HTMLButtonElement;
    this.chaosUpgradesBtn = document.getElementById("chaos-upgrades-btn") as HTMLButtonElement;
  }

  /**
   * Initialize all input handlers
   */
  initialize(): void {
    this.setupButtons();
    this.setupCameraControls();
    this.setupMobileMenu();
    this.setupKeyboard();
  }

  /**
   * Setup button click handlers
   */
  private setupButtons(): void {
    // Action button (roll/score)
    this.actionBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleAction();
    });

    // Deselect all button
    this.deselectBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleDeselectAll();
    });

    // Undo button
    this.undoBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleUndo();
    });

    // New game button
    this.newGameBtn.addEventListener("click", () => {
      if (!this.callbacks.canManualNewGame()) {
        return;
      }
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleNewGame();
    });

    this.waitNextGameBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleWaitForNextGame();
    });

    // Return to main menu button (game complete modal)
    this.returnMainMenuBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleReturnToMainMenu();
    });

    // View leaderboard button
    this.viewLeaderboardBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.leaderboardModal.show();
    });

    // Settings gear button
    this.settingsGearBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.togglePause();
    });

    this.inviteLinkBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleCopyInviteLink();
    });

    // Leaderboard button
    this.leaderboardBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.leaderboardModal.show();
    });

    // Profile button
    this.profileBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.profileModal.show();
    });

    // Camera Positions button
    this.cameraPositionsBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.cameraControlsPanel.toggle();
      // Update current camera position display
      const current = this.scene.getCameraPosition();
      this.cameraControlsPanel.updateCurrentPosition(
        current.alpha,
        current.beta,
        current.radius
      );
    });

    this.chaosUpgradesBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.chaosUpgradeMenu.toggle();
    });
  }

  /**
   * Setup camera control buttons
   */
  private setupCameraControls(): void {
    const cameraButtons = document.querySelectorAll("#camera-controls .camera-btn[data-view]");
    cameraButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        const view = btn.getAttribute("data-view") as "default" | "top" | "side" | "front";
        this.scene.setCameraView(view);
        // Close mobile menu after camera selection
        this.closeMobileMenu();
      });
    });
  }

  /**
   * Setup mobile menu toggle and buttons
   */
  private setupMobileMenu(): void {
    const menuToggle = document.getElementById("mobile-menu-toggle");
    const mobileMenu = document.getElementById("mobile-controls-menu");
    const mobileSettingsBtn = document.getElementById("mobile-settings-btn");
    const mobileInviteLinkBtn = document.getElementById("mobile-invite-link-btn");
    const mobileProfileBtn = document.getElementById("mobile-profile-btn");
    const mobileLeaderboardBtn = document.getElementById("mobile-leaderboard-btn");
    const mobileUpgradesBtn = document.getElementById("mobile-upgrades-btn");
    const mobileReturnLobbyBtn = document.getElementById("mobile-return-lobby-btn");

    if (!menuToggle || !mobileMenu) return;
    this.setupMobileCameraSlots();
    this.refreshMobileCameraSlots();
    cameraService.on("positionAdded", () => this.refreshMobileCameraSlots());
    cameraService.on("positionUpdated", () => this.refreshMobileCameraSlots());
    cameraService.on("positionDeleted", () => this.refreshMobileCameraSlots());
    cameraService.on("allCleared", () => this.refreshMobileCameraSlots());

    // Toggle menu on hamburger click
    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.refreshMobileCameraSlots();
      this.toggleMobileMenu();
    });

    // Mobile settings button
    if (mobileSettingsBtn) {
      mobileSettingsBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.callbacks.togglePause();
        this.closeMobileMenu();
      });
    }

    if (mobileInviteLinkBtn) {
      mobileInviteLinkBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.callbacks.handleCopyInviteLink();
        this.closeMobileMenu();
      });
    }

    if (mobileProfileBtn) {
      mobileProfileBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.profileModal.show();
        this.closeMobileMenu();
      });
    }

    // Mobile leaderboard button
    if (mobileLeaderboardBtn) {
      mobileLeaderboardBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.leaderboardModal.show();
        this.closeMobileMenu();
      });
    }

    if (mobileUpgradesBtn) {
      mobileUpgradesBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.chaosUpgradeMenu.toggle();
        this.closeMobileMenu();
      });
    }

    if (mobileReturnLobbyBtn) {
      mobileReturnLobbyBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.callbacks.handleReturnToMainMenu();
        this.closeMobileMenu();
      });
    }

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (!mobileMenu.contains(target) && !menuToggle.contains(target)) {
        this.closeMobileMenu();
      }
    });

    const handleViewportChange = () => {
      this.closeMobileMenu();
      this.refreshMobileCameraSlots();
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
  }

  private setupMobileCameraSlots(): void {
    const slotButtons = document.querySelectorAll<HTMLButtonElement>(".mobile-camera-slot-btn");
    slotButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = (button.dataset.cameraMode ?? "").trim();
        if (mode === "saved") {
          const positionId = (button.dataset.cameraPositionId ?? "").trim();
          if (!positionId) {
            return;
          }
          const savedPosition = cameraService.loadPosition(positionId);
          if (!savedPosition) {
            return;
          }
          this.scene.setCameraPosition(savedPosition, true);
        } else {
          const fallbackView =
            (button.dataset.cameraView as "default" | "top" | "side" | "front" | null) ?? "default";
          this.scene.setCameraView(fallbackView || "default");
        }

        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.closeMobileMenu();
      });
    });
  }

  private getMobileCameraSlots(): Array<{
    mode: "saved" | "default";
    label: string;
    meta: string;
    icon: string;
    positionId?: string;
    view?: "default" | "top" | "side" | "front";
  }> {
    const defaultSlots: Array<{
      mode: "default";
      label: string;
      meta: string;
      icon: string;
      view: "default" | "top" | "side" | "front";
    }> = [
      { mode: "default", label: "Default", meta: "Preset", icon: "📷", view: "default" },
      { mode: "default", label: "Top", meta: "Preset", icon: "⬆️", view: "top" },
      { mode: "default", label: "Side", meta: "Preset", icon: "↔️", view: "side" },
      { mode: "default", label: "Front", meta: "Preset", icon: "🎯", view: "front" },
    ];

    const favoritePositions = cameraService
      .getFavorites()
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 4);
    const savedPositions =
      favoritePositions.length > 0
        ? favoritePositions
        : cameraService
            .listPositions()
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 4);
    if (savedPositions.length === 0) {
      return defaultSlots;
    }

    const savedSlots: Array<{
      mode: "saved" | "default";
      label: string;
      meta: string;
      icon: string;
      positionId?: string;
      view?: "default" | "top" | "side" | "front";
    }> = savedPositions.map((position) => this.mapSavedCameraSlot(position));
    while (savedSlots.length < 4) {
      savedSlots.push(defaultSlots[savedSlots.length]);
    }
    return savedSlots;
  }

  private mapSavedCameraSlot(position: CameraPosition): {
    mode: "saved";
    label: string;
    meta: string;
    icon: string;
    positionId: string;
  } {
    const shortLabel = position.name.trim().slice(0, 12) || "Saved";
    return {
      mode: "saved",
      label: shortLabel,
      meta: position.isFavorite ? "Pinned" : "Saved",
      icon: position.isFavorite ? "📌" : "📷",
      positionId: position.id,
    };
  }

  private refreshMobileCameraSlots(): void {
    const slotButtons = document.querySelectorAll<HTMLButtonElement>(".mobile-camera-slot-btn");
    if (slotButtons.length === 0) {
      return;
    }

    const slots = this.getMobileCameraSlots();
    slotButtons.forEach((button, index) => {
      const slot = slots[index];
      if (!slot) {
        button.style.display = "none";
        return;
      }

      button.style.display = "";
      button.dataset.cameraMode = slot.mode;
      button.dataset.cameraPositionId = slot.positionId ?? "";
      button.dataset.cameraView = slot.view ?? "";
      button.title = slot.mode === "saved" ? `Pinned: ${slot.label}` : `${slot.label} View`;

      const iconEl = button.querySelector<HTMLElement>(".mobile-camera-slot-icon");
      const nameEl = button.querySelector<HTMLElement>(".mobile-camera-slot-name");
      const metaEl = button.querySelector<HTMLElement>(".mobile-camera-slot-meta");
      if (iconEl) {
        iconEl.textContent = slot.icon;
      }
      if (nameEl) {
        nameEl.textContent = slot.label;
      }
      if (metaEl) {
        metaEl.textContent = slot.meta;
      }
    });
  }

  /**
   * Setup keyboard shortcuts
   */
  private setupKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      this.handleKeydown(e);
    });
  }

  /**
   * Handle keyboard events
   */
  private handleKeydown(e: KeyboardEvent): void {
    const state = this.callbacks.getGameState();
    const animating = this.callbacks.isAnimating();
    const paused = this.callbacks.isPaused();
    const code = this.controlInversionService.remapKeyCode(e.code);
    const key = e.key;
    const isPlusOrEqualsKey =
      code === "NumpadAdd" ||
      code === "Equal" ||
      key === "+" ||
      key === "=";
    const isMinusKey = code === "Minus" || code === "NumpadSubtract" || key === "-";
    const shouldCycleBackward = code === "ArrowLeft" || isMinusKey;
    const shouldCycleForward = code === "ArrowRight" || isPlusOrEqualsKey;
    const cycleDirection: 1 | -1 | null = shouldCycleForward
      ? 1
      : shouldCycleBackward
        ? -1
        : null;
    const isModalOpen = this.isAnyModalOpen();
    const isTextEntryActive = this.isTextEntryTarget(e.target);

    // ESC key - close modals or toggle pause/settings
    if (code === "Escape") {
      e.preventDefault();

      if (this.rulesModal.isVisible()) {
        this.rulesModal.hide();
      } else if (this.leaderboardModal.isVisible()) {
        this.leaderboardModal.hide();
      } else if (this.profileModal.isVisible()) {
        this.profileModal.hide();
      } else if (this.chaosUpgradeMenu.isVisible()) {
        this.chaosUpgradeMenu.hide();
      } else if (this.isElementVisibleById("settings-modal")) {
        this.callbacks.togglePause();
      } else {
        this.callbacks.togglePause();
      }
      return;
    }

    // Pause all gameplay/global shortcuts while any modal is open.
    if (isModalOpen) {
      return;
    }

    // Never steal typing keys from text inputs/editors.
    if (isTextEntryActive) {
      return;
    }

    // Space key - multipurpose action (roll or score)
    if (code === "Space" && !animating && !paused) {
      e.preventDefault();
      this.callbacks.handleAction();
      return;
    }

    // Arrow key navigation for dice selection (only when ROLLED)
    if (state.status === "ROLLED" && !animating && !paused) {
      const activeDice = state.dice.filter((d) => d.inPlay && !d.scored);

      if (cycleDirection !== null && this.callbacks.canCyclePlayerFocus()) {
        e.preventDefault();
        this.callbacks.cyclePlayerFocus(cycleDirection);
        return;
      }

      if (cycleDirection !== null) {
        if (activeDice.length === 0) return;
        e.preventDefault();

        let selectedDieIndex = this.callbacks.getSelectedDieIndex();

        if (cycleDirection < 0) {
          selectedDieIndex = (selectedDieIndex - 1 + activeDice.length) % activeDice.length;
        } else {
          selectedDieIndex = (selectedDieIndex + 1) % activeDice.length;
        }

        this.callbacks.setSelectedDieIndex(selectedDieIndex);
        const focusedDieId = activeDice[selectedDieIndex].id;
        this.callbacks.highlightFocusedDie(focusedDieId);
        this.callbacks.focusCameraOnDie(focusedDieId);
        return;
      }

      if (activeDice.length === 0) return;

      // Enter key - toggle selection of focused die
      if (code === "Enter") {
        e.preventDefault();
        const selectedDieIndex = this.callbacks.getSelectedDieIndex();
        const focusedDie = activeDice[selectedDieIndex];
        if (focusedDie) {
          this.callbacks.handleDieClick(focusedDie.id);
        }
        return;
      }
    }

    if (!animating && !paused && cycleDirection !== null && this.callbacks.canCyclePlayerFocus()) {
      e.preventDefault();
      this.callbacks.cyclePlayerFocus(cycleDirection);
      return;
    }

    // 'X' key - deselect all (when dice are selected)
    if (code === "KeyX" && state.status === "ROLLED" && state.selected.size > 0 && !animating && !paused) {
      e.preventDefault();
      this.callbacks.handleDeselectAll();
      return;
    }

    // 'N' key - new game
    if (code === "KeyN" && !animating) {
      if (!this.callbacks.canManualNewGame()) {
        return;
      }
      e.preventDefault();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.startNewGame();
      return;
    }

    // 'D' key - debug view
    if (code === "KeyD" && !animating) {
      e.preventDefault();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.debugView.show();
      return;
    }

    // 'C' key - camera controls
    if (code === "KeyC" && !animating) {
      e.preventDefault();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.cameraControlsPanel.toggle();
      // Update current camera position display
      const current = this.scene.getCameraPosition();
      this.cameraControlsPanel.updateCurrentPosition(
        current.alpha,
        current.beta,
        current.radius
      );
      return;
    }

    // 'U' key - chaos upgrades menu
    if (code === "KeyU" && !animating) {
      e.preventDefault();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.chaosUpgradeMenu.toggle();
      return;
    }

    // 'M' key - multiplayer room message
    if (code === "KeyM" && !animating && !paused) {
      e.preventDefault();
      this.callbacks.openMultiplayerPublicMessageComposer();
      return;
    }

    // 'W' key - multiplayer whisper
    if (code === "KeyW" && !animating && !paused) {
      e.preventDefault();
      this.callbacks.openMultiplayerWhisperComposer();
      return;
    }
  }

  private isAnyModalOpen(): boolean {
    const modalSelectors = [".modal", "#settings-modal", "#game-over"];
    return modalSelectors.some((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector)).some((el) =>
        this.isElementVisible(el)
      )
    );
  }

  private isElementVisibleById(id: string): boolean {
    const el = document.getElementById(id);
    return this.isElementVisible(el);
  }

  private isElementVisible(element: HTMLElement | null): boolean {
    if (!element) return false;
    if (element.classList.contains("show")) return true;

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  private isTextEntryTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;

    const tagName = element.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
      return true;
    }

    return Boolean(element.closest("[contenteditable='true']"));
  }

  /**
   * Toggle mobile menu open/closed
   */
  private toggleMobileMenu(): void {
    const mobileMenu = document.getElementById("mobile-controls-menu");
    if (!mobileMenu) return;

    if (mobileMenu.classList.contains("mobile-menu-closed")) {
      mobileMenu.classList.remove("mobile-menu-closed");
      mobileMenu.classList.add("mobile-menu-open");
    } else {
      mobileMenu.classList.remove("mobile-menu-open");
      mobileMenu.classList.add("mobile-menu-closed");
    }
  }

  /**
   * Close mobile menu
   */
  closeMobileMenu(): void {
    const mobileMenu = document.getElementById("mobile-controls-menu");
    if (!mobileMenu) return;

    mobileMenu.classList.remove("mobile-menu-open");
    mobileMenu.classList.add("mobile-menu-closed");
  }
}
