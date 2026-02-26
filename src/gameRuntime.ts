import { GameScene } from "./render/scene.js";
import { DiceRenderer } from "./render/dice.js";
import { HUD } from "./ui/hud.js";
import { DiceRow } from "./ui/diceRow.js";
import { SettingsModal } from "./ui/settings.js";
import { LeaderboardModal } from "./ui/leaderboard.js";
import { RulesModal } from "./ui/rules.js";
import { TutorialModal } from "./ui/tutorial.js";
import { DebugView } from "./ui/debugView.js";
import { CameraControlsPanel } from "./ui/cameraControls.js";
import { ChaosUpgradeMenu } from "./ui/chaosUpgradeMenu.js";
import { EffectHUD } from "./ui/effectHUD.js";
import { ProfileModal } from "./ui/profile.js";
import { SessionExpiryModal } from "./ui/sessionExpiryModal.js";
import { confirmAction } from "./ui/confirmModal.js";
import { notificationService } from "./ui/notifications.js";
import { reduce, undo, canUndo } from "./game/state.js";
import { GameState, Action, GameDifficulty } from "./engine/types.js";
import { Color3, PointerEventTypes, Vector3 } from "@babylonjs/core";
import { audioService } from "./services/audio.js";
import { hapticsService } from "./services/haptics.js";
import { settingsService } from "./services/settings.js";
import { ControlInversionService } from "./services/controlInversion.js";
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
import {
  MultiplayerNetworkService,
  type MultiplayerGameUpdateMessage,
  type MultiplayerPlayerNotificationMessage,
  type MultiplayerSessionStateMessage,
  type MultiplayerTurnAutoAdvancedMessage,
  type MultiplayerTurnActionMessage,
  type MultiplayerTurnEndMessage,
  type MultiplayerTurnPhase,
  type MultiplayerTurnStartMessage,
  type MultiplayerTurnTimeoutWarningMessage,
} from "./multiplayer/networkService.js";
import { MultiplayerSessionService } from "./multiplayer/sessionService.js";
import { environment } from "@env";
import type {
  MultiplayerSessionParticipant,
  MultiplayerSessionRecord,
} from "./services/backendApi.js";
import { leaderboardService } from "./services/leaderboard.js";
import {
  buildClockwiseTurnPlan,
  type MultiplayerTurnPlan,
} from "./multiplayer/turnPlanner.js";
import { resolveSessionExpiryOutcome } from "./multiplayer/sessionExpiryFlow.js";

const log = logger.create('Game');

export type GamePlayMode = "solo" | "multiplayer";

export interface MultiplayerBootstrapOptions {
  roomCode?: string;
  botCount?: number;
  sessionId?: string;
}

interface GameSessionBootstrapOptions {
  playMode: GamePlayMode;
  multiplayer?: MultiplayerBootstrapOptions;
}

interface SeatedMultiplayerParticipant {
  playerId: string;
  displayName: string;
  seatIndex: number;
  isBot: boolean;
  isReady: boolean;
  score: number;
  remainingDice: number;
  isComplete: boolean;
  completedAt: number | null;
}

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

function normalizeParticipantScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeRemainingDice(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeCompletedAt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
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
  private sessionExpiryModal: SessionExpiryModal;
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
  private readonly playMode: GamePlayMode;
  private readonly multiplayerOptions: MultiplayerBootstrapOptions;
  private multiplayerTurnPlan: MultiplayerTurnPlan | null = null;
  private activeTurnPlayerId: string | null = null;
  private activeRollServerId: string | null = null;
  private activeTurnDeadlineAt: number | null = null;
  private awaitingMultiplayerRoll = false;
  private pendingTurnEndSync = false;
  private lobbyRedirectInProgress = false;
  private sessionExpiryPromptActive = false;
  private sessionExpiryRecoveryInProgress = false;
  private hudClockHandle: ReturnType<typeof setInterval> | null = null;
  private participantSeatById = new Map<string, number>();
  private participantLabelById = new Map<string, string>();
  private lastTurnPlanPreview = "";
  private lastSessionComplete = false;

  private actionBtn: HTMLButtonElement;
  private deselectBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;

  constructor(sessionBootstrap: GameSessionBootstrapOptions) {
    this.playMode = sessionBootstrap.playMode;
    this.multiplayerOptions = sessionBootstrap.multiplayer ?? {};

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
    this.sessionExpiryModal = new SessionExpiryModal();
    this.setMultiplayerNetwork(this.getMultiplayerWsUrl());

    document.addEventListener("particle:network:receive", ((event: Event) => {
      const particleEvent = event as CustomEvent<ParticleNetworkEvent>;
      if (!particleEvent.detail) return;
      particleService.handleNetworkEvent(particleEvent.detail);
    }) as EventListener);

    document.addEventListener("multiplayer:connected", () => {
      particleService.enableNetworkSync(true);
      this.flushPendingTurnEndSync();
    });
    document.addEventListener("multiplayer:disconnected", () => {
      particleService.enableNetworkSync(false);
    });
    document.addEventListener("multiplayer:authExpired", () => {
      notificationService.show("Multiplayer auth expired, refreshing session...", "warning", 2200);
    });
    document.addEventListener("multiplayer:sessionExpired", ((event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string; sessionId?: string }>).detail;
      void this.handleMultiplayerSessionExpired(
        detail?.reason ?? "multiplayer_session_expired",
        detail?.sessionId
      );
    }) as EventListener);
    document.addEventListener("auth:sessionExpired", ((event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string }>).detail;
      if (!this.isMultiplayerTurnEnforced()) {
        notificationService.show("Session expired. Please reauthenticate.", "warning", 2600);
        return;
      }
      void this.handleMultiplayerSessionExpired(detail?.reason ?? "auth_session_expired");
    }) as EventListener);
    document.addEventListener("multiplayer:turn:start", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerTurnStartMessage>).detail;
      if (!detail?.playerId) return;
      this.handleMultiplayerTurnStart(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:turn:end", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerTurnEndMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerTurnEnd(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:turn:timeoutWarning", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerTurnTimeoutWarningMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerTurnTimeoutWarning(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:turn:autoAdvanced", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerTurnAutoAdvancedMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerTurnAutoAdvanced(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:turn:action", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerTurnActionMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerTurnAction(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:session:state", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerSessionStateMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerSessionState(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:error", ((event: Event) => {
      const detail = (event as CustomEvent<{ code?: string; message?: string }>).detail;
      if (!detail?.code) return;
      this.handleMultiplayerProtocolError(detail.code, detail.message);
    }) as EventListener);
    document.addEventListener("multiplayer:update:received", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerGameUpdateMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerRealtimeUpdate(detail);
    }) as EventListener);
    document.addEventListener("multiplayer:notification:received", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerPlayerNotificationMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerRealtimeNotification(detail);
    }) as EventListener);

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
    this.gameStartTime = Date.now();
    this.hud.setGameClockStart(this.gameStartTime);
    this.startHudClockTicker();
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
      profileModal,
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
    rulesModal.setOnReplayTutorial(() => {
      this.replayTutorialFromRules();
    });

    // Handle return to main menu / lobby from settings
    this.settingsModal.setOnReturnToLobby(() => {
      void this.returnToLobby();
    });

    // Handle player seat clicks for multiplayer invites
    this.scene.setPlayerSeatClickHandler((seatIndex: number) => {
      const activeSession = this.multiplayerSessionService.getActiveSession();
      if (activeSession) {
        notificationService.show(
          `Seat ${seatIndex + 1} is open. Invite others with room ${activeSession.roomCode}.`,
          "info",
          2600
        );
        void this.copySessionInviteLink(activeSession.sessionId);
        audioService.playSfx("click");
        return;
      }

      if (this.playMode === "multiplayer") {
        notificationService.show("Starting multiplayer session...", "info", 2200);
      } else {
        notificationService.show("Start a Multiplayer game from the splash screen to fill seats.", "info", 3000);
      }
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
      void this.handleModeChange(difficulty);
    });

    // Setup tutorial
    tutorialModal.setOnComplete(() => {
      this.queueTutorialCompletionUndo();
      // After tutorial, sync mode and update hint mode based on actual difficulty setting
      GameFlowController.syncModeWithSettings(this.state);
      GameFlowController.updateHintMode(this.state, this.diceRow);
      this.updateUI();
    });
    tutorialModal.setOnRequestOpenAudioSettings(() => {
      this.openTutorialAudioSettings();
    });
    tutorialModal.setOnRequestOpenGraphicsSettings(() => {
      this.openTutorialGraphicsSettings();
    });
    tutorialModal.setOnRequestCloseAuxiliaryModals(() => {
      if (this.settingsModal.isVisible()) {
        this.settingsModal.hide();
      }
      if (rulesModal.isVisible()) {
        rulesModal.hide();
      }
      if (this.leaderboardModal.isVisible()) {
        this.leaderboardModal.hide();
      }
      if (profileModal.isVisible()) {
        profileModal.hide();
      }
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
    this.hud.setGameClockStart(this.gameStartTime);
  }

  private startHudClockTicker(): void {
    if (this.hudClockHandle) {
      clearInterval(this.hudClockHandle);
    }
    this.hudClockHandle = setInterval(() => {
      this.hud.tick();
    }, 250);
  }

  private syncHudTurnTimer(): void {
    this.hud.setTurnDeadline(this.activeTurnDeadlineAt);
  }

  private applyTurnTiming(deadlineAt?: number | null): void {
    this.activeTurnDeadlineAt =
      typeof deadlineAt === "number" && Number.isFinite(deadlineAt) && deadlineAt > 0
        ? Math.floor(deadlineAt)
        : null;
    this.syncHudTurnTimer();
  }

  private getMultiplayerWsUrl(): string | undefined {
    // Socket auth requires session + token from join/create API responses.
    // Boot with networking disabled, then rebind after session join in
    // initializeBackendSyncAndMultiplayerSession().
    return undefined;
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
    void leaderboardService.flushPendingScores();

    void this.bootstrapMultiplayerSession();
  }

  private async bootstrapMultiplayerSession(): Promise<void> {
    const query = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = query.get("session")?.trim() ?? "";
    const sessionIdFromOption =
      typeof this.multiplayerOptions.sessionId === "string"
        ? this.multiplayerOptions.sessionId.trim()
        : "";
    const targetSessionId = sessionIdFromOption || sessionIdFromUrl;
    const fromInviteLink = targetSessionId.length > 0 && targetSessionId === sessionIdFromUrl;
    if (targetSessionId) {
      const joined = await this.joinMultiplayerSession(targetSessionId, fromInviteLink);
      if (joined || fromInviteLink) {
        return;
      }
      notificationService.show("Selected room unavailable. Creating a new room instead.", "warning", 2800);
    }

    if (!environment.features.multiplayer || this.playMode !== "multiplayer") {
      return;
    }

    const createdSession = await this.multiplayerSessionService.createSession({
      roomCode: this.multiplayerOptions.roomCode,
      botCount: this.multiplayerOptions.botCount,
      gameDifficulty: this.state.mode.difficulty,
    });
    if (!createdSession) {
      notificationService.show("Failed to create multiplayer session. Continuing in solo mode.", "warning", 2800);
      return;
    }

    this.bindMultiplayerSession(createdSession, true);
    const botCount = Math.max(0, Math.floor(this.multiplayerOptions.botCount ?? 0));
    if (botCount > 0) {
      notificationService.show(
        `Multiplayer session ready (${createdSession.roomCode}) with ${botCount} bot${botCount === 1 ? "" : "s"}.`,
        "success",
        3200
      );
      return;
    }

    notificationService.show(
      `Multiplayer session ready. Room code: ${createdSession.roomCode}`,
      "success",
      3200
    );
  }

  private async joinMultiplayerSession(
    sessionId: string,
    fromInviteLink: boolean,
    options?: { suppressFailureNotification?: boolean }
  ): Promise<boolean> {
    playerDataSyncService.setSessionId(sessionId);
    const session = await this.multiplayerSessionService.joinSession(sessionId);
    if (!session) {
      playerDataSyncService.setSessionId(undefined);
      if (!options?.suppressFailureNotification) {
        notificationService.show("Unable to join multiplayer session.", "error", 2600);
      }
      return false;
    }

    this.bindMultiplayerSession(session, !fromInviteLink);
    if (fromInviteLink) {
      notificationService.show(`Joined multiplayer room ${session.roomCode}.`, "success", 2600);
    }
    return true;
  }

  private bindMultiplayerSession(
    session: MultiplayerSessionRecord,
    updateUrlSessionParam: boolean
  ): void {
    playerDataSyncService.setSessionId(session.sessionId);
    this.sessionExpiryPromptActive = false;
    this.lastTurnPlanPreview = "";
    this.applyMultiplayerSeatState(session);

    const sessionWsUrl = this.buildSessionWsUrl(session);
    if (sessionWsUrl) {
      this.setMultiplayerNetwork(sessionWsUrl);
      log.info(`Rebound multiplayer network to session socket: ${session.sessionId}`);
    }

    if (updateUrlSessionParam) {
      this.updateSessionQueryParam(session.sessionId);
    }

    log.info(`Joined multiplayer session via API scaffold: ${session.sessionId}`);
  }

  private applyMultiplayerSeatState(session: MultiplayerSessionRecord): void {
    const seatedParticipants = this.computeSeatedParticipants(session);
    const participantBySeat = new Map<number, SeatedMultiplayerParticipant>();
    const previousParticipantIds = new Set(this.participantSeatById.keys());
    this.participantSeatById.clear();
    this.participantLabelById.clear();
    const showReadyState =
      seatedParticipants.filter((participant) => !participant.isBot && !participant.isComplete)
        .length > 1;
    seatedParticipants.forEach((participant) => {
      participantBySeat.set(participant.seatIndex, participant);
      const isCurrentPlayer = participant.playerId === this.localPlayerId;
      this.participantSeatById.set(participant.playerId, participant.seatIndex);
      this.participantLabelById.set(
        participant.playerId,
        this.formatParticipantLabel(participant, isCurrentPlayer)
      );
    });
    const activeParticipantIds = new Set(seatedParticipants.map((participant) => participant.playerId));
    previousParticipantIds.forEach((playerId) => {
      if (!activeParticipantIds.has(playerId) && playerId !== this.localPlayerId) {
        this.diceRenderer.cancelSpectatorPreview(this.buildSpectatorPreviewKey(playerId));
      }
    });

    const seatCount = Math.max(1, this.scene.playerSeats.length || 8);
    const currentSeatIndex = this.scene.currentPlayerSeat;

    for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
      const participant = participantBySeat.get(seatIndex);
      if (participant) {
        const isCurrentPlayer = participant.playerId === this.localPlayerId;
        this.scene.playerSeatRenderer.updateSeat(seatIndex, {
          occupied: true,
          isCurrentPlayer,
          isBot: participant.isBot,
          playerName: this.formatSeatDisplayName(participant, isCurrentPlayer, showReadyState),
          avatarColor: this.resolveSeatColor(participant, isCurrentPlayer),
          score: participant.score,
          isComplete: participant.isComplete,
        });
        continue;
      }

      const isCurrentSeat = seatIndex === currentSeatIndex;
      this.scene.playerSeatRenderer.updateSeat(seatIndex, {
        occupied: isCurrentSeat,
        isCurrentPlayer: isCurrentSeat,
        isBot: false,
        playerName: isCurrentSeat ? "YOU" : "Empty",
        avatarColor: isCurrentSeat ? new Color3(0.24, 0.84, 0.36) : undefined,
        score: isCurrentSeat ? this.state.score : undefined,
        isComplete: false,
      });
    }

    this.multiplayerTurnPlan = buildClockwiseTurnPlan(
      seatedParticipants.map((participant) => ({
        playerId: participant.playerId,
        displayName: this.formatParticipantLabel(
          participant,
          participant.playerId === this.localPlayerId
        ),
        seatIndex: participant.seatIndex,
        isBot: participant.isBot,
      })),
      currentSeatIndex
    );

    if (this.multiplayerTurnPlan.order.length > 1) {
      const preview = this.buildTurnPlanPreview(this.multiplayerTurnPlan);
      if (preview !== this.lastTurnPlanPreview) {
        this.lastTurnPlanPreview = preview;
        log.info(`Clockwise turn order planned (${session.sessionId}): ${preview}`);
        notificationService.show(`Turn order (clockwise): ${preview}`, "info", 3400);
      }
    } else {
      this.lastTurnPlanPreview = "";
    }

    this.updateMultiplayerStandingsHud(session, seatedParticipants);
    this.applyTurnStateFromSession(session);
  }

  private applySoloSeatState(): void {
    this.participantSeatById.clear();
    this.participantLabelById.clear();
    this.multiplayerTurnPlan = null;

    const seatCount = Math.max(1, this.scene.playerSeats.length || 8);
    const currentSeatIndex = this.scene.currentPlayerSeat;
    for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
      const isCurrentSeat = seatIndex === currentSeatIndex;
      this.scene.playerSeatRenderer.updateSeat(seatIndex, {
        occupied: isCurrentSeat,
        isCurrentPlayer: isCurrentSeat,
        isBot: false,
        playerName: isCurrentSeat ? "YOU" : "Empty",
        avatarColor: isCurrentSeat ? new Color3(0.24, 0.84, 0.36) : undefined,
        score: isCurrentSeat ? this.state.score : undefined,
        isComplete: false,
      });
    }
    this.scene.playerSeatRenderer.highlightSeat(currentSeatIndex);
    this.hud.setMultiplayerStandings([], null);
    this.hud.setMultiplayerActiveTurn(null);
  }

  private computeSeatedParticipants(session: MultiplayerSessionRecord): SeatedMultiplayerParticipant[] {
    const normalizedParticipants = this.normalizeSessionParticipants(session.participants);
    const seatCount = Math.max(2, this.scene.playerSeats.length || 8);
    const currentSeatIndex = this.scene.currentPlayerSeat;
    const availableSeats: number[] = [];

    for (let offset = 1; offset < seatCount; offset += 1) {
      availableSeats.push((currentSeatIndex + offset) % seatCount);
    }

    const localParticipant = normalizedParticipants.find(
      (participant) => participant.playerId === this.localPlayerId
    );

    const seated: SeatedMultiplayerParticipant[] = [];
    seated.push({
      playerId: this.localPlayerId,
      displayName: localParticipant?.displayName ?? "You",
      seatIndex: currentSeatIndex,
      isBot: false,
      isReady: localParticipant?.isReady === true,
      score: normalizeParticipantScore(localParticipant?.score),
      remainingDice: normalizeRemainingDice(localParticipant?.remainingDice),
      isComplete: localParticipant?.isComplete === true,
      completedAt: normalizeCompletedAt(localParticipant?.completedAt),
    });

    const others = normalizedParticipants.filter(
      (participant) => participant.playerId !== this.localPlayerId
    );

    others.slice(0, availableSeats.length).forEach((participant, index) => {
      seated.push({
        playerId: participant.playerId,
        displayName: participant.displayName,
        seatIndex: availableSeats[index],
        isBot: participant.isBot,
        isReady: participant.isReady,
        score: participant.score,
        remainingDice: participant.remainingDice,
        isComplete: participant.isComplete,
        completedAt: participant.completedAt,
      });
    });

    return seated;
  }

  private normalizeSessionParticipants(
    participants: MultiplayerSessionParticipant[] | undefined
  ): Array<{
    playerId: string;
    displayName: string;
    isBot: boolean;
    isReady: boolean;
    score: number;
    remainingDice: number;
    isComplete: boolean;
    completedAt: number | null;
    joinedAt: number;
  }> {
    const seen = new Map<
      string,
      {
        playerId: string;
        displayName: string;
        isBot: boolean;
        isReady: boolean;
        score: number;
        remainingDice: number;
        isComplete: boolean;
        completedAt: number | null;
        joinedAt: number;
      }
    >();
    const list = Array.isArray(participants) ? participants : [];

    list.forEach((participant) => {
      if (!participant || typeof participant.playerId !== "string") {
        return;
      }

      const playerId = participant.playerId.trim();
      if (!playerId) {
        return;
      }

      const displayName =
        typeof participant.displayName === "string" && participant.displayName.trim().length > 0
          ? participant.displayName.trim()
          : this.buildDefaultParticipantName(playerId, Boolean(participant.isBot));

      seen.set(playerId, {
        playerId,
        displayName,
        isBot: Boolean(participant.isBot),
        isReady: Boolean(participant.isBot) ? true : participant.isReady === true,
        score: normalizeParticipantScore(participant.score),
        remainingDice: normalizeRemainingDice(participant.remainingDice),
        isComplete: participant.isComplete === true,
        completedAt: normalizeCompletedAt(participant.completedAt),
        joinedAt:
          typeof participant.joinedAt === "number" && Number.isFinite(participant.joinedAt)
            ? participant.joinedAt
            : 0,
      });
    });

    if (!seen.has(this.localPlayerId)) {
      seen.set(this.localPlayerId, {
        playerId: this.localPlayerId,
        displayName: "You",
        isBot: false,
        isReady: true,
        score: normalizeParticipantScore(this.state.score),
        remainingDice: 0,
        isComplete: false,
        completedAt: null,
        joinedAt: -1,
      });
    }

    return Array.from(seen.values()).sort((left, right) => {
      if (left.playerId === this.localPlayerId && right.playerId !== this.localPlayerId) {
        return -1;
      }
      if (right.playerId === this.localPlayerId && left.playerId !== this.localPlayerId) {
        return 1;
      }

      const joinedDelta = left.joinedAt - right.joinedAt;
      if (joinedDelta !== 0) {
        return joinedDelta;
      }

      return left.playerId.localeCompare(right.playerId);
    });
  }

  private buildDefaultParticipantName(playerId: string, isBot: boolean): string {
    if (isBot) {
      return `Bot ${playerId.slice(-3).toUpperCase()}`;
    }
    return `Player ${playerId.slice(0, 4)}`;
  }

  private formatParticipantLabel(
    participant: SeatedMultiplayerParticipant,
    isCurrentPlayer: boolean
  ): string {
    if (isCurrentPlayer) {
      return "YOU";
    }

    const baseName = participant.displayName.trim() || this.buildDefaultParticipantName(participant.playerId, participant.isBot);
    const label = participant.isBot ? `BOT ${baseName}` : baseName;
    return label.slice(0, 20);
  }

  private formatSeatDisplayName(
    participant: SeatedMultiplayerParticipant,
    isCurrentPlayer: boolean,
    showReadyState: boolean
  ): string {
    const label = this.formatParticipantLabel(participant, isCurrentPlayer);
    if (participant.isComplete) {
      return `${label} • DONE`.slice(0, 24);
    }
    const readinessText =
      !participant.isBot && showReadyState
        ? participant.isReady
          ? " • READY"
          : " • WAIT"
        : "";
    return `${label}${readinessText}`.slice(0, 24);
  }

  private resolveSeatColor(
    participant: SeatedMultiplayerParticipant,
    isCurrentPlayer: boolean
  ): Color3 {
    if (isCurrentPlayer) {
      return new Color3(0.24, 0.84, 0.36);
    }
    if (participant.isBot) {
      return new Color3(0.84, 0.52, 0.24);
    }
    return new Color3(0.36, 0.62, 0.9);
  }

  private buildTurnPlanPreview(plan: MultiplayerTurnPlan): string {
    const labels = plan.order.map((participant) => participant.displayName);
    if (labels.length <= 5) {
      return labels.join(" -> ");
    }
    return `${labels.slice(0, 5).join(" -> ")} -> ...`;
  }

  private updateMultiplayerStandingsHud(
    session: MultiplayerSessionRecord,
    seatedParticipants: SeatedMultiplayerParticipant[]
  ): void {
    const participants = Array.isArray(session.standings) && session.standings.length > 0
      ? session.standings
      : seatedParticipants.map((participant) => ({
          playerId: participant.playerId,
          displayName: participant.displayName,
          isBot: participant.isBot,
          score: participant.score,
          isComplete: participant.isComplete,
          placement: 0,
        }));

    const entries = participants.map((participant, index) => {
      const playerId = participant.playerId;
      const label =
        playerId === this.localPlayerId
          ? "YOU"
          : this.participantLabelById.get(playerId) ??
            (participant.displayName?.trim() ||
              this.buildDefaultParticipantName(playerId, Boolean(participant.isBot)));
      return {
        playerId,
        label,
        score: normalizeParticipantScore(participant.score),
        placement:
          typeof participant.placement === "number" && Number.isFinite(participant.placement)
            ? Math.max(1, Math.floor(participant.placement))
            : index + 1,
        isBot: Boolean(participant.isBot),
        isComplete: participant.isComplete === true,
        isCurrentPlayer: playerId === this.localPlayerId,
      };
    });

    this.hud.setMultiplayerStandings(entries, session.turnState?.activeTurnPlayerId ?? null);
  }

  private applyTurnStateFromSession(session: MultiplayerSessionRecord): void {
    this.awaitingMultiplayerRoll = false;
    this.applyTurnTiming(session.turnState?.turnExpiresAt);
    const serverActiveTurnPlayerId = session.turnState?.activeTurnPlayerId ?? null;
    this.hud.setMultiplayerActiveTurn(serverActiveTurnPlayerId);
    if (serverActiveTurnPlayerId) {
      this.activeTurnPlayerId = serverActiveTurnPlayerId;
      this.activeRollServerId =
        serverActiveTurnPlayerId === this.localPlayerId &&
        typeof session.turnState?.activeRollServerId === "string" &&
        session.turnState.activeRollServerId
          ? session.turnState.activeRollServerId
          : null;
      this.updateTurnSeatHighlight(serverActiveTurnPlayerId);
      this.recoverLocalTurnFromSnapshot(
        serverActiveTurnPlayerId,
        session.turnState?.phase,
        session.turnState?.activeRoll
      );
      return;
    }

    if (this.isMultiplayerTurnEnforced()) {
      this.activeTurnPlayerId = null;
      this.activeRollServerId = null;
      this.pendingTurnEndSync = false;
      this.applyTurnTiming(null);
      this.updateTurnSeatHighlight(null);
      return;
    }

    const fallbackActive =
      this.multiplayerTurnPlan?.order[0]?.playerId ??
      (this.playMode === "multiplayer" ? this.localPlayerId : null);
    this.activeTurnPlayerId = fallbackActive;
    this.activeRollServerId = null;
    this.pendingTurnEndSync = false;
    this.applyTurnTiming(null);
    this.updateTurnSeatHighlight(fallbackActive);
    this.hud.setMultiplayerActiveTurn(fallbackActive);
  }

  private updateTurnSeatHighlight(activePlayerId: string | null): void {
    if (!activePlayerId) {
      this.scene.playerSeatRenderer.highlightSeat(this.scene.currentPlayerSeat);
      return;
    }

    const seatIndex = this.participantSeatById.get(activePlayerId);
    if (typeof seatIndex === "number") {
      this.scene.playerSeatRenderer.highlightSeat(seatIndex);
      return;
    }

    this.scene.playerSeatRenderer.highlightSeat(this.scene.currentPlayerSeat);
  }

  private getSeatScoreZonePosition(playerId: string): { seatIndex: number; x: number; y: number; z: number } | null {
    const seatIndex = this.participantSeatById.get(playerId);
    if (typeof seatIndex !== "number") {
      return null;
    }
    const center = this.scene.playerSeatRenderer.getSeatScoreZonePosition(seatIndex);
    if (!center) {
      return null;
    }
    return {
      seatIndex,
      x: center.x,
      y: center.y,
      z: center.z,
    };
  }

  private buildSpectatorPreviewKey(playerId: string): string {
    const sessionId =
      this.multiplayerSessionService.getActiveSession()?.sessionId ??
      this.multiplayerOptions.roomCode ??
      "multiplayer";
    return `${sessionId}:${playerId}`;
  }

  private clearSpectatorRollingPreviewForPlayer(playerId: string | null | undefined): void {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      return;
    }
    this.diceRenderer.clearSpectatorRollingPreview(this.buildSpectatorPreviewKey(targetPlayerId));
  }

  private getParticipantLabel(playerId: string): string {
    if (playerId === this.localPlayerId) {
      return "YOU";
    }
    const label = this.participantLabelById.get(playerId);
    if (label) {
      return label;
    }
    return `Player ${playerId.slice(0, 4)}`;
  }

  private isBotParticipant(playerId: string): boolean {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants.some(
      (participant) =>
        participant?.playerId === playerId &&
        participant.isBot === true
    );
  }

  private showSeatBubbleForPlayer(
    playerId: string | null | undefined,
    message: string,
    options?: { tone?: "info" | "success" | "warning" | "error"; durationMs?: number; isBot?: boolean }
  ): boolean {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!targetPlayerId) {
      return false;
    }
    const seatIndex = this.participantSeatById.get(targetPlayerId);
    if (typeof seatIndex !== "number") {
      return false;
    }
    const normalizedMessage =
      typeof message === "string" ? message.trim().replace(/\s+/g, " ") : "";
    if (!normalizedMessage) {
      return false;
    }
    this.scene.playerSeatRenderer.showSeatChatBubble(seatIndex, normalizedMessage, {
      tone: options?.tone ?? "info",
      durationMs: options?.durationMs,
      isBot: options?.isBot ?? this.isBotParticipant(targetPlayerId),
    });
    return true;
  }

  private normalizeParticipantLookupToken(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/^bot\s+/, "")
      .replace(/\s+update$/, "");
  }

  private resolvePlayerIdByParticipantToken(token: string): string | null {
    const normalizedToken = this.normalizeParticipantLookupToken(token);
    if (!normalizedToken) {
      return null;
    }

    for (const [playerId, label] of this.participantLabelById.entries()) {
      if (this.normalizeParticipantLookupToken(label) === normalizedToken) {
        return playerId;
      }
    }

    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    for (const participant of participants) {
      if (!participant || typeof participant.playerId !== "string") {
        continue;
      }
      const displayName =
        typeof participant.displayName === "string" ? participant.displayName : "";
      if (this.normalizeParticipantLookupToken(displayName) === normalizedToken) {
        return participant.playerId;
      }
    }

    return null;
  }

  private resolveRealtimeSourcePlayerId(
    payload: MultiplayerGameUpdateMessage | MultiplayerPlayerNotificationMessage
  ): string | null {
    const sourcePlayerId =
      typeof payload.sourcePlayerId === "string" ? payload.sourcePlayerId.trim() : "";
    if (sourcePlayerId && this.participantSeatById.has(sourcePlayerId)) {
      return sourcePlayerId;
    }

    const fallbackPlayerId = typeof payload.playerId === "string" ? payload.playerId.trim() : "";
    if (fallbackPlayerId && this.participantSeatById.has(fallbackPlayerId)) {
      return fallbackPlayerId;
    }

    if (typeof payload.title === "string" && payload.title.trim()) {
      return this.resolvePlayerIdByParticipantToken(payload.title.trim());
    }

    return null;
  }

  private handleMultiplayerRealtimeUpdate(payload: MultiplayerGameUpdateMessage): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }
    const sourcePlayerId = this.resolveRealtimeSourcePlayerId(payload);
    if (!sourcePlayerId || sourcePlayerId === this.localPlayerId) {
      return;
    }

    const message = payload.content?.trim() || payload.title?.trim();
    if (!message) {
      return;
    }

    this.showSeatBubbleForPlayer(sourcePlayerId, message, {
      tone: "info",
      durationMs: 3200,
      isBot: payload.bot === true,
    });
  }

  private handleMultiplayerRealtimeNotification(
    payload: MultiplayerPlayerNotificationMessage
  ): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }
    if (payload.targetPlayerId && payload.targetPlayerId !== this.localPlayerId) {
      return;
    }

    const message = payload.message?.trim();
    if (!message) {
      return;
    }

    const sourcePlayerId = this.resolveRealtimeSourcePlayerId(payload);
    const tone =
      payload.severity === "success" ||
      payload.severity === "warning" ||
      payload.severity === "error"
        ? payload.severity
        : "info";

    if (sourcePlayerId && sourcePlayerId !== this.localPlayerId) {
      const bubbled = this.showSeatBubbleForPlayer(sourcePlayerId, message, {
        tone,
        durationMs: 3200,
        isBot: payload.bot === true,
      });
      if (bubbled) {
        return;
      }
    }

    if (tone === "warning" || tone === "error") {
      const title = payload.title?.trim() || "Multiplayer";
      notificationService.show(`${title}: ${message}`, tone, 3200);
    }
  }

  private handleMultiplayerSessionState(message: MultiplayerSessionStateMessage): void {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession) {
      return;
    }
    if (message.sessionId !== activeSession.sessionId) {
      return;
    }

    const hasTurnState = Object.prototype.hasOwnProperty.call(message, "turnState");
    const hasStandings = Object.prototype.hasOwnProperty.call(message, "standings");
    const hasCompletedAt = Object.prototype.hasOwnProperty.call(message, "completedAt");
    const syncedSession = this.multiplayerSessionService.syncSessionState({
      sessionId: message.sessionId,
      roomCode: message.roomCode,
      gameDifficulty: message.gameDifficulty,
      participants: message.participants,
      ...(hasStandings ? { standings: message.standings } : {}),
      ...(hasTurnState ? { turnState: message.turnState ?? null } : {}),
      ...(typeof message.sessionComplete === "boolean"
        ? { sessionComplete: message.sessionComplete }
        : {}),
      ...(hasCompletedAt
        ? { completedAt: message.completedAt ?? null }
        : {}),
      ...(typeof message.expiresAt === "number" && Number.isFinite(message.expiresAt)
        ? { expiresAt: message.expiresAt }
        : {}),
    });
    if (!syncedSession) {
      return;
    }

    this.applyMultiplayerSeatState(syncedSession);
    if (syncedSession.sessionComplete === true && !this.lastSessionComplete) {
      this.lastSessionComplete = true;
      notificationService.show("Session complete. Final standings locked.", "success", 2600);
    } else if (syncedSession.sessionComplete !== true) {
      this.lastSessionComplete = false;
    }
  }

  private handleMultiplayerTurnStart(message: MultiplayerTurnStartMessage): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    const previousActiveTurnPlayerId = this.activeTurnPlayerId;
    this.awaitingMultiplayerRoll = false;
    this.applyTurnTiming(message.turnExpiresAt ?? null);
    this.activeTurnPlayerId = message.playerId;
    this.hud.setMultiplayerActiveTurn(message.playerId);
    this.activeRollServerId =
      message.playerId === this.localPlayerId &&
      typeof message.activeRollServerId === "string" &&
      message.activeRollServerId
        ? message.activeRollServerId
        : null;
    this.updateTurnSeatHighlight(message.playerId);
    this.recoverLocalTurnFromSnapshot(
      message.playerId,
      message.phase,
      message.activeRoll
    );
    if (previousActiveTurnPlayerId && previousActiveTurnPlayerId !== message.playerId) {
      this.clearSpectatorRollingPreviewForPlayer(previousActiveTurnPlayerId);
    }

    if (message.playerId === this.localPlayerId) {
      const suffix =
        typeof message.round === "number" && Number.isFinite(message.round)
          ? ` (Round ${Math.floor(message.round)})`
          : "";
      notificationService.show(`Your turn${suffix}`, "success", 1800);
      return;
    }

    this.showSeatBubbleForPlayer(message.playerId, "My turn", {
      tone: "info",
      durationMs: 1800,
    });
  }

  private handleMultiplayerTurnEnd(message: MultiplayerTurnEndMessage): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    this.pendingTurnEndSync = false;
    this.applyTurnTiming(null);
    this.hud.setMultiplayerActiveTurn(null);
    if (typeof message.playerId !== "string" || !message.playerId) {
      return;
    }

    if (message.playerId === this.localPlayerId) {
      notificationService.show("Turn ended", "info", 1200);
      return;
    }

    this.clearSpectatorRollingPreviewForPlayer(message.playerId);

    this.showSeatBubbleForPlayer(message.playerId, "Turn ended", {
      tone: "info",
      durationMs: 1500,
    });
  }

  private handleMultiplayerTurnTimeoutWarning(
    message: MultiplayerTurnTimeoutWarningMessage
  ): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    const expiresAt =
      typeof message.turnExpiresAt === "number" && Number.isFinite(message.turnExpiresAt)
        ? message.turnExpiresAt
        : typeof message.remainingMs === "number" && Number.isFinite(message.remainingMs)
          ? Date.now() + Math.max(0, Math.floor(message.remainingMs))
          : null;
    this.applyTurnTiming(expiresAt);

    if (!message.playerId || message.playerId !== this.activeTurnPlayerId) {
      return;
    }

    const remainingMs =
      typeof message.remainingMs === "number" && Number.isFinite(message.remainingMs)
        ? Math.max(0, Math.floor(message.remainingMs))
        : expiresAt
          ? Math.max(0, expiresAt - Date.now())
          : 0;
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    this.showSeatBubbleForPlayer(message.playerId, `${remainingSeconds}s left`, {
      tone: "warning",
      durationMs: 1700,
    });
  }

  private handleMultiplayerTurnAutoAdvanced(
    message: MultiplayerTurnAutoAdvancedMessage
  ): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    this.applyTurnTiming(null);
    const playerId = typeof message.playerId === "string" ? message.playerId : "";
    if (!playerId) {
      return;
    }
    this.clearSpectatorRollingPreviewForPlayer(playerId);
    this.showSeatBubbleForPlayer(playerId, "Turn timed out", {
      tone: "warning",
      durationMs: 2000,
    });
  }

  private handleMultiplayerTurnAction(message: MultiplayerTurnActionMessage): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    if (!message?.playerId) {
      return;
    }

    if (message.playerId === this.localPlayerId) {
      if (message.action === "roll") {
        this.awaitingMultiplayerRoll = false;
        this.pendingTurnEndSync = false;
        this.activeRollServerId =
          typeof message.roll?.serverRollId === "string" && message.roll.serverRollId
            ? message.roll.serverRollId
            : null;

        if (this.isMultiplayerTurnEnforced()) {
          const applied = this.applyAuthoritativeRoll(message.roll);
          if (!applied) {
            this.activeRollServerId = null;
            notificationService.show("Turn roll sync failed. Retry your roll.", "warning", 2200);
          }
        }
      }
      return;
    }

    const seatScoreZone = this.getSeatScoreZonePosition(message.playerId);
    const spectatorPreviewKey = this.buildSpectatorPreviewKey(message.playerId);
    if (message.action === "roll" && seatScoreZone && message.roll) {
      this.diceRenderer.startSpectatorRollPreview(
        spectatorPreviewKey,
        message.roll,
        new Vector3(seatScoreZone.x, seatScoreZone.y, seatScoreZone.z)
      );
    }

    if (message.action === "score") {
      const scoreSelection = Array.isArray(message.score?.selectedDiceIds)
        ? message.score?.selectedDiceIds ?? []
        : [];
      const selectedDiceIds = scoreSelection.filter(
        (dieId): dieId is string => typeof dieId === "string" && dieId.trim().length > 0
      );
      const previewCompleted =
        selectedDiceIds.length > 0
          ? this.diceRenderer.completeSpectatorScorePreview(spectatorPreviewKey, selectedDiceIds)
          : false;

      if (!previewCompleted && seatScoreZone) {
        this.scene.playerSeatRenderer.pulseScoreZone(seatScoreZone.seatIndex);
        particleService.emit({
          effectId: "burst-gold",
          position: new Vector3(seatScoreZone.x, seatScoreZone.y + 0.45, seatScoreZone.z),
          options: {
            scale: 0.4,
            networkSync: false,
          },
        });
      }
    }

    const actionLabel = message.action === "score" ? "Scored" : "Rolled";
    const scoreSuffix =
      message.action === "score" &&
      typeof message.score?.points === "number" &&
      Number.isFinite(message.score.points)
        ? ` (+${Math.max(0, Math.floor(message.score.points))})`
        : "";
    this.showSeatBubbleForPlayer(message.playerId, `${actionLabel}${scoreSuffix}`, {
      tone: message.action === "score" ? "success" : "info",
      durationMs: 1400,
    });
  }

  private handleMultiplayerProtocolError(code: string, message?: string): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    if (code === "turn_not_active") {
      this.awaitingMultiplayerRoll = false;
      return;
    }

    if (code === "turn_action_required") {
      notificationService.show("Score before ending your turn.", "warning", 1800);
      return;
    }

    if (code === "turn_action_invalid_phase") {
      this.awaitingMultiplayerRoll = false;
      this.pendingTurnEndSync = false;
      notificationService.show("Turn sync conflict. Wait for turn update.", "warning", 2000);
      return;
    }

    if (code === "turn_action_invalid_score") {
      notificationService.show("Score validation failed. Re-roll this turn.", "warning", 2200);
      return;
    }

    if (code === "turn_action_invalid_payload") {
      this.awaitingMultiplayerRoll = false;
      notificationService.show("Turn payload rejected. Syncing...", "warning", 2200);
      return;
    }

    if (message) {
      log.warn("Multiplayer protocol warning", { code, message });
    }
  }

  private hasActiveHumanOpponent(): boolean {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants.some(
      (participant) =>
        participant &&
        participant.playerId !== this.localPlayerId &&
        !participant.isBot &&
        participant.isComplete !== true
    );
  }

  private hasActiveBotOpponent(): boolean {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants.some(
      (participant) =>
        participant &&
        participant.playerId !== this.localPlayerId &&
        participant.isBot === true &&
        participant.isComplete !== true
    );
  }

  private isMultiplayerTurnEnforced(): boolean {
    if (this.playMode !== "multiplayer" || !environment.features.multiplayer) {
      return false;
    }

    if (this.multiplayerSessionService.getActiveSession()?.sessionComplete === true) {
      return false;
    }

    if (this.hasActiveHumanOpponent()) {
      return true;
    }

    if (!this.hasActiveBotOpponent()) {
      return false;
    }

    // Bot-only sessions fall back to local play if socket sync is unavailable.
    return this.multiplayerNetwork?.isConnected() === true;
  }

  private canLocalPlayerTakeTurnAction(): boolean {
    if (!this.isMultiplayerTurnEnforced()) {
      return true;
    }

    if (!this.activeTurnPlayerId) {
      notificationService.show("Waiting for turn sync...", "warning", 1600);
      return false;
    }

    if (!this.isLocalPlayersTurn()) {
      notificationService.show(
        `Waiting for ${this.getParticipantLabel(this.activeTurnPlayerId)} turn`,
        "warning",
        1800
      );
      return false;
    }

    return true;
  }

  private isLocalPlayersTurn(): boolean {
    return this.activeTurnPlayerId === this.localPlayerId;
  }

  private recoverLocalTurnFromSnapshot(
    activePlayerId: string | null | undefined,
    phase: MultiplayerTurnPhase | undefined,
    activeRoll: MultiplayerTurnActionMessage["roll"] | null | undefined
  ): void {
    if (!this.isMultiplayerTurnEnforced() || activePlayerId !== this.localPlayerId) {
      this.pendingTurnEndSync = false;
      return;
    }

    if (phase === "ready_to_end") {
      this.pendingTurnEndSync = true;
      this.flushPendingTurnEndSync();
      return;
    }

    this.pendingTurnEndSync = false;
    if (phase !== "await_score" || this.state.status !== "READY") {
      return;
    }

    const restored = this.applyAuthoritativeRoll(activeRoll ?? undefined);
    if (!restored) {
      notificationService.show("Turn state sync incomplete. Roll to continue.", "warning", 1800);
    }
  }

  private flushPendingTurnEndSync(): void {
    if (!this.pendingTurnEndSync) {
      return;
    }
    if (!this.multiplayerNetwork?.isConnected()) {
      return;
    }

    this.pendingTurnEndSync = false;
    this.emitTurnEnd();
  }

  private emitTurnEnd(): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    if (!this.multiplayerNetwork?.isConnected()) {
      notificationService.show("Unable to end turn while disconnected.", "warning", 1800);
      return;
    }

    const activeSession = this.multiplayerSessionService.getActiveSession();
    const sent = this.multiplayerNetwork.sendTurnEnd({
      type: "turn_end",
      sessionId: activeSession?.sessionId,
      playerId: this.localPlayerId,
      timestamp: Date.now(),
    });
    if (!sent) {
      notificationService.show("Failed to signal turn end.", "warning", 1800);
    }
  }

  private emitTurnAction(
    action: "roll" | "score",
    details?: Pick<MultiplayerTurnActionMessage, "roll" | "score">
  ): boolean {
    if (!this.isMultiplayerTurnEnforced()) {
      return true;
    }

    if (!this.multiplayerNetwork?.isConnected()) {
      notificationService.show(
        `Unable to ${action} while disconnected.`,
        "warning",
        1800
      );
      return false;
    }

    const activeSession = this.multiplayerSessionService.getActiveSession();
    const sent = this.multiplayerNetwork.sendTurnAction({
      type: "turn_action",
      sessionId: activeSession?.sessionId,
      playerId: this.localPlayerId,
      action,
      ...details,
      timestamp: Date.now(),
    });
    if (!sent) {
      notificationService.show(`Failed to sync ${action} action.`, "warning", 1800);
      return false;
    }

    return true;
  }

  private buildRollTurnPayload(): {
    rollIndex: number;
    dice: Array<{ dieId: string; sides: number }>;
  } {
    const dice = this.state.dice
      .filter((die) => die.inPlay && !die.scored)
      .map((die) => ({
        dieId: die.id,
        sides: die.def.sides,
      }));

    return {
      rollIndex: this.state.rollIndex + 1,
      dice,
    };
  }

  private applyAuthoritativeRoll(roll: MultiplayerTurnActionMessage["roll"]): boolean {
    if (!roll || !Array.isArray(roll.dice)) {
      return false;
    }
    if (this.state.status !== "READY") {
      return this.state.status === "ROLLED";
    }

    const snapshotById = new Map<string, { sides: number; value: number }>();
    for (const die of roll.dice) {
      if (!die || typeof die !== "object") {
        return false;
      }
      const dieId = typeof die.dieId === "string" ? die.dieId.trim() : "";
      const sides = Number.isFinite(die.sides) ? Math.floor(die.sides) : NaN;
      const value =
        typeof die.value === "number" && Number.isFinite(die.value)
          ? Math.floor(die.value)
          : NaN;
      if (!dieId || !Number.isFinite(sides) || sides < 2 || !Number.isFinite(value)) {
        return false;
      }
      snapshotById.set(dieId, {
        sides,
        value: Math.max(1, Math.min(sides, value)),
      });
    }

    let invalidSnapshot = false;
    const rolledDice = this.state.dice.map((die) => {
      if (!die.inPlay || die.scored) {
        return die;
      }

      const snapshot = snapshotById.get(die.id);
      if (!snapshot) {
        invalidSnapshot = true;
        return die;
      }
      if (snapshot.sides !== die.def.sides) {
        invalidSnapshot = true;
        return die;
      }

      return {
        ...die,
        value: snapshot.value,
      };
    });
    if (invalidSnapshot) {
      return false;
    }

    const rollIndex =
      Number.isFinite(roll.rollIndex) && Math.floor(roll.rollIndex) > this.state.rollIndex
        ? Math.floor(roll.rollIndex)
        : this.state.rollIndex + 1;

    this.state = {
      ...this.state,
      dice: rolledDice,
      rollIndex,
      status: "ROLLED",
      selected: new Set(),
      actionLog: [...this.state.actionLog, { t: "ROLL" }],
    };
    this.updateUI();

    this.animating = true;
    audioService.playSfx("roll");
    hapticsService.roll();

    this.diceRenderer.animateRoll(this.state.dice, () => {
      this.animating = false;
      this.selectedDieIndex = 0;
      this.updateUI();
      notificationService.show("Roll Complete!", "info");

      if (tutorialModal.isActive()) {
        tutorialModal.onPlayerAction("roll");
      }
    });

    return true;
  }

  private buildScoreTurnPayload(
    selected: Set<string>,
    points: number,
    rollServerId: string
  ): {
    selectedDiceIds: string[];
    points: number;
    rollServerId: string;
    projectedTotalScore: number;
  } {
    return {
      selectedDiceIds: [...selected],
      points,
      rollServerId,
      projectedTotalScore: this.state.score + points,
    };
  }

  private updateSessionQueryParam(sessionId: string): void {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("session", sessionId);
    window.history.replaceState(window.history.state, "", currentUrl.toString());
  }

  private clearSessionQueryParam(): void {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("session");
    window.history.replaceState(window.history.state, "", currentUrl.toString());
  }

  private getRecoverySessionId(preferredSessionId?: string): string | null {
    const preferred = typeof preferredSessionId === "string" ? preferredSessionId.trim() : "";
    if (preferred) {
      return preferred;
    }

    const activeSessionId = this.multiplayerSessionService.getActiveSession()?.sessionId?.trim() ?? "";
    if (activeSessionId) {
      return activeSessionId;
    }

    const querySessionId = new URLSearchParams(window.location.search).get("session")?.trim() ?? "";
    if (querySessionId) {
      return querySessionId;
    }

    return null;
  }

  private async attemptMultiplayerSessionRecovery(
    reason: string,
    preferredSessionId?: string
  ): Promise<boolean> {
    const recoverySessionId = this.getRecoverySessionId(preferredSessionId);
    if (!recoverySessionId) {
      log.warn("Skipping multiplayer session recovery because no session id is available", { reason });
      return false;
    }

    if (this.sessionExpiryRecoveryInProgress) {
      return false;
    }

    this.sessionExpiryRecoveryInProgress = true;
    notificationService.show("Connection issue detected. Rejoining room...", "info", 2200);

    const retryDelaysMs = [0, 900];
    try {
      for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
        const delayMs = retryDelaysMs[attempt];
        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, delayMs);
          });
        }

        const joined = await this.joinMultiplayerSession(recoverySessionId, false, {
          suppressFailureNotification: true,
        });
        if (joined) {
          notificationService.show("Reconnected to multiplayer room.", "success", 2400);
          log.info("Recovered multiplayer session after expiry signal", {
            reason,
            sessionId: recoverySessionId,
            attempt: attempt + 1,
          });
          return true;
        }
      }
    } finally {
      this.sessionExpiryRecoveryInProgress = false;
    }

    log.warn("Failed to recover multiplayer session after expiry signal", {
      reason,
      sessionId: recoverySessionId,
    });
    return false;
  }

  private async handleMultiplayerSessionExpired(
    reason: string,
    preferredSessionId?: string
  ): Promise<void> {
    if (this.playMode !== "multiplayer" || !environment.features.multiplayer) {
      return;
    }
    if (this.lobbyRedirectInProgress) {
      return;
    }
    if (this.sessionExpiryRecoveryInProgress) {
      return;
    }
    if (this.sessionExpiryPromptActive) {
      return;
    }

    log.warn("Multiplayer session expired", { reason });
    const outcome = await resolveSessionExpiryOutcome({
      reason,
      preferredSessionId,
      attemptRecovery: async (expiryReason, sessionId) =>
        this.attemptMultiplayerSessionRecovery(expiryReason, sessionId),
      promptChoice: async (expiryReason) => {
        this.sessionExpiryPromptActive = true;
        notificationService.show("Multiplayer room expired or became inactive.", "warning", 2600);
        try {
          return await this.sessionExpiryModal.prompt(expiryReason);
        } finally {
          this.sessionExpiryPromptActive = false;
        }
      },
    });

    if (outcome === "recovered") {
      return;
    }
    if (outcome === "lobby") {
      void this.returnToLobby();
      return;
    }

    this.continueSoloAfterSessionExpiry(reason);
  }

  private continueSoloAfterSessionExpiry(reason: string): void {
    log.info("Continuing game in solo mode after multiplayer expiry", { reason });
    this.multiplayerNetwork?.dispose();
    this.multiplayerNetwork = undefined;
    this.multiplayerSessionService.dispose();
    particleService.enableNetworkSync(false);
    this.awaitingMultiplayerRoll = false;
    this.pendingTurnEndSync = false;
    this.activeTurnPlayerId = this.localPlayerId;
    this.activeRollServerId = null;
    this.applyTurnTiming(null);
    this.diceRenderer.cancelAllSpectatorPreviews();
    this.lastTurnPlanPreview = "";
    this.lastSessionComplete = false;
    playerDataSyncService.setSessionId(undefined);
    this.clearSessionQueryParam();
    this.applySoloSeatState();
    this.updateUI();
    notificationService.show("Continuing in solo mode.", "info", 2200);
  }

  private async returnToLobby(): Promise<void> {
    if (this.lobbyRedirectInProgress) {
      return;
    }
    this.lobbyRedirectInProgress = true;
    this.sessionExpiryPromptActive = false;
    try {
      await this.multiplayerSessionService.leaveSession();
    } catch (error) {
      log.warn("Failed to leave multiplayer session during lobby return", error);
    }

    this.multiplayerNetwork?.dispose();
    this.multiplayerNetwork = undefined;
    if (this.hudClockHandle) {
      clearInterval(this.hudClockHandle);
      this.hudClockHandle = null;
    }
    this.awaitingMultiplayerRoll = false;
    this.pendingTurnEndSync = false;
    this.applyTurnTiming(null);
    this.diceRenderer.cancelAllSpectatorPreviews();
    this.lastTurnPlanPreview = "";
    this.lastSessionComplete = false;
    this.hud.setMultiplayerStandings([], null);
    playerDataSyncService.setSessionId(undefined);
    this.clearSessionQueryParam();

    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.delete("session");
    redirectUrl.searchParams.delete("seed");
    redirectUrl.searchParams.delete("log");
    try {
      window.location.assign(redirectUrl.toString());
    } catch (error) {
      this.lobbyRedirectInProgress = false;
      log.error("Failed to redirect to lobby after session exit", error);
      notificationService.show("Unable to return to main menu. Please refresh.", "error", 2800);
    }
  }

  private async copySessionInviteLink(sessionId: string): Promise<void> {
    if (typeof window === "undefined" || !window.navigator?.clipboard?.writeText) {
      return;
    }

    try {
      const inviteUrl = new URL(window.location.href);
      inviteUrl.searchParams.set("session", sessionId);
      await window.navigator.clipboard.writeText(inviteUrl.toString());
      notificationService.show("Invite link copied to clipboard.", "info", 1600);
    } catch {
      // Clipboard APIs may be unavailable in some environments.
    }
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

  private openTutorialAudioSettings(): void {
    this.openTutorialSettingsTab("audio");
  }

  private openTutorialGraphicsSettings(): void {
    this.openTutorialSettingsTab("graphics");
  }

  private openTutorialSettingsTab(tab: "audio" | "graphics"): void {
    if (!this.paused) {
      this.paused = true;
    }
    this.settingsModal.show();
    this.settingsModal.showTab(tab);
    this.updateUI();
  }

  togglePause(): void {
    this.paused = !this.paused;

    if (this.paused) {
      notificationService.show("Paused", "info");
      this.settingsModal.show();
      if (tutorialModal.isActive()) {
        tutorialModal.onPlayerAction("openSettings");
        const preferredSettingsTab = tutorialModal.getPreferredSettingsTab();
        if (preferredSettingsTab) {
          this.settingsModal.showTab(preferredSettingsTab);
        }
      }
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

  private async handleModeChange(difficulty: GameDifficulty): Promise<void> {
    const isInProgress = GameFlowController.isGameInProgress(this.state);
    let allowGameReset = true;
    if (isInProgress) {
      const modeLabel = `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)}`;
      allowGameReset = await confirmAction({
        title: `Switch To ${modeLabel} Mode?`,
        message: "This will start a new game and your current progress will be lost.",
        confirmLabel: "Switch Mode",
        cancelLabel: "Keep Current Game",
        tone: "danger",
      });
    }

    const result = GameFlowController.handleModeChange(
      this.state,
      difficulty,
      isInProgress,
      allowGameReset
    );

    if (result.newState) {
      // Game was in progress, starting new game
      this.state = result.newState;
      GameFlowController.updateHintMode(this.state, this.diceRow);
      GameFlowController.resetForNewGame(this.diceRenderer);
      this.animating = false;
      this.gameStartTime = Date.now();
      this.hud.setGameClockStart(this.gameStartTime);
      this.applyTurnTiming(null);
      this.updateUI();
      notificationService.show("New Game Started!", "success");
    } else if (result.modeUpdated) {
      // Game not in progress, mode was updated in place
      GameFlowController.updateHintMode(this.state, this.diceRow);
      this.updateUI();
      notificationService.show(`Mode changed to ${difficulty}`, "info");
    } else {
      // User cancelled mode change - restore HUD mode label.
      this.updateUI();
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

  private queueTutorialCompletionUndo(): void {
    if (this.playMode !== "solo" || !canUndo(this.state)) {
      return;
    }

    const tryUndo = () => {
      if (this.animating) {
        window.setTimeout(tryUndo, 75);
        return;
      }
      this.handleUndo(true, "Tutorial score reset - choose your best dice.", true);
    };

    tryUndo();
  }

  private replayTutorialFromRules(): void {
    if (this.playMode !== "solo") {
      notificationService.show("Replay tutorial is currently available in solo games.", "info", 2600);
      return;
    }

    if (this.settingsModal.isVisible()) {
      this.settingsModal.hide();
    }
    this.startNewGame();
    this.diceRow.setHintMode(true);
    tutorialModal.show();
    notificationService.show("Tutorial restarted.", "info", 1800);
  }

  handleUndo(
    force: boolean = false,
    successMessage: string = "Score undone - reselect dice",
    highlightRestoredDice: boolean = false
  ): void {
    if (this.paused || this.animating) return;
    if ((!force && !isUndoAllowed(this.state.mode)) || !canUndo(this.state)) return;

    // Get config for replay
    const settings = settingsService.getSettings();
    const config = {
      addD20: settings.game.addD20,
      addD4: settings.game.addD4,
      add2ndD10: settings.game.add2ndD10,
      d100Mode: settings.game.d100Mode,
    };

    // Undo last scoring action
    const previousState = this.state;
    const newState = undo(this.state, config);
    if (newState !== this.state) {
      const restoredDieIds: string[] = [];
      if (highlightRestoredDice) {
        const nextDieById = new Map(newState.dice.map((die) => [die.id, die]));
        previousState.dice.forEach((priorDie) => {
          if (!priorDie.scored) {
            return;
          }
          const nextDie = nextDieById.get(priorDie.id);
          if (nextDie && nextDie.inPlay && !nextDie.scored && nextDie.value > 0) {
            restoredDieIds.push(priorDie.id);
          }
        });
      }

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
      if (highlightRestoredDice && restoredDieIds.length > 0) {
        this.diceRow.highlightDice(restoredDieIds);
      }
      notificationService.show(successMessage, "info");
    }
  }

  private handleRoll(): void {
    if (this.paused) return;
    if (!this.canLocalPlayerTakeTurnAction()) return;
    if (this.awaitingMultiplayerRoll) {
      notificationService.show("Waiting for roll sync...", "info", 1400);
      return;
    }

    // Invalid action reminder
    if (this.state.status === "ROLLED") {
      notificationService.show("Score Dice First!", "warning");
      hapticsService.invalid();
      return;
    }

    if (this.animating || this.state.status !== "READY") return;
    this.activeRollServerId = null;
    const rollPayload = this.buildRollTurnPayload();
    if (!this.emitTurnAction("roll", { roll: rollPayload })) {
      return;
    }

    if (this.isMultiplayerTurnEnforced()) {
      this.awaitingMultiplayerRoll = true;
      notificationService.show("Rolling...", "info", 900);
      return;
    }

    this.dispatch({ t: "ROLL" });
    this.animating = true;

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
    if (!this.canLocalPlayerTakeTurnAction()) return;

    if (this.animating || this.state.status !== "ROLLED" || this.state.selected.size === 0) {
      return;
    }
    const selected = new Set(this.state.selected);

    // Calculate points for notification
    const scoredDice = this.state.dice.filter((d) => selected.has(d.id));
    const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
    if (this.isMultiplayerTurnEnforced()) {
      if (!this.activeRollServerId) {
        notificationService.show("Waiting for roll sync before scoring.", "warning", 1800);
        return;
      }

      const scorePayload = this.buildScoreTurnPayload(selected, points, this.activeRollServerId);
      if (!this.emitTurnAction("score", { score: scorePayload })) {
        return;
      }
    }

    this.animating = true;

    // Play score sound and haptic feedback
    audioService.playSfx("score");
    hapticsService.score();

    const localSeatScoreZone = this.getSeatScoreZonePosition(this.localPlayerId);
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
    }, localSeatScoreZone
      ? new Vector3(localSeatScoreZone.x, localSeatScoreZone.y, localSeatScoreZone.z)
      : undefined);

    this.dispatch({ t: "SCORE_SELECTED" });
    this.emitTurnEnd();

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
    this.hud.setGameClockStart(this.gameStartTime);
    this.applyTurnTiming(null);
    this.updateUI();
    notificationService.show("New Game!", "success");
  }

  handleReturnToMainMenu(): void {
    void this.returnToLobby();
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
    this.hud.setGameClockStart(this.gameStartTime);
    this.applyTurnTiming(null);
    this.updateUI();
    notificationService.show("New Game Started!", "success");
  }

  private updateUI(): void {
    this.hud.update(this.state);
    this.scene.playerSeatRenderer.updateSeat(this.scene.currentPlayerSeat, {
      score: this.state.score,
    });
    this.diceRow.update(this.state);
    const isTurnLocked =
      this.isMultiplayerTurnEnforced() &&
      (!this.activeTurnPlayerId || !this.isLocalPlayersTurn());

    // Update multipurpose action button
    if (this.state.status === "READY") {
      this.actionBtn.textContent = isTurnLocked
        ? `Waiting: ${this.activeTurnPlayerId ? this.getParticipantLabel(this.activeTurnPlayerId) : "Sync"}`
        : "Roll";
      this.actionBtn.disabled = this.animating || this.paused || isTurnLocked;
      this.actionBtn.className = "btn btn-primary primary";
      this.deselectBtn.style.display = "none";
    } else if (this.state.status === "ROLLED") {
      const hasSelection = this.state.selected.size > 0;
      if (hasSelection) {
        // Calculate points for button text
        const scoredDice = this.state.dice.filter((d) => this.state.selected.has(d.id));
        const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
        this.actionBtn.textContent = isTurnLocked
          ? `Waiting: ${this.activeTurnPlayerId ? this.getParticipantLabel(this.activeTurnPlayerId) : "Sync"}`
          : `Score +${points} (Space)`;
        this.actionBtn.disabled = this.animating || this.paused || isTurnLocked;
        this.actionBtn.className = "btn btn-primary primary";
        this.deselectBtn.style.display = isTurnLocked ? "none" : "inline-block";
      } else {
        this.actionBtn.textContent = isTurnLocked
          ? `Waiting: ${this.activeTurnPlayerId ? this.getParticipantLabel(this.activeTurnPlayerId) : "Sync"}`
          : "Select Dice to Score";
        this.actionBtn.disabled = true;
        this.actionBtn.className = "btn btn-secondary secondary";
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

let settingsModal: SettingsModal;
let leaderboardModal: LeaderboardModal;
let rulesModal: RulesModal;
let tutorialModal: TutorialModal;
let profileModal: ProfileModal;
let gameInstance: Game | null = null;

export interface GameRuntimeBootstrapOptions {
  settingsModal: SettingsModal;
  leaderboardModal: LeaderboardModal;
  rulesModal: RulesModal;
  tutorialModal: TutorialModal;
  profileModal: ProfileModal;
  playMode: GamePlayMode;
  multiplayer?: MultiplayerBootstrapOptions;
}

export function startGameRuntime(options: GameRuntimeBootstrapOptions): void {
  settingsModal = options.settingsModal;
  leaderboardModal = options.leaderboardModal;
  rulesModal = options.rulesModal;
  tutorialModal = options.tutorialModal;
  profileModal = options.profileModal;

  if (gameInstance) {
    return;
  }

  gameInstance = new Game({
    playMode: options.playMode,
    multiplayer: options.multiplayer,
  });
}
