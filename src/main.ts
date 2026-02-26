import { GameScene } from "./render/scene.js";
import { DiceRenderer } from "./render/dice.js";
import { HUD } from "./ui/hud.js";
import { DiceRow } from "./ui/diceRow.js";
import { SplashScreen } from "./ui/splash.js";
import { SettingsModal } from "./ui/settings.js";
import { LeaderboardModal } from "./ui/leaderboard.js";
import { RulesModal } from "./ui/rules.js";
import { TutorialModal } from "./ui/tutorial.js";
import { DebugView } from "./ui/debugView.js";
import { AlphaWarningModal } from "./ui/alphaWarning.js";
import { UpdatesPanel } from "./ui/updates.js";
import { CameraControlsPanel } from "./ui/cameraControls.js";
import { ChaosUpgradeMenu } from "./ui/chaosUpgradeMenu.js";
import { EffectHUD } from "./ui/effectHUD.js";
import { notificationService } from "./ui/notifications.js";
import { reduce, undo, canUndo } from "./game/state.js";
import { GameState, Action, GameDifficulty } from "./engine/types.js";
import { PointerEventTypes } from "@babylonjs/core";
import { audioService } from "./services/audio.js";
import { hapticsService } from "./services/haptics.js";
import { pwaService } from "./services/pwa.js";
import { settingsService } from "./services/settings.js";
import { ControlInversionService } from "./services/controlInversion.js";
import { themeManager } from "./services/themeManager.js";
import { initParticleService, particleService } from "./services/particleService.js";
import { registerGameEffects } from "./particles/presets/gameEffects.js";
import { registerChaosEffects } from "./particles/presets/chaosEffects.js";
import { logger } from "./utils/logger.js";
import { shouldShowHints, isUndoAllowed } from "./engine/modes.js";
import { InputController, GameCallbacks } from "./controllers/InputController.js";
import { GameFlowController } from "./controllers/GameFlowController.js";
import { GameOverController } from "./controllers/GameOverController.js";
import { CameraEffectsService } from "./services/cameraEffects.js";
import { CameraAttackExecutor } from "./chaos/cameraAttackExecutor.js";
import type { CameraAttackMessage } from "./chaos/types.js";
import type { ParticleNetworkEvent } from "./services/particleService.js";
import { playerDataSyncService } from "./services/playerDataSync.js";
import { getLocalPlayerId } from "./services/playerIdentity.js";
import { MultiplayerNetworkService } from "./multiplayer/networkService.js";
import { MultiplayerSessionService } from "./multiplayer/sessionService.js";
import { environment } from "@env";
import type { MultiplayerSessionRecord } from "./services/backendApi.js";

const log = logger.create('Game');

function formatCameraAttackLabel(effectType: string): string {
  switch (effectType) {
    case "shake":
      return "Screen Shake";
    case "spin":
      return "Camera Spin";
    case "zoom":
      return "Zoom Warp";
    case "drunk":
      return "Drunk Vision";
    default:
      return "Camera Attack";
  }
}

class Game implements GameCallbacks {
  private state: GameState;
  private scene: GameScene;
  private diceRenderer: DiceRenderer;
  private hud: HUD;
  private diceRow: DiceRow;
  private animating = false;
  private paused = false;
  private settingsModal: SettingsModal;
  private leaderboardModal: LeaderboardModal;
  private debugView: DebugView;
  private cameraControlsPanel: CameraControlsPanel;
  private chaosUpgradeMenu: ChaosUpgradeMenu;
  private effectHud: EffectHUD;
  private cameraEffects: CameraEffectsService;
  private cameraAttackExecutor: CameraAttackExecutor;
  private controlInversion: ControlInversionService;
  private multiplayerNetwork?: MultiplayerNetworkService;
  private multiplayerSessionService: MultiplayerSessionService;
  private gameStartTime: number;
  private selectedDieIndex = 0; // For keyboard navigation
  private inputController: InputController;
  private gameOverController: GameOverController;
  private readonly localPlayerId = getLocalPlayerId();

  private actionBtn: HTMLButtonElement;
  private deselectBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;

  constructor() {
    // Initialize game state from URL or create new game
    this.state = GameFlowController.initializeGameState();

    // Initialize rendering
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    this.scene = new GameScene(canvas);
    this.diceRenderer = new DiceRenderer(this.scene.scene);

    // Initialize particle system
    initParticleService(this.scene.scene);
    registerGameEffects();
    registerChaosEffects();
    this.cameraEffects = new CameraEffectsService(this.scene);
    this.effectHud = new EffectHUD(this.cameraEffects);
    this.effectHud.start();
    this.controlInversion = new ControlInversionService({
      isEnabled: () => settingsService.getSettings().controls.allowChaosControlInversion,
    });
    this.cameraAttackExecutor = new CameraAttackExecutor(
      this.cameraEffects,
      () => this.localPlayerId,
      {
        controlInversion: this.controlInversion,
        getAccessibilitySettings: () => ({
          reduceCameraEffects: settingsService.getSettings().controls.reduceChaosCameraEffects,
        }),
      }
    );

    this.multiplayerSessionService = new MultiplayerSessionService(this.localPlayerId);
    this.setMultiplayerNetwork(this.getMultiplayerWsUrl());

    document.addEventListener("particle:network:receive", ((event: Event) => {
      const particleEvent = event as CustomEvent<ParticleNetworkEvent>;
      if (!particleEvent.detail) return;
      particleService.handleNetworkEvent(particleEvent.detail);
    }) as EventListener);

    document.addEventListener("multiplayer:connected", () => {
      particleService.enableNetworkSync(true);
    });
    document.addEventListener("multiplayer:disconnected", () => {
      particleService.enableNetworkSync(false);
    });
    document.addEventListener("multiplayer:authExpired", () => {
      notificationService.show("Multiplayer auth expired, refreshing session...", "warning", 2200);
    });
    document.addEventListener("multiplayer:sessionExpired", () => {
      notificationService.show("Multiplayer session expired. Rejoin required.", "error", 3200);
    });
    document.addEventListener("auth:sessionExpired", () => {
      notificationService.show("Session expired. Please rejoin multiplayer.", "warning", 2600);
    });

    document.addEventListener("chaos:cameraAttack:sent", ((event: Event) => {
      const detail = (event as CustomEvent<{ message?: CameraAttackMessage }>).detail;
      const message = detail?.message;
      if (!message) return;
      notificationService.show(
        `Attack sent: ${formatCameraAttackLabel(message.effectType)} Lv${message.level}`,
        "info",
        1600
      );
    }) as EventListener);

    document.addEventListener("chaos:cameraAttack:sendFailed", ((event: Event) => {
      const detail = (event as CustomEvent<{ message?: CameraAttackMessage }>).detail;
      const message = detail?.message;
      if (!message) return;
      notificationService.show(
        `Attack failed to send: ${formatCameraAttackLabel(message.effectType)}`,
        "warning",
        2200
      );
    }) as EventListener);

    document.addEventListener("chaos:cameraAttack:received", ((event: Event) => {
      const detail = (event as CustomEvent<{ message?: CameraAttackMessage }>).detail;
      const message = detail?.message;
      if (!message) return;

      notificationService.show(
        `Incoming: ${formatCameraAttackLabel(message.effectType)} (${(message.duration / 1000).toFixed(1)}s)`,
        "warning",
        1800
      );
    }) as EventListener);

    document.addEventListener("chaos:cameraAttack:applied", ((event: Event) => {
      const detail = (event as CustomEvent<{ message?: CameraAttackMessage }>).detail;
      const message = detail?.message;
      if (!message) return;

      notificationService.show(
        `Effect active: ${formatCameraAttackLabel(message.effectType)}`,
        "info",
        1400
      );
    }) as EventListener);

    // Bridge for upcoming multiplayer chaos attack messages
    document.addEventListener("chaos:cameraAttack", ((event: Event) => {
      const attackEvent = event as CustomEvent<CameraAttackMessage>;
      if (!attackEvent.detail) return;
      const effectId = this.cameraAttackExecutor.execute(attackEvent.detail);
      if (!effectId) return;

      document.dispatchEvent(
        new CustomEvent("chaos:cameraAttack:applied", {
          detail: {
            message: attackEvent.detail,
            effectId,
          },
        })
      );
    }) as EventListener);

    // Apply display settings from saved preferences
    const settings = settingsService.getSettings();
    particleService.setIntensity(settings.display.particleIntensity);
    this.scene.updateTableContrast(settings.display.visual.tableContrast);
    this.hud = new HUD();
    this.diceRow = new DiceRow((dieId) => this.handleDieClick(dieId), this.diceRenderer as any);

    // Set initial hint mode based on game mode
    GameFlowController.updateHintMode(this.state, this.diceRow);

    // UI elements
    this.actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
    this.deselectBtn = document.getElementById("deselect-btn") as HTMLButtonElement;
    this.undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;

    // Initialize modals (shared with splash)
    this.settingsModal = settingsModal;
    this.leaderboardModal = leaderboardModal;

    // Initialize debug view
    this.debugView = new DebugView(this.diceRenderer, this.scene, (isDebugMode) => {
      this.handleDebugModeToggle(isDebugMode);
    });

    // Initialize camera controls panel
    this.cameraControlsPanel = new CameraControlsPanel();
    this.cameraControlsPanel.onLoad((position) => {
      this.scene.setCameraPosition(position);
      this.cameraControlsPanel.updateCurrentPosition(
        position.alpha,
        position.beta,
        position.radius
      );
    });

    // Listen for save/reset requests from camera panel
    document.addEventListener('camera:requestSave', ((e: CustomEvent) => {
      const { name } = e.detail;
      const current = this.scene.getCameraPosition();
      this.cameraControlsPanel.savePosition(
        name,
        current.alpha,
        current.beta,
        current.radius,
        current.target
      );
    }) as EventListener);

    document.addEventListener('camera:requestReset', () => {
      this.scene.setCameraView('default');
      const current = this.scene.getCameraPosition();
      this.cameraControlsPanel.updateCurrentPosition(
        current.alpha,
        current.beta,
        current.radius
      );
    });

    this.chaosUpgradeMenu = new ChaosUpgradeMenu();

    // Initialize controllers
    this.inputController = new InputController(
      this,
      this.scene,
      this.leaderboardModal,
      rulesModal,
      this.debugView,
      this.cameraControlsPanel,
      this.chaosUpgradeMenu,
      this.controlInversion
    );
    this.gameOverController = new GameOverController(this.scene);

    // Handle settings modal close to unpause game
    this.settingsModal.setOnClose(() => {
      if (this.paused) {
        this.paused = false;
        notificationService.show("Resume!", "info");
        this.updateUI();
      }
    });

    // Handle new game request from settings
    this.settingsModal.setOnNewGame(() => {
      this.startNewGame();
    });

    // Handle How to Play button in settings
    this.settingsModal.setOnHowToPlay(() => {
      rulesModal.show();
    });

    // Handle player seat clicks (show multiplayer coming soon notification)
    this.scene.setPlayerSeatClickHandler((seatIndex: number) => {
      notificationService.show("Multiplayer Coming Soon!", "info", 3000);
      audioService.playSfx("click");
    });

    // Provide callback to check if game is in progress
    this.settingsModal.setCheckGameInProgress(() => {
      return GameFlowController.isGameInProgress(this.state);
    });

    // Listen to settings changes to sync mode and update hint mode
    settingsService.onChange((settings) => {
      GameFlowController.syncModeWithSettings(this.state);
      GameFlowController.updateHintMode(this.state, this.diceRow);
      // Apply visual settings in real-time
      this.scene.updateTableContrast(settings.display.visual.tableContrast);
      this.updateUI();
    });

    // Handle mode changes from HUD dropdown
    this.hud.setOnModeChange((difficulty) => {
      this.handleModeChange(difficulty);
    });

    // Setup tutorial
    tutorialModal.setOnComplete(() => {
      // After tutorial, sync mode and update hint mode based on actual difficulty setting
      GameFlowController.syncModeWithSettings(this.state);
      GameFlowController.updateHintMode(this.state, this.diceRow);
      this.updateUI();
    });

    this.inputController.initialize();
    this.setupDiceSelection();
    GameFlowController.initializeAudio();
    this.updateUI();
    this.initializeBackendSyncAndMultiplayerSession();

    // Show tutorial if this is first time
    if (tutorialModal.shouldShow()) {
      // Enable hints during tutorial practice
      this.diceRow.setHintMode(true);
      tutorialModal.show();
    }

    // Track game start time
    this.gameStartTime = Date.now();
  }

  private getMultiplayerWsUrl(): string | undefined {
    if (!environment.features.multiplayer || !environment.wsUrl) {
      return undefined;
    }

    // Prevent automatic reconnect loops during normal single-player sessions.
    // Enable with ?multiplayer=1, or include ?session=<id> for session join flows.
    const query = new URLSearchParams(window.location.search);
    const multiplayerEnabled = query.get("multiplayer") === "1" || !!query.get("session");
    if (!multiplayerEnabled) {
      return undefined;
    }

    const sessionId = query.get("session");
    if (sessionId) {
      // Session sockets require a short-lived player token returned by join/create APIs.
      // Defer connection until initializeBackendSyncAndMultiplayerSession() rebinds it.
      return undefined;
    }

    const baseUrl = new URL(environment.wsUrl);
    baseUrl.searchParams.set("playerId", this.localPlayerId);
    return baseUrl.toString();
  }

  private setMultiplayerNetwork(wsUrl: string | undefined): void {
    this.multiplayerNetwork?.dispose();
    this.multiplayerNetwork = new MultiplayerNetworkService({
      wsUrl,
      eventTarget: document,
      onAuthExpired: async () => this.handleMultiplayerAuthExpired(),
    });
    this.multiplayerNetwork.enableEventBridge();
    this.multiplayerNetwork.connect();
  }

  private async handleMultiplayerAuthExpired(): Promise<string | undefined> {
    const refreshedSession = await this.multiplayerSessionService.refreshSessionAuth();
    if (!refreshedSession) {
      return undefined;
    }

    return this.buildSessionWsUrl(refreshedSession);
  }

  private buildSessionWsUrl(session: MultiplayerSessionRecord): string | undefined {
    if (!environment.features.multiplayer) {
      return undefined;
    }

    const base = session.wsUrl ?? environment.wsUrl;
    if (!base) {
      return undefined;
    }

    try {
      const url = new URL(base);
      url.searchParams.set("playerId", this.localPlayerId);
      url.searchParams.set("session", session.sessionId);
      const socketToken = session.playerToken ?? session.auth?.accessToken;
      if (socketToken) {
        url.searchParams.set("token", socketToken);
      }
      return url.toString();
    } catch (error) {
      log.warn("Invalid session WebSocket URL", error);
      return undefined;
    }
  }

  private initializeBackendSyncAndMultiplayerSession(): void {
    playerDataSyncService.start();

    const query = new URLSearchParams(window.location.search);
    const sessionId = query.get("session");
    if (!sessionId) return;

    playerDataSyncService.setSessionId(sessionId);
    void this.multiplayerSessionService.joinSession(sessionId).then((session) => {
      if (!session) return;

      const sessionWsUrl = this.buildSessionWsUrl(session);
      if (sessionWsUrl) {
        this.setMultiplayerNetwork(sessionWsUrl);
        log.info(`Rebound multiplayer network to session socket: ${session.sessionId}`);
      }

      log.info(`Joined multiplayer session via API scaffold: ${session.sessionId}`);
    });
  }

  // GameCallbacks implementation
  getGameState(): GameState {
    return this.state;
  }

  isAnimating(): boolean {
    return this.animating;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getSelectedDieIndex(): number {
    return this.selectedDieIndex;
  }

  setSelectedDieIndex(index: number): void {
    this.selectedDieIndex = index;
  }

  togglePause(): void {
    this.paused = !this.paused;

    if (this.paused) {
      notificationService.show("Paused", "info");
      this.settingsModal.show();
    } else {
      notificationService.show("Resume!", "info");
      this.settingsModal.hide();
    }

    this.updateUI();
  }

  highlightFocusedDie(dieId: string): void {
    // Remove focus from all dice
    const allDiceElements = document.querySelectorAll(".die-wrapper");
    allDiceElements.forEach((el) => el.classList.remove("focused"));

    // Add focus to the selected die
    const dieElement = document.querySelector(`[data-die-id="${dieId}"]`);
    if (dieElement) {
      dieElement.classList.add("focused");
      // Show notification about keyboard controls on first use
      const hasSeenKeyboardHint = sessionStorage.getItem("keyboardHintShown");
      if (!hasSeenKeyboardHint) {
        notificationService.show("← → to navigate, Enter to select, X to deselect | N=New Game, D=Debug", "info");
        sessionStorage.setItem("keyboardHintShown", "true");
      }
    }
  }

  private handleModeChange(difficulty: GameDifficulty): void {
    const isInProgress = GameFlowController.isGameInProgress(this.state);
    const result = GameFlowController.handleModeChange(this.state, difficulty, isInProgress);

    if (result.newState) {
      // Game was in progress, starting new game
      this.state = result.newState;
      GameFlowController.updateHintMode(this.state, this.diceRow);
      GameFlowController.resetForNewGame(this.diceRenderer);
      this.animating = false;
      this.gameStartTime = Date.now();
      this.updateUI();
      notificationService.show("New Game Started!", "success");
    } else if (result.modeUpdated) {
      // Game not in progress, mode was updated in place
      GameFlowController.updateHintMode(this.state, this.diceRow);
      this.updateUI();
      notificationService.show(`Mode changed to ${difficulty}`, "info");
    } else {
      // User cancelled - do nothing
    }
  }

  private handleDebugModeToggle(isDebugMode: boolean): void {
    // Hide game UI when debug mode is active
    const hudEl = document.getElementById("hud");
    const diceRowEl = document.getElementById("dice-row");
    const controlsEl = document.getElementById("controls");
    const cameraControlsEl = document.getElementById("camera-controls");
    const effectHudEl = document.getElementById("effect-hud");

    if (isDebugMode) {
      // Hide game UI
      if (hudEl) hudEl.style.display = "none";
      if (diceRowEl) diceRowEl.style.display = "none";
      if (controlsEl) controlsEl.style.display = "none";
      if (cameraControlsEl) cameraControlsEl.style.display = "none";
      if (effectHudEl) effectHudEl.style.display = "none";
      this.chaosUpgradeMenu.hide();
      this.controlInversion.clearAll();

      // Clear game dice from scene
      this.diceRenderer.clearDice();
    } else {
      // Restore game UI
      if (hudEl) hudEl.style.display = "block";
      if (diceRowEl) diceRowEl.style.display = "flex";
      if (controlsEl) controlsEl.style.display = "flex";
      if (cameraControlsEl) cameraControlsEl.style.display = "flex";
      if (effectHudEl) effectHudEl.style.display = "flex";

      // Restore game state - updateUI will handle re-rendering dice if needed
      this.updateUI();
    }
  }

  private setupDiceSelection(): void {
    this.scene.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const pickInfo = pointerInfo.pickInfo;
        if (pickInfo?.hit && pickInfo.pickedMesh) {
          const dieId = pickInfo.pickedMesh.name;
          this.handleDieClick(dieId);
        }
      }
    });
  }

  handleDieClick(dieId: string): void {
    const die = this.state.dice.find((d) => d.id === dieId);

    // Invalid action reminders
    if (this.state.status === "READY") {
      notificationService.show("Roll First!", "warning");
      audioService.playSfx("click");
      hapticsService.invalid();
      return;
    }

    if (this.state.status === "COMPLETE") {
      notificationService.show("Game Over!", "warning");
      audioService.playSfx("click");
      hapticsService.invalid();
      return;
    }

    if (this.state.status === "ROLLED") {
      // Valid die selection
      if (die && die.inPlay && !die.scored) {
        audioService.playSfx("select");
        hapticsService.select();
        this.dispatch({ t: "TOGGLE_SELECT", dieId });

        // Notify tutorial of select action
        if (tutorialModal.isActive()) {
          tutorialModal.onPlayerAction('select');
        }
      } else {
        // Invalid click - not a selectable die
        notificationService.show("Select a Die", "warning");
        audioService.playSfx("click");
        hapticsService.invalid();
      }
    }
  }

  private dispatch(action: Action): void {
    const prevState = this.state;
    this.state = reduce(this.state, action);

    // Update selection visuals
    if (action.t === "TOGGLE_SELECT") {
      this.diceRenderer.setSelected(
        action.dieId,
        this.state.selected.has(action.dieId)
      );
    }

    this.updateUI();

    // Check for game complete
    if (prevState.status !== "COMPLETE" && this.state.status === "COMPLETE") {
      this.gameOverController.showGameOver(this.state, this.gameStartTime);
    }
  }

  handleAction(): void {
    if (this.paused || this.animating) return;

    if (this.state.status === "READY") {
      this.handleRoll();
    } else if (this.state.status === "ROLLED" && this.state.selected.size > 0) {
      this.handleScore();
    }
  }

  handleDeselectAll(): void {
    if (this.paused || this.animating || this.state.status !== "ROLLED") return;

    // Deselect all dice
    const selectedIds = Array.from(this.state.selected);
    selectedIds.forEach((dieId) => {
      this.dispatch({ t: "TOGGLE_SELECT", dieId });
      this.diceRenderer.setSelected(dieId, false);
    });

    notificationService.show("Deselected All", "info");
  }

  handleUndo(): void {
    if (this.paused || this.animating) return;
    if (!isUndoAllowed(this.state.mode) || !canUndo(this.state)) return;

    // Get config for replay
    const settings = settingsService.getSettings();
    const config = {
      addD20: settings.game.addD20,
      addD4: settings.game.addD4,
      add2ndD10: settings.game.add2ndD10,
      d100Mode: settings.game.d100Mode,
    };

    // Undo last scoring action
    const newState = undo(this.state, config);
    if (newState !== this.state) {
      this.state = newState;

      // Update 3D renderer to match new state
      // Need to restore any dice that were scored and clear selections
      this.state.dice.forEach((die) => {
        if (die.inPlay && !die.scored && die.value > 0) {
          // Dice should be visible and unselected after undo
          this.diceRenderer.setSelected(die.id, this.state.selected.has(die.id));
        }
      });

      this.updateUI();
      notificationService.show("Score undone - reselect dice", "info");
    }
  }

  private handleRoll(): void {
    if (this.paused) return;

    // Invalid action reminder
    if (this.state.status === "ROLLED") {
      notificationService.show("Score Dice First!", "warning");
      hapticsService.invalid();
      return;
    }

    if (this.animating || this.state.status !== "READY") return;

    this.animating = true;
    this.dispatch({ t: "ROLL" });

    // Play roll sound and haptic feedback
    audioService.playSfx("roll");
    hapticsService.roll();

    this.diceRenderer.animateRoll(this.state.dice, () => {
      this.animating = false;
      this.selectedDieIndex = 0; // Reset keyboard navigation index
      this.updateUI();

      // Show notification after roll completes
      notificationService.show("Roll Complete!", "info");

      // Notify tutorial of roll action
      if (tutorialModal.isActive()) {
        tutorialModal.onPlayerAction('roll');
      }
    });
  }

  private handleScore(): void {
    if (this.paused) return;

    if (this.animating || this.state.status !== "ROLLED" || this.state.selected.size === 0) {
      return;
    }

    this.animating = true;
    const selected = new Set(this.state.selected);

    // Calculate points for notification
    const scoredDice = this.state.dice.filter((d) => selected.has(d.id));
    const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);

    // Play score sound and haptic feedback
    audioService.playSfx("score");
    hapticsService.score();

    this.diceRenderer.animateScore(this.state.dice, selected, () => {
      this.animating = false;
      this.updateUI();

      // Show score notification
      if (points === 0) {
        notificationService.show("🎉 Perfect Roll! +0", "success");
        // Celebrate perfect roll with particles
        this.scene.celebrateSuccess("perfect");
      } else {
        notificationService.show(`+${points}`, "success");
      }
    });

    this.dispatch({ t: "SCORE_SELECTED" });

    // Notify tutorial of score action
    if (tutorialModal.isActive()) {
      tutorialModal.onPlayerAction('score');
    }
  }

  handleNewGame(): void {
    this.gameOverController.hide();
    this.state = GameFlowController.createNewGame();
    GameFlowController.resetForNewGame(this.diceRenderer);
    this.animating = false;
    this.gameStartTime = Date.now();
    this.updateUI();
    notificationService.show("New Game!", "success");
  }

  startNewGame(): void {
    // Unpause if paused
    if (this.paused) {
      this.paused = false;
    }

    this.gameOverController.hide();
    this.state = GameFlowController.createNewGame();
    GameFlowController.updateHintMode(this.state, this.diceRow);
    GameFlowController.resetForNewGame(this.diceRenderer);
    this.animating = false;
    this.gameStartTime = Date.now();
    this.updateUI();
    notificationService.show("New Game Started!", "success");
  }

  private updateUI(): void {
    this.hud.update(this.state);
    this.diceRow.update(this.state);

    // Update multipurpose action button
    if (this.state.status === "READY") {
      this.actionBtn.textContent = "Roll";
      this.actionBtn.disabled = this.animating || this.paused;
      this.actionBtn.className = "primary";
      this.deselectBtn.style.display = "none";
    } else if (this.state.status === "ROLLED") {
      const hasSelection = this.state.selected.size > 0;
      if (hasSelection) {
        // Calculate points for button text
        const scoredDice = this.state.dice.filter((d) => this.state.selected.has(d.id));
        const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
        this.actionBtn.textContent = `Score +${points} (Space)`;
        this.actionBtn.disabled = this.animating || this.paused;
        this.actionBtn.className = "primary";
        this.deselectBtn.style.display = "inline-block";
      } else {
        this.actionBtn.textContent = "Select Dice to Score";
        this.actionBtn.disabled = true;
        this.actionBtn.className = "";
        this.deselectBtn.style.display = "none";
      }
    } else {
      this.actionBtn.disabled = true;
      this.deselectBtn.style.display = "none";
    }

    // Update undo button (only visible in Easy Mode after scoring)
    // Show undo when: Easy Mode + player has scored at least once + ready for next roll or still in rolled state
    if (isUndoAllowed(this.state.mode) && canUndo(this.state) && (this.state.status === "READY" || this.state.status === "ROLLED")) {
      this.undoBtn.style.display = "inline-block";
      this.undoBtn.disabled = this.animating || this.paused;
    } else {
      this.undoBtn.style.display = "none";
    }
  }
}

// Initialize theme manager first, then create everything else
let settingsModal: SettingsModal;
let leaderboardModal: LeaderboardModal;
let rulesModal: RulesModal;
let tutorialModal: TutorialModal;
let splash: SplashScreen;
let alphaWarning: AlphaWarningModal;
let updatesPanel: UpdatesPanel;

themeManager.initialize().then(() => {
  log.info("Theme manager initialized successfully");

  // Now create modals after theme manager is ready
  settingsModal = new SettingsModal();
  leaderboardModal = new LeaderboardModal();
  rulesModal = new RulesModal();
  tutorialModal = new TutorialModal();

  // Initialize alpha warning and updates panel
  alphaWarning = new AlphaWarningModal();
  updatesPanel = new UpdatesPanel();

  // Show alpha warning on first visit
  if (!AlphaWarningModal.hasSeenWarning()) {
    setTimeout(() => {
      alphaWarning.show();
    }, 1000); // Show after 1 second delay
  }

  // Create splash screen after theme manager is ready
  splash = new SplashScreen(
    () => {
      // On start game
      new Game();
    },
    () => {
      // On settings
      settingsModal.show();
    },
    () => {
      // On leaderboard
      leaderboardModal.show();
    },
    () => {
      // On rules
      rulesModal.show();
    }
  );
}).catch((error) => {
  log.error("Failed to initialize theme manager:", error);

  // Create modals and splash anyway even if theme loading failed
  settingsModal = new SettingsModal();
  leaderboardModal = new LeaderboardModal();
  rulesModal = new RulesModal();
  tutorialModal = new TutorialModal();

  // Initialize alpha warning and updates panel (even on error)
  alphaWarning = new AlphaWarningModal();
  updatesPanel = new UpdatesPanel();

  // Show alpha warning on first visit
  if (!AlphaWarningModal.hasSeenWarning()) {
    setTimeout(() => {
      alphaWarning.show();
    }, 1000);
  }

  splash = new SplashScreen(
    () => {
      // On start game
      new Game();
    },
    () => {
      // On settings
      settingsModal.show();
    },
    () => {
      // On leaderboard
      leaderboardModal.show();
    },
    () => {
      // On rules
      rulesModal.show();
    }
  );
});
