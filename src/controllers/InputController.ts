/**
 * Input Controller
 * Handles all user input: buttons, keyboard shortcuts, mobile menu
 */

import { audioService } from "../services/audio.js";
import { hapticsService } from "../services/haptics.js";
import type { GameState } from "../engine/types.js";
import type { LeaderboardModal } from "../ui/leaderboard.js";
import type { RulesModal } from "../ui/rules.js";
import type { GameScene } from "../render/scene.js";
import type { DebugView } from "../ui/debugView.js";
import type { CameraControlsPanel } from "../ui/cameraControls.js";

/**
 * Callback interface for game actions
 */
export interface GameCallbacks {
  handleAction: () => void;
  handleDeselectAll: () => void;
  handleUndo: () => void;
  handleNewGame: () => void;
  startNewGame: () => void;
  togglePause: () => void;
  handleDieClick: (dieId: string) => void;
  highlightFocusedDie: (dieId: string) => void;
  getGameState: () => GameState;
  isAnimating: () => boolean;
  isPaused: () => boolean;
  getSelectedDieIndex: () => number;
  setSelectedDieIndex: (index: number) => void;
}

export class InputController {
  private callbacks: GameCallbacks;
  private scene: GameScene;
  private leaderboardModal: LeaderboardModal;
  private rulesModal: RulesModal;
  private debugView: DebugView;
  private cameraControlsPanel: CameraControlsPanel;

  // DOM elements
  private actionBtn: HTMLButtonElement;
  private deselectBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private newGameBtn: HTMLButtonElement;
  private viewLeaderboardBtn: HTMLButtonElement;
  private settingsGearBtn: HTMLButtonElement;
  private leaderboardBtn: HTMLButtonElement;
  private cameraPositionsBtn: HTMLButtonElement;

  constructor(
    callbacks: GameCallbacks,
    scene: GameScene,
    leaderboardModal: LeaderboardModal,
    rulesModal: RulesModal,
    debugView: DebugView,
    cameraControlsPanel: CameraControlsPanel
  ) {
    this.callbacks = callbacks;
    this.scene = scene;
    this.leaderboardModal = leaderboardModal;
    this.rulesModal = rulesModal;
    this.debugView = debugView;
    this.cameraControlsPanel = cameraControlsPanel;

    // Get DOM elements
    this.actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
    this.deselectBtn = document.getElementById("deselect-btn") as HTMLButtonElement;
    this.undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement;
    this.viewLeaderboardBtn = document.getElementById("view-leaderboard-btn") as HTMLButtonElement;
    this.settingsGearBtn = document.getElementById("settings-gear-btn") as HTMLButtonElement;
    this.leaderboardBtn = document.getElementById("leaderboard-btn") as HTMLButtonElement;
    this.cameraPositionsBtn = document.getElementById("camera-positions-btn") as HTMLButtonElement;
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
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.handleNewGame();
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

    // Leaderboard button
    this.leaderboardBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.leaderboardModal.show();
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
  }

  /**
   * Setup camera control buttons
   */
  private setupCameraControls(): void {
    const cameraButtons = document.querySelectorAll(".camera-btn");
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
    const mobileLeaderboardBtn = document.getElementById("mobile-leaderboard-btn");

    if (!menuToggle || !mobileMenu) return;

    // Toggle menu on hamburger click
    menuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      audioService.playSfx("click");
      hapticsService.buttonPress();
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

    // Mobile leaderboard button
    if (mobileLeaderboardBtn) {
      mobileLeaderboardBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        hapticsService.buttonPress();
        this.leaderboardModal.show();
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

    // ESC key - close modals or toggle pause/settings
    if (e.code === "Escape") {
      e.preventDefault();

      if (this.rulesModal.isVisible()) {
        this.rulesModal.hide();
      } else if (this.leaderboardModal.isVisible()) {
        this.leaderboardModal.hide();
      } else {
        this.callbacks.togglePause();
      }
      return;
    }

    // Space key - multipurpose action (roll or score)
    if (e.code === "Space" && !animating && !paused) {
      e.preventDefault();
      this.callbacks.handleAction();
      return;
    }

    // Arrow key navigation for dice selection (only when ROLLED)
    if (state.status === "ROLLED" && !animating && !paused) {
      const activeDice = state.dice.filter((d) => d.inPlay && !d.scored);

      if (activeDice.length === 0) return;

      if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
        e.preventDefault();

        let selectedDieIndex = this.callbacks.getSelectedDieIndex();

        if (e.code === "ArrowLeft") {
          selectedDieIndex = (selectedDieIndex - 1 + activeDice.length) % activeDice.length;
        } else {
          selectedDieIndex = (selectedDieIndex + 1) % activeDice.length;
        }

        this.callbacks.setSelectedDieIndex(selectedDieIndex);
        this.callbacks.highlightFocusedDie(activeDice[selectedDieIndex].id);
        return;
      }

      // Enter key - toggle selection of focused die
      if (e.code === "Enter") {
        e.preventDefault();
        const selectedDieIndex = this.callbacks.getSelectedDieIndex();
        const focusedDie = activeDice[selectedDieIndex];
        if (focusedDie) {
          this.callbacks.handleDieClick(focusedDie.id);
        }
        return;
      }
    }

    // 'X' key - deselect all (when dice are selected)
    if (e.code === "KeyX" && state.status === "ROLLED" && state.selected.size > 0 && !animating && !paused) {
      e.preventDefault();
      this.callbacks.handleDeselectAll();
      return;
    }

    // 'N' key - new game
    if (e.code === "KeyN" && !animating) {
      e.preventDefault();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.callbacks.startNewGame();
      return;
    }

    // 'D' key - debug view
    if (e.code === "KeyD" && !animating) {
      e.preventDefault();
      audioService.playSfx("click");
      hapticsService.buttonPress();
      this.debugView.show();
      return;
    }

    // 'C' key - camera controls
    if (e.code === "KeyC" && !animating) {
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
