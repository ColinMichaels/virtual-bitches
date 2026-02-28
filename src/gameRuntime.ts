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
import { firebaseAuthService } from "./services/firebaseAuth.js";
import {
  MultiplayerNetworkService,
  type MultiplayerGameUpdateMessage,
  type MultiplayerPlayerNotificationMessage,
  type MultiplayerRoomChannelMessage,
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
import {
  backendApiService,
  type MultiplayerGameDifficulty,
  type MultiplayerJoinFailureReason,
  type MultiplayerRoomListing,
  type MultiplayerSessionParticipant,
  type MultiplayerSessionRecord,
} from "./services/backendApi.js";
import { leaderboardService } from "./services/leaderboard.js";
import {
  buildClockwiseTurnPlan,
  type MultiplayerTurnPlan,
} from "./multiplayer/turnPlanner.js";
import { resolveSessionExpiryOutcome } from "./multiplayer/sessionExpiryFlow.js";
import { botMemeAvatarService } from "./services/botMemeAvatarService.js";
import { t } from "./i18n/index.js";

const log = logger.create('Game');
const BOT_MEME_UNIQUE_ATTEMPTS = 4;

export type GamePlayMode = "solo" | "multiplayer";

export interface MultiplayerBootstrapOptions {
  roomCode?: string;
  botCount?: number;
  joinBotCount?: number;
  gameDifficulty?: MultiplayerGameDifficulty;
  sessionId?: string;
}

interface GameSessionBootstrapOptions {
  playMode: GamePlayMode;
  multiplayer?: MultiplayerBootstrapOptions;
}

interface SeatedMultiplayerParticipant {
  playerId: string;
  displayName: string;
  avatarUrl?: string;
  providerId?: string;
  seatIndex: number;
  isBot: boolean;
  isSeated: boolean;
  isReady: boolean;
  score: number;
  remainingDice: number;
  queuedForNextGame: boolean;
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

function resolveCameraAttackLightingColor(effectType: string): Color3 {
  switch (effectType) {
    case "shake":
      return new Color3(1.0, 0.55, 0.38);
    case "spin":
      return new Color3(0.62, 0.78, 1.0);
    case "zoom":
      return new Color3(0.5, 0.98, 0.9);
    case "drunk":
      return new Color3(0.82, 0.58, 1.0);
    case "tilt":
      return new Color3(0.95, 0.8, 0.46);
    default:
      return new Color3(0.7, 0.52, 1.0);
  }
}

function shuffleInPlace<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function resolveCameraAttackLightingDuration(message: CameraAttackMessage, minimumMs: number): number {
  const attackDurationMs =
    typeof message.duration === "number" && Number.isFinite(message.duration)
      ? Math.floor(message.duration)
      : minimumMs;
  return Math.max(minimumMs, Math.min(attackDurationMs, 2600));
}

function normalizeParticipantScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function resolveScoreFeedbackTone(points: number): "success" | "warning" | "error" {
  const normalizedPoints = Number.isFinite(points) ? Math.max(0, Math.floor(points)) : 0;
  if (normalizedPoints === 0) {
    return "success";
  }
  if (normalizedPoints <= 4) {
    return "warning";
  }
  return "error";
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

function normalizeQueuedForNextGame(value: unknown): boolean {
  return value === true;
}

const TURN_NUDGE_COOLDOWN_MS = 7000;
const TURN_SYNC_WATCHDOG_INTERVAL_MS = 2500;
const TURN_SYNC_STALE_MS = 12000;
const TURN_SYNC_REQUEST_COOLDOWN_MS = 7000;
const TURN_SYNC_STALE_RECOVERY_MS = 4500;
const MULTIPLAYER_IDENTITY_CACHE_MS = 30000;
const TURN_SELECTION_SYNC_DEBOUNCE_MS = 80;
const DEFAULT_MULTIPLAYER_ROUND_CYCLE_MS = 60 * 1000;

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
  private gameStartTime = Date.now();
  private gameStartServerAt: number | null = null;
  private multiplayerRoundCycleMs = DEFAULT_MULTIPLAYER_ROUND_CYCLE_MS;
  private serverClockOffsetMs = 0;
  private serverClockSampleCount = 0;
  private selectedDieIndex = 0; // For keyboard navigation
  private selectedSeatFocusIndex = -1; // For waiting/spectator keyboard camera cycling
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
  private turnSyncWatchdogHandle: ReturnType<typeof setInterval> | null = null;
  private turnSyncWatchdogInFlight = false;
  private lastTurnSyncActivityAt = 0;
  private lastTurnSyncRequestAt = 0;
  private pendingTurnTransitionSyncHandle: ReturnType<typeof setTimeout> | null = null;
  private selectionSyncDebounceHandle: ReturnType<typeof setTimeout> | null = null;
  private selectionSyncRollServerId: string | null = null;
  private participantSeatById = new Map<string, number>();
  private participantIdBySeat = new Map<number, string>();
  private participantLabelById = new Map<string, string>();
  private nudgeCooldownByPlayerId = new Map<string, number>();
  private lastTurnPlanPreview = "";
  private lastSessionComplete = false;
  private localAvatarUrl: string | undefined;
  private botMemeAvatarByPlayerId = new Map<string, string>();
  private botMemeAvatarRotationHandle: ReturnType<typeof setInterval> | null = null;
  private botMemeAvatarRefreshInFlight = false;
  private waitForNextGameRequestInFlight = false;
  private participantStateUpdateInFlight = false;
  private cachedMultiplayerIdentity:
    | {
        value: {
          displayName?: string;
          avatarUrl?: string;
          providerId?: string;
        };
        fetchedAt: number;
      }
    | null = null;

  private actionBtn: HTMLButtonElement;
  private deselectBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private newGameBtn: HTMLButtonElement | null = null;
  private waitNextGameBtn: HTMLButtonElement | null = null;
  private inviteLinkBtn: HTMLButtonElement | null = null;
  private mobileInviteLinkBtn: HTMLButtonElement | null = null;
  private turnActionBannerEl: HTMLElement | null = null;

  private normalizeMultiplayerDifficulty(
    value: unknown
  ): MultiplayerGameDifficulty | undefined {
    if (value === "easy" || value === "normal" || value === "hard") {
      return value;
    }
    return undefined;
  }

  private resolveRequestedMultiplayerDifficulty(): MultiplayerGameDifficulty {
    return (
      this.normalizeMultiplayerDifficulty(this.multiplayerOptions.gameDifficulty) ??
      this.normalizeMultiplayerDifficulty(this.state.mode.difficulty) ??
      "normal"
    );
  }

  private applyMultiplayerDifficultyIfPresent(value: unknown): void {
    const difficulty = this.normalizeMultiplayerDifficulty(value);
    if (!difficulty) {
      return;
    }
    this.multiplayerOptions.gameDifficulty = difficulty;
    this.state.mode.difficulty = difficulty;
    GameFlowController.updateHintMode(this.state, this.diceRow);
  }

  private normalizeMultiplayerRoundCycleMs(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    const normalized = Math.floor(value);
    if (normalized < 5000) {
      return null;
    }
    return Math.min(10 * 60 * 1000, normalized);
  }

  constructor(sessionBootstrap: GameSessionBootstrapOptions) {
    this.playMode = sessionBootstrap.playMode;
    this.multiplayerOptions = sessionBootstrap.multiplayer ?? {};

    // Initialize game state from URL or create new game
    this.state = GameFlowController.initializeGameState();
    if (this.playMode === "multiplayer") {
      this.state.mode.difficulty = this.resolveRequestedMultiplayerDifficulty();
    }

    // Initialize rendering
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    this.scene = new GameScene(canvas);
    this.diceRenderer = new DiceRenderer(this.scene.scene);

    // Initialize particle system
    initParticleService(this.scene.scene);
    particleService.setPlayerPositionResolver((playerId) =>
      this.resolveParticleAnchorPosition(playerId)
    );
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
      this.touchMultiplayerTurnSyncActivity();
      this.hud.setTurnSyncStatus("ok", "Sync Live");
      this.flushPendingTurnEndSync();
    });
    document.addEventListener("multiplayer:disconnected", () => {
      particleService.enableNetworkSync(false);
      this.touchMultiplayerTurnSyncActivity();
      if (this.playMode === "multiplayer") {
        this.hud.setTurnSyncStatus("stale", "Disconnected");
      }
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
    document.addEventListener("multiplayer:channel:received", ((event: Event) => {
      const detail = (event as CustomEvent<MultiplayerRoomChannelMessage>).detail;
      if (!detail) return;
      this.handleMultiplayerRoomChannelMessage(detail);
    }) as EventListener);

    document.addEventListener("chaos:cameraAttack:sent", ((event: Event) => {
      const detail = (event as CustomEvent<{ message?: CameraAttackMessage }>).detail;
      const message = detail?.message;
      if (!message) return;
      this.scene.triggerSpecialMoveLighting(
        resolveCameraAttackLightingColor(message.effectType),
        900
      );
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
      this.scene.triggerSpecialMoveLighting(
        resolveCameraAttackLightingColor(message.effectType),
        resolveCameraAttackLightingDuration(message, 1200)
      );

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
    this.hud.setTurnSyncStatus(null);
    this.resetLocalGameClockStart();
    this.startHudClockTicker();
    this.startTurnSyncWatchdog();
    this.diceRow = new DiceRow((dieId) => this.handleDieClick(dieId), this.diceRenderer as any);

    // Set initial hint mode based on game mode
    GameFlowController.updateHintMode(this.state, this.diceRow);

    // UI elements
    this.actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
    this.deselectBtn = document.getElementById("deselect-btn") as HTMLButtonElement;
    this.undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement | null;
    this.waitNextGameBtn = document.getElementById("wait-next-game-btn") as HTMLButtonElement | null;
    this.inviteLinkBtn = document.getElementById("invite-link-btn") as HTMLButtonElement | null;
    this.mobileInviteLinkBtn = document.getElementById("mobile-invite-link-btn") as HTMLButtonElement | null;
    this.turnActionBannerEl = this.ensureTurnActionBanner();

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

    // Handle player seat clicks for multiplayer invites and nudges
    this.scene.setPlayerSeatClickHandler((seatIndex: number) => {
      const activeSession = this.multiplayerSessionService.getActiveSession();
      audioService.playSfx("click");
      if (activeSession) {
        const targetPlayerId = this.participantIdBySeat.get(seatIndex);
        if (
          this.playMode === "multiplayer" &&
          targetPlayerId === this.localPlayerId
        ) {
          const localSeatState = this.getLocalMultiplayerSeatState();
          if (!localSeatState || !localSeatState.isSeated) {
            void this.updateLocalParticipantState("sit");
            return;
          }
          if (!localSeatState.isReady) {
            void this.updateLocalParticipantState("ready");
            return;
          }
          void this.updateLocalParticipantState("stand");
          return;
        }

        if (
          this.playMode === "multiplayer" &&
          targetPlayerId &&
          targetPlayerId !== this.localPlayerId &&
          this.activeTurnPlayerId === targetPlayerId
        ) {
          this.triggerTurnNudge(targetPlayerId);
          return;
        }

        if (targetPlayerId && targetPlayerId !== this.localPlayerId) {
          const targetLabel = this.getParticipantLabel(targetPlayerId);
          notificationService.show(
            `${targetLabel} is waiting for their turn.`,
            "info",
            2000
          );
          return;
        }

        notificationService.show(
          `Seat ${seatIndex + 1} is open. Invite others with room ${activeSession.roomCode}.`,
          "info",
          2600
        );
        void this.copySessionInviteLink(activeSession.sessionId, activeSession.roomCode);
        return;
      }

      if (this.playMode === "multiplayer") {
        notificationService.show("Starting multiplayer session...", "info", 2200);
      } else {
        notificationService.show("Start a Multiplayer game from the splash screen to fill seats.", "info", 3000);
      }
    });

    // Provide callback to check if game is in progress
    this.settingsModal.setCheckGameInProgress(() => {
      return GameFlowController.isGameInProgress(this.state);
    });

    // Listen to settings changes to sync mode and update hint mode
    settingsService.onChange((settings) => {
      if (this.playMode === "multiplayer") {
        const sessionDifficulty = this.multiplayerSessionService.getActiveSession()?.gameDifficulty;
        this.applyMultiplayerDifficultyIfPresent(
          sessionDifficulty ?? this.multiplayerOptions.gameDifficulty
        );
      } else {
        GameFlowController.syncModeWithSettings(this.state);
      }
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
      if (this.playMode === "multiplayer") {
        const sessionDifficulty = this.multiplayerSessionService.getActiveSession()?.gameDifficulty;
        this.applyMultiplayerDifficultyIfPresent(
          sessionDifficulty ?? this.multiplayerOptions.gameDifficulty
        );
      } else {
        GameFlowController.syncModeWithSettings(this.state);
      }
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
    this.updateInviteLinkControlVisibility();
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
  }

  private startHudClockTicker(): void {
    if (this.hudClockHandle) {
      clearInterval(this.hudClockHandle);
    }
    this.hudClockHandle = setInterval(() => {
      this.hud.tick();
    }, 250);
  }

  private resetLocalGameClockStart(): void {
    this.gameStartServerAt = null;
    this.gameStartTime = Date.now();
    this.hud.setGameClockStart(this.gameStartTime);
    this.hud.setRoundCountdownDeadline(null);
  }

  private syncServerClockOffset(serverNowMs: number | null | undefined): void {
    if (typeof serverNowMs !== "number" || !Number.isFinite(serverNowMs) || serverNowMs <= 0) {
      return;
    }

    const measuredOffset = Date.now() - Math.floor(serverNowMs);
    if (!Number.isFinite(measuredOffset)) {
      return;
    }

    if (this.serverClockSampleCount <= 0) {
      this.serverClockOffsetMs = measuredOffset;
      this.serverClockSampleCount = 1;
      return;
    }

    // Keep jitter low while still adapting to drift.
    this.serverClockOffsetMs = Math.round(this.serverClockOffsetMs * 0.75 + measuredOffset * 0.25);
    this.serverClockSampleCount = Math.min(64, this.serverClockSampleCount + 1);
  }

  private mapServerTimestampToLocalClock(serverTimestampMs: number | null | undefined): number | null {
    if (
      typeof serverTimestampMs !== "number" ||
      !Number.isFinite(serverTimestampMs) ||
      serverTimestampMs <= 0
    ) {
      return null;
    }
    return Math.floor(serverTimestampMs + this.serverClockOffsetMs);
  }

  private resolveServerNowTimestamp(source: {
    serverNow?: number;
    timestamp?: number;
  }): number | null {
    if (typeof source.serverNow === "number" && Number.isFinite(source.serverNow) && source.serverNow > 0) {
      return Math.floor(source.serverNow);
    }
    if (typeof source.timestamp === "number" && Number.isFinite(source.timestamp) && source.timestamp > 0) {
      return Math.floor(source.timestamp);
    }
    return null;
  }

  private applyMultiplayerClockFromServer(
    source: {
      gameStartedAt?: number;
      nextGameStartsAt?: number;
      nextGameAutoStartDelayMs?: number;
      createdAt?: number;
      serverNow?: number;
      timestamp?: number;
    },
    options?: { force?: boolean }
  ): void {
    const serverNowMs = this.resolveServerNowTimestamp(source);
    this.syncServerClockOffset(serverNowMs);
    const normalizedRoundCycleMs = this.normalizeMultiplayerRoundCycleMs(
      source.nextGameAutoStartDelayMs
    );
    if (normalizedRoundCycleMs) {
      this.multiplayerRoundCycleMs = normalizedRoundCycleMs;
    }

    const explicitGameStartedAt =
      typeof source.gameStartedAt === "number" &&
      Number.isFinite(source.gameStartedAt) &&
      source.gameStartedAt > 0
        ? Math.floor(source.gameStartedAt)
        : null;
    const fallbackCreatedAt =
      typeof source.createdAt === "number" &&
      Number.isFinite(source.createdAt) &&
      source.createdAt > 0
        ? Math.floor(source.createdAt)
        : null;
    const serverGameStartAt =
      explicitGameStartedAt ?? (this.gameStartServerAt === null ? fallbackCreatedAt : null);
    const knownServerGameStartAt = serverGameStartAt ?? this.gameStartServerAt;
    if (!serverGameStartAt) {
      if (this.playMode === "multiplayer" && knownServerGameStartAt) {
        const explicitNextGameStartsAt =
          typeof source.nextGameStartsAt === "number" &&
          Number.isFinite(source.nextGameStartsAt) &&
          source.nextGameStartsAt > 0
            ? Math.floor(source.nextGameStartsAt)
            : null;
        const serverCountdownDeadlineAt =
          explicitNextGameStartsAt ?? (knownServerGameStartAt + this.multiplayerRoundCycleMs);
        const localCountdownDeadlineAt =
          this.mapServerTimestampToLocalClock(serverCountdownDeadlineAt) ?? serverCountdownDeadlineAt;
        this.hud.setRoundCountdownDeadline(localCountdownDeadlineAt);
      }
      return;
    }

    const localGameStartAt = this.mapServerTimestampToLocalClock(serverGameStartAt) ?? serverGameStartAt;
    const shouldApply =
      options?.force === true ||
      this.gameStartServerAt === null ||
      this.gameStartServerAt !== serverGameStartAt ||
      Math.abs(localGameStartAt - this.gameStartTime) > 600;
    if (!shouldApply) {
      const fallbackServerGameStartAt = this.gameStartServerAt;
      if (!fallbackServerGameStartAt || this.playMode !== "multiplayer") {
        return;
      }
      const explicitNextGameStartsAt =
        typeof source.nextGameStartsAt === "number" &&
        Number.isFinite(source.nextGameStartsAt) &&
        source.nextGameStartsAt > 0
          ? Math.floor(source.nextGameStartsAt)
          : null;
      const serverCountdownDeadlineAt =
        explicitNextGameStartsAt ?? (fallbackServerGameStartAt + this.multiplayerRoundCycleMs);
      const localCountdownDeadlineAt =
        this.mapServerTimestampToLocalClock(serverCountdownDeadlineAt) ?? serverCountdownDeadlineAt;
      this.hud.setRoundCountdownDeadline(localCountdownDeadlineAt);
      return;
    }

    this.gameStartServerAt = serverGameStartAt;
    this.gameStartTime = localGameStartAt;
    this.hud.setGameClockStart(this.gameStartTime);
    if (this.playMode === "multiplayer") {
      const explicitNextGameStartsAt =
        typeof source.nextGameStartsAt === "number" &&
        Number.isFinite(source.nextGameStartsAt) &&
        source.nextGameStartsAt > 0
          ? Math.floor(source.nextGameStartsAt)
          : null;
      const serverCountdownDeadlineAt =
        explicitNextGameStartsAt ?? (serverGameStartAt + this.multiplayerRoundCycleMs);
      const localCountdownDeadlineAt =
        this.mapServerTimestampToLocalClock(serverCountdownDeadlineAt) ?? serverCountdownDeadlineAt;
      this.hud.setRoundCountdownDeadline(localCountdownDeadlineAt);
    }
  }

  private touchMultiplayerTurnSyncActivity(): void {
    this.lastTurnSyncActivityAt = Date.now();
  }

  private startTurnSyncWatchdog(): void {
    if (this.turnSyncWatchdogHandle) {
      clearInterval(this.turnSyncWatchdogHandle);
    }
    this.touchMultiplayerTurnSyncActivity();
    this.turnSyncWatchdogHandle = setInterval(() => {
      void this.runTurnSyncWatchdogTick();
    }, TURN_SYNC_WATCHDOG_INTERVAL_MS);
  }

  private stopTurnSyncWatchdog(): void {
    if (this.turnSyncWatchdogHandle) {
      clearInterval(this.turnSyncWatchdogHandle);
      this.turnSyncWatchdogHandle = null;
    }
    this.clearPendingTurnTransitionSyncRecovery();
    this.turnSyncWatchdogInFlight = false;
  }

  private clearPendingTurnTransitionSyncRecovery(): void {
    if (!this.pendingTurnTransitionSyncHandle) {
      return;
    }
    clearTimeout(this.pendingTurnTransitionSyncHandle);
    this.pendingTurnTransitionSyncHandle = null;
  }

  private scheduleTurnTransitionSyncRecovery(
    reason: string,
    expectedStalePlayerId?: string
  ): void {
    this.clearPendingTurnTransitionSyncRecovery();
    this.pendingTurnTransitionSyncHandle = window.setTimeout(() => {
      this.pendingTurnTransitionSyncHandle = null;
      if (!this.isMultiplayerTurnEnforced()) {
        return;
      }
      if (!this.multiplayerNetwork?.isConnected()) {
        return;
      }
      const currentActivePlayerId = this.activeTurnPlayerId;
      const shouldRefresh =
        !currentActivePlayerId ||
        (expectedStalePlayerId
          ? currentActivePlayerId === expectedStalePlayerId
          : !this.isLocalPlayersTurn());
      if (!shouldRefresh) {
        return;
      }
      void this.requestTurnSyncRefresh(reason);
    }, 950);
  }

  private async runTurnSyncWatchdogTick(): Promise<void> {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }
    if (!this.multiplayerNetwork?.isConnected()) {
      return;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId) {
      return;
    }
    if (!this.activeTurnPlayerId && this.getUnreadySeatedHumanParticipants().length > 0) {
      this.hud.setTurnSyncStatus("ok", "Waiting For Ready");
      return;
    }

    const now = Date.now();
    const staleMs = now - this.lastTurnSyncActivityAt;
    const deadlineTimedOut =
      typeof this.activeTurnDeadlineAt === "number" &&
      Number.isFinite(this.activeTurnDeadlineAt) &&
      this.activeTurnDeadlineAt > 0 &&
      now > this.activeTurnDeadlineAt + 1500;
    const awaitingActionSync = this.awaitingMultiplayerRoll || this.pendingTurnEndSync;
    const staleThreshold =
      deadlineTimedOut || awaitingActionSync
        ? TURN_SYNC_STALE_RECOVERY_MS
        : TURN_SYNC_STALE_MS;
    if (staleMs < staleThreshold) {
      return;
    }

    this.hud.setTurnSyncStatus("stale", "Sync Stale");
    await this.requestTurnSyncRefresh("watchdog_stale_turn");
  }

  private async requestTurnSyncRefresh(reason: string): Promise<boolean> {
    if (this.turnSyncWatchdogInFlight) {
      return false;
    }
    const now = Date.now();
    if (now - this.lastTurnSyncRequestAt < TURN_SYNC_REQUEST_COOLDOWN_MS) {
      return false;
    }

    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId) {
      return false;
    }

    this.hud.setTurnSyncStatus("syncing", "Resyncing...");
    this.turnSyncWatchdogInFlight = true;
    this.lastTurnSyncRequestAt = now;
    try {
      const refreshedSession = await this.multiplayerSessionService.refreshSessionAuth();
      if (!refreshedSession) {
        this.hud.setTurnSyncStatus("error", "Resync Failed");
        log.warn(`Turn sync refresh failed (${reason})`, {
          sessionId: activeSession.sessionId,
        });
        return false;
      }
      this.touchMultiplayerTurnSyncActivity();
      this.applyMultiplayerSeatState(refreshedSession);
      this.flushPendingTurnEndSync();
      this.hud.setTurnSyncStatus("ok", "Resynced");
      log.info(`Turn sync refreshed (${reason})`, {
        sessionId: refreshedSession.sessionId,
      });
      return true;
    } finally {
      this.turnSyncWatchdogInFlight = false;
    }
  }

  private syncHudTurnTimer(): void {
    this.hud.setTurnDeadline(this.activeTurnDeadlineAt);
  }

  private applyTurnTiming(deadlineAt?: number | null): void {
    const normalizedDeadline =
      typeof deadlineAt === "number" && Number.isFinite(deadlineAt) && deadlineAt > 0
        ? Math.floor(deadlineAt)
        : null;
    this.activeTurnDeadlineAt =
      normalizedDeadline === null
        ? null
        : this.mapServerTimestampToLocalClock(normalizedDeadline) ?? normalizedDeadline;
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
    void this.resolveMultiplayerIdentityPayload()
      .then(() => {
        if (this.playMode !== "multiplayer") {
          this.applySoloSeatState();
        }
      })
      .catch((error) => {
        log.debug("Unable to resolve multiplayer identity payload", error);
      });

    void this.bootstrapMultiplayerSession();
  }

  private async bootstrapMultiplayerSession(): Promise<void> {
    const query = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = query.get("session")?.trim() ?? "";
    const roomCodeFromUrl = this.normalizeInviteRoomCode(query.get("room"));
    const sessionIdFromOption =
      typeof this.multiplayerOptions.sessionId === "string"
        ? this.multiplayerOptions.sessionId.trim()
        : "";
    const roomCodeFromOption = this.normalizeInviteRoomCode(this.multiplayerOptions.roomCode);
    const shouldIgnoreSessionIdFromUrl =
      !sessionIdFromOption && roomCodeFromOption.length > 0;
    const targetSessionId = sessionIdFromOption || (shouldIgnoreSessionIdFromUrl ? "" : sessionIdFromUrl);
    const targetRoomCode = roomCodeFromOption || roomCodeFromUrl;
    const fromInviteLink = targetSessionId.length > 0 && targetSessionId === sessionIdFromUrl;
    const fromRoomCodeInviteLink =
      targetRoomCode.length > 0 &&
      targetRoomCode === roomCodeFromUrl &&
      !sessionIdFromOption;
    if (targetSessionId) {
      const joined = await this.joinMultiplayerSession(targetSessionId, fromInviteLink);
      if (joined) {
        return;
      }

      const initialJoinFailureReason = this.multiplayerSessionService.getLastJoinFailureReason();
      const roomCodeRetryTarget = fromInviteLink ? roomCodeFromUrl : targetRoomCode;
      const shouldRetryByRoomCode =
        roomCodeRetryTarget.length > 0 &&
        (fromInviteLink ||
          initialJoinFailureReason === "session_expired" ||
          initialJoinFailureReason === "room_not_found");
      if (shouldRetryByRoomCode) {
        const joinedByRoomCode = await this.joinMultiplayerRoomByCode(
          roomCodeRetryTarget,
          fromInviteLink || fromRoomCodeInviteLink,
          {
            suppressFailureNotification: true,
          }
        );
        if (joinedByRoomCode) {
          return;
        }
      }

      if (fromInviteLink) {
        return;
      }

      const joinFailureReason =
        this.multiplayerSessionService.getLastJoinFailureReason() ?? initialJoinFailureReason;
      const fallbackJoined = await this.tryJoinAlternativeRoom(targetSessionId, joinFailureReason);
      if (fallbackJoined) {
        return;
      }

      if (joinFailureReason === "room_full") {
        notificationService.show("Selected room is full. Creating a new room instead.", "warning", 2800);
      } else if (joinFailureReason === "session_expired") {
        notificationService.show("Selected room expired. Creating a new room instead.", "warning", 2800);
      } else {
        notificationService.show("Selected room unavailable. Creating a new room instead.", "warning", 2800);
      }
    }

    if (targetRoomCode) {
      const joinedByRoomCode = await this.joinMultiplayerRoomByCode(
        targetRoomCode,
        fromRoomCodeInviteLink
      );
      if (joinedByRoomCode) {
        return;
      }
      if (fromRoomCodeInviteLink) {
        return;
      }

      const joinFailureReason = this.multiplayerSessionService.getLastJoinFailureReason();
      const fallbackJoined = await this.tryJoinAlternativeRoom("", joinFailureReason);
      if (fallbackJoined) {
        return;
      }

      if (joinFailureReason === "room_not_found") {
        notificationService.show("Room code not found. Creating a new room instead.", "warning", 2800);
      } else if (joinFailureReason === "room_full") {
        notificationService.show("That room code is full. Creating a new room instead.", "warning", 2800);
      } else if (joinFailureReason === "session_expired") {
        notificationService.show("That room expired. Creating a new room instead.", "warning", 2800);
      } else {
        notificationService.show("Unable to join that room code. Creating a new room instead.", "warning", 2800);
      }
    }

    if (!environment.features.multiplayer || this.playMode !== "multiplayer") {
      return;
    }

    const multiplayerIdentity = await this.resolveMultiplayerIdentityPayload();
    const requestedDifficulty = this.resolveRequestedMultiplayerDifficulty();
    this.state.mode.difficulty = requestedDifficulty;
    const createdSession = await this.multiplayerSessionService.createSession({
      roomCode: this.multiplayerOptions.roomCode,
      displayName: multiplayerIdentity.displayName,
      avatarUrl: multiplayerIdentity.avatarUrl,
      providerId: multiplayerIdentity.providerId,
      botCount: this.multiplayerOptions.botCount,
      gameDifficulty: requestedDifficulty,
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
    const multiplayerIdentity = await this.resolveMultiplayerIdentityPayload();
    const session = await this.multiplayerSessionService.joinSession(sessionId, {
      displayName: multiplayerIdentity.displayName,
      avatarUrl: multiplayerIdentity.avatarUrl,
      providerId: multiplayerIdentity.providerId,
      botCount: this.resolveJoinBotCount(),
    });
    if (!session) {
      playerDataSyncService.setSessionId(undefined);
      if (!options?.suppressFailureNotification) {
        const joinFailureReason = this.multiplayerSessionService.getLastJoinFailureReason();
        if (joinFailureReason === "room_full") {
          notificationService.show("Room is full. Pick another room or create a new one.", "warning", 2800);
        } else if (joinFailureReason === "session_expired") {
          notificationService.show("That room expired. Pick another room.", "warning", 2800);
        } else if (joinFailureReason === "room_not_found") {
          notificationService.show("Room code not found. Check the invite and try again.", "warning", 2800);
        } else {
          notificationService.show("Unable to join multiplayer session.", "error", 2600);
        }
      }
      return false;
    }

    this.bindMultiplayerSession(session, !fromInviteLink);
    if (fromInviteLink) {
      notificationService.show(`Joined multiplayer room ${session.roomCode}.`, "success", 2600);
    }
    return true;
  }

  private async joinMultiplayerRoomByCode(
    roomCode: string,
    fromInviteLink: boolean,
    options?: { suppressFailureNotification?: boolean }
  ): Promise<boolean> {
    const normalizedRoomCode = this.normalizeInviteRoomCode(roomCode);
    if (!normalizedRoomCode) {
      if (!options?.suppressFailureNotification) {
        notificationService.show("Room code is invalid.", "warning", 2400);
      }
      return false;
    }

    const multiplayerIdentity = await this.resolveMultiplayerIdentityPayload();
    const session = await this.multiplayerSessionService.joinRoomByCode(normalizedRoomCode, {
      displayName: multiplayerIdentity.displayName,
      avatarUrl: multiplayerIdentity.avatarUrl,
      providerId: multiplayerIdentity.providerId,
      botCount: this.resolveJoinBotCount(),
      gameDifficulty: this.resolveRequestedMultiplayerDifficulty(),
    });
    if (!session) {
      if (!options?.suppressFailureNotification) {
        const joinFailureReason = this.multiplayerSessionService.getLastJoinFailureReason();
        if (joinFailureReason === "room_not_found") {
          notificationService.show("Room code not found.", "warning", 2600);
        } else if (joinFailureReason === "room_full") {
          notificationService.show("That room is full. Try another room.", "warning", 2600);
        } else if (joinFailureReason === "session_expired") {
          notificationService.show("That room expired. Try another room.", "warning", 2600);
        } else {
          notificationService.show("Unable to join room code.", "error", 2400);
        }
      }
      return false;
    }

    this.bindMultiplayerSession(session, !fromInviteLink);
    if (fromInviteLink) {
      notificationService.show(`Joined multiplayer room ${session.roomCode}.`, "success", 2600);
    }
    return true;
  }

  private async tryJoinAlternativeRoom(
    excludedSessionId: string,
    sourceReason: MultiplayerJoinFailureReason | null
  ): Promise<boolean> {
    if (this.playMode !== "multiplayer" || !environment.features.multiplayer) {
      return false;
    }
    if (sourceReason !== "room_full" && sourceReason !== "session_expired") {
      return false;
    }

    const rooms = await backendApiService.listMultiplayerRooms(24);
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return false;
    }

    const candidate = this.selectAlternativeRoomCandidate(rooms, excludedSessionId);
    if (!candidate) {
      return false;
    }

    const joined = await this.joinMultiplayerSession(candidate.sessionId, false, {
      suppressFailureNotification: true,
    });
    if (!joined) {
      return false;
    }

    notificationService.show(
      `Joined fallback room ${candidate.roomCode}.`,
      "success",
      2600
    );
    return true;
  }

  private selectAlternativeRoomCandidate(
    rooms: MultiplayerRoomListing[],
    excludedSessionId: string
  ): MultiplayerRoomListing | null {
    const excludedId = excludedSessionId.trim();
    const candidates = rooms.filter((room) => {
      if (!room || typeof room.sessionId !== "string" || room.sessionId === excludedId) {
        return false;
      }
      if (room.sessionComplete === true) {
        return false;
      }
      const maxPlayers =
        typeof room.maxHumanCount === "number" && Number.isFinite(room.maxHumanCount)
          ? Math.max(1, Math.floor(room.maxHumanCount))
          : 8;
      const availableSlots =
        typeof room.availableHumanSlots === "number" && Number.isFinite(room.availableHumanSlots)
          ? Math.max(0, Math.floor(room.availableHumanSlots))
          : Math.max(0, maxPlayers - Math.max(0, Math.floor(room.humanCount)));
      return availableSlots > 0;
    });
    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      const leftPriority =
        left.roomType === "public_default" ? 0 : left.roomType === "public_overflow" ? 1 : 2;
      const rightPriority =
        right.roomType === "public_default" ? 0 : right.roomType === "public_overflow" ? 1 : 2;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return right.activeHumanCount - left.activeHumanCount;
    });

    return candidates[0] ?? null;
  }

  private resolveJoinBotCount(): number | undefined {
    const parsed =
      typeof this.multiplayerOptions.joinBotCount === "number" &&
      Number.isFinite(this.multiplayerOptions.joinBotCount)
        ? Math.floor(this.multiplayerOptions.joinBotCount)
        : NaN;
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.max(1, Math.min(4, parsed));
  }

  private async resolveMultiplayerIdentityPayload(): Promise<{
    displayName?: string;
    avatarUrl?: string;
    providerId?: string;
  }> {
    const now = Date.now();
    if (
      this.cachedMultiplayerIdentity &&
      now - this.cachedMultiplayerIdentity.fetchedAt < MULTIPLAYER_IDENTITY_CACHE_MS
    ) {
      this.localAvatarUrl = this.cachedMultiplayerIdentity.value.avatarUrl;
      return this.cachedMultiplayerIdentity.value;
    }

    await firebaseAuthService.initialize();
    const firebaseProfile = firebaseAuthService.getCurrentUserProfile();
    const isAuthenticated = Boolean(firebaseProfile && !firebaseProfile.isAnonymous);

    let accountProfile: Awaited<ReturnType<typeof leaderboardService.getAccountProfile>> = null;
    if (isAuthenticated) {
      accountProfile = await leaderboardService.getAccountProfile();
    }

    const displayNameCandidates = [
      accountProfile?.leaderboardName,
      accountProfile?.displayName,
      firebaseProfile?.displayName,
    ];
    const displayName = displayNameCandidates
      .map((candidate) => this.normalizeMultiplayerDisplayName(candidate))
      .find((candidate) => typeof candidate === "string" && candidate.length > 0);
    const avatarUrl = this.normalizeMultiplayerAvatarUrl(
      accountProfile?.photoUrl ?? firebaseProfile?.photoURL
    );
    const providerId = this.normalizeMultiplayerProviderId(
      accountProfile?.providerId ?? firebaseProfile?.providerId
    );

    const identity = {
      displayName,
      avatarUrl,
      providerId,
    };
    this.localAvatarUrl = avatarUrl;
    this.cachedMultiplayerIdentity = {
      value: identity,
      fetchedAt: now,
    };
    return identity;
  }

  private normalizeMultiplayerDisplayName(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      return undefined;
    }
    return trimmed.slice(0, 24);
  }

  private normalizeMultiplayerAvatarUrl(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 2048) {
      return undefined;
    }
    try {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://localhost";
      const parsed = new URL(trimmed, baseUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return undefined;
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  private normalizeMultiplayerProviderId(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    const safe = normalized.replace(/[^a-z0-9._:-]/g, "").slice(0, 64);
    return safe || undefined;
  }

  private bindMultiplayerSession(
    session: MultiplayerSessionRecord,
    updateUrlSessionParam: boolean
  ): void {
    playerDataSyncService.setSessionId(session.sessionId);
    this.sessionExpiryPromptActive = false;
    this.lastTurnPlanPreview = "";
    this.applyMultiplayerClockFromServer(session, { force: true });
    this.applyMultiplayerDifficultyIfPresent(
      session.gameDifficulty ?? this.multiplayerOptions.gameDifficulty
    );
    this.applyMultiplayerSeatState(session);
    this.touchMultiplayerTurnSyncActivity();
    this.hud.setTurnSyncStatus("ok", "Sync Ready");

    const sessionWsUrl = this.buildSessionWsUrl(session);
    if (sessionWsUrl) {
      this.setMultiplayerNetwork(sessionWsUrl);
      log.info(`Rebound multiplayer network to session socket: ${session.sessionId}`);
    }

    if (updateUrlSessionParam) {
      this.updateSessionQueryParam(session.sessionId, session.roomCode);
    }

    this.updateInviteLinkControlVisibility();
    log.info(`Joined multiplayer session via API scaffold: ${session.sessionId}`);
    window.setTimeout(() => {
      const activeSessionId = this.multiplayerSessionService.getActiveSession()?.sessionId;
      if (activeSessionId !== session.sessionId) {
        return;
      }
      void this.requestTurnSyncRefresh("post_join_sync");
    }, 350);
  }

  private applyMultiplayerSeatState(session: MultiplayerSessionRecord): void {
    this.applyMultiplayerClockFromServer(session);
    const seatedParticipants = this.computeSeatedParticipants(session);
    const localSeatState = seatedParticipants.find(
      (participant) => participant.playerId === this.localPlayerId
    );
    this.hud.setLocalWaitStatus(
      localSeatState?.queuedForNextGame
        ? "Waiting"
        : localSeatState?.isSeated === false
          ? "Standing"
          : null
    );
    this.syncBotMemeAvatarState(seatedParticipants);
    const participantBySeat = new Map<number, SeatedMultiplayerParticipant>();
    const previousParticipantIds = new Set(this.participantSeatById.keys());
    this.participantSeatById.clear();
    this.participantIdBySeat.clear();
    this.participantLabelById.clear();
    const showReadyState =
      seatedParticipants.filter(
        (participant) =>
          participant.isSeated &&
          !participant.isBot &&
          !participant.isComplete &&
          !participant.queuedForNextGame
      )
        .length > 1;
    seatedParticipants.forEach((participant) => {
      participantBySeat.set(participant.seatIndex, participant);
      const isCurrentPlayer = participant.playerId === this.localPlayerId;
      this.participantSeatById.set(participant.playerId, participant.seatIndex);
      this.participantIdBySeat.set(participant.seatIndex, participant.playerId);
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
    this.nudgeCooldownByPlayerId.forEach((_, playerId) => {
      if (!activeParticipantIds.has(playerId)) {
        this.nudgeCooldownByPlayerId.delete(playerId);
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
          avatarUrl: participant.avatarUrl,
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
        avatarUrl: isCurrentSeat ? this.localAvatarUrl : undefined,
        avatarColor: isCurrentSeat ? new Color3(0.24, 0.84, 0.36) : undefined,
        score: isCurrentSeat ? this.state.score : undefined,
        isComplete: false,
      });
    }

    this.multiplayerTurnPlan = buildClockwiseTurnPlan(
      seatedParticipants
        .filter((participant) => participant.isSeated && !participant.queuedForNextGame)
        .map((participant) => ({
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
    this.updateUI();
  }

  private syncBotMemeAvatarState(seatedParticipants: SeatedMultiplayerParticipant[]): void {
    if (this.playMode !== "multiplayer" || !botMemeAvatarService.isEnabled()) {
      this.stopBotMemeAvatarRotation();
      this.botMemeAvatarByPlayerId.clear();
      return;
    }

    const botParticipants = seatedParticipants.filter((participant) => participant.isBot);
    const activeBotIds = new Set(botParticipants.map((participant) => participant.playerId));
    this.botMemeAvatarByPlayerId.forEach((_, playerId) => {
      if (!activeBotIds.has(playerId)) {
        this.botMemeAvatarByPlayerId.delete(playerId);
      }
    });
    const seenAssignedUrls = new Set<string>();
    botParticipants.forEach((participant) => {
      const assignedUrl = this.botMemeAvatarByPlayerId.get(participant.playerId);
      if (!assignedUrl) {
        return;
      }
      if (seenAssignedUrls.has(assignedUrl)) {
        this.botMemeAvatarByPlayerId.delete(participant.playerId);
        return;
      }
      seenAssignedUrls.add(assignedUrl);
    });

    if (botParticipants.length === 0) {
      this.stopBotMemeAvatarRotation();
      return;
    }

    this.ensureBotMemeAvatarRotation();
    if (botParticipants.some((participant) => !this.botMemeAvatarByPlayerId.has(participant.playerId))) {
      void this.refreshBotMemeAvatars(botParticipants, "seed");
    }
  }

  private resolveSeatAvatarUrl(
    playerId: string,
    avatarUrl: string | undefined,
    isBot: boolean
  ): string | undefined {
    if (!isBot || !botMemeAvatarService.isEnabled()) {
      return avatarUrl;
    }
    const resolved = this.botMemeAvatarByPlayerId.get(playerId) ?? avatarUrl;
    return botMemeAvatarService.getRenderableAvatarUrl(resolved);
  }

  private ensureBotMemeAvatarRotation(): void {
    if (this.botMemeAvatarRotationHandle) {
      return;
    }
    const rotationMs = botMemeAvatarService.getRotationIntervalMs();
    if (!Number.isFinite(rotationMs) || rotationMs <= 0) {
      return;
    }
    this.botMemeAvatarRotationHandle = setInterval(() => {
      void this.rotateBotMemeAvatar();
    }, rotationMs);
  }

  private stopBotMemeAvatarRotation(): void {
    if (!this.botMemeAvatarRotationHandle) {
      return;
    }
    clearInterval(this.botMemeAvatarRotationHandle);
    this.botMemeAvatarRotationHandle = null;
  }

  private async rotateBotMemeAvatar(): Promise<void> {
    if (this.playMode !== "multiplayer" || !botMemeAvatarService.isEnabled()) {
      this.stopBotMemeAvatarRotation();
      return;
    }

    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession) {
      this.stopBotMemeAvatarRotation();
      return;
    }

    const botParticipants = this.computeSeatedParticipants(activeSession).filter(
      (participant) => participant.isBot
    );
    if (botParticipants.length === 0) {
      this.stopBotMemeAvatarRotation();
      return;
    }

    await this.refreshBotMemeAvatars(botParticipants, "rotate");
  }

  private async refreshBotMemeAvatars(
    botParticipants: SeatedMultiplayerParticipant[],
    mode: "seed" | "rotate"
  ): Promise<void> {
    if (this.botMemeAvatarRefreshInFlight || botParticipants.length === 0) {
      return;
    }

    this.botMemeAvatarRefreshInFlight = true;
    try {
      let targets: SeatedMultiplayerParticipant[] = [];
      if (mode === "seed") {
        targets = botParticipants.filter(
          (participant) => !this.botMemeAvatarByPlayerId.has(participant.playerId)
        );
        shuffleInPlace(targets);
      } else {
        const randomIndex = Math.floor(Math.random() * botParticipants.length);
        const randomBot = botParticipants[randomIndex];
        if (randomBot) {
          targets = [randomBot];
        }
      }
      if (targets.length === 0) {
        return;
      }

      let changed = false;
      const occupiedUrls = new Set<string>();
      botParticipants.forEach((participant) => {
        const currentUrl = this.botMemeAvatarByPlayerId.get(participant.playerId) ?? participant.avatarUrl;
        if (currentUrl) {
          occupiedUrls.add(currentUrl);
        }
      });

      for (const target of targets) {
        const currentUrl = this.botMemeAvatarByPlayerId.get(target.playerId) ?? target.avatarUrl;
        if (currentUrl) {
          occupiedUrls.delete(currentUrl);
        }
        const nextUrl = await this.getUniqueBotMemeAvatarUrl(occupiedUrls, currentUrl);

        if (currentUrl) {
          occupiedUrls.add(currentUrl);
        }
        if (!nextUrl || nextUrl === currentUrl) {
          continue;
        }

        this.botMemeAvatarByPlayerId.set(target.playerId, nextUrl);
        occupiedUrls.add(nextUrl);
        changed = true;
      }

      if (!changed) {
        return;
      }

      const activeSession = this.multiplayerSessionService.getActiveSession();
      if (activeSession) {
        this.applyMultiplayerSeatState(activeSession);
      }
    } catch (error) {
      log.debug("Unable to refresh bot meme avatars", error);
    } finally {
      this.botMemeAvatarRefreshInFlight = false;
    }
  }

  private async getUniqueBotMemeAvatarUrl(
    occupiedUrls: Set<string>,
    currentUrl: string | undefined
  ): Promise<string | undefined> {
    for (let attempt = 0; attempt < BOT_MEME_UNIQUE_ATTEMPTS; attempt += 1) {
      const nextUrl = await botMemeAvatarService.getMemeAvatarUrl({
        excludeUrls: new Set(occupiedUrls),
      });
      if (!nextUrl || nextUrl === currentUrl || occupiedUrls.has(nextUrl)) {
        continue;
      }
      return nextUrl;
    }
    return undefined;
  }

  private applySoloSeatState(): void {
    this.clearSelectionSyncDebounce();
    this.participantSeatById.clear();
    this.participantIdBySeat.clear();
    this.participantLabelById.clear();
    this.nudgeCooldownByPlayerId.clear();
    this.multiplayerTurnPlan = null;
    this.stopBotMemeAvatarRotation();
    this.botMemeAvatarByPlayerId.clear();
    this.hud.setRoundCountdownDeadline(null);

    const seatCount = Math.max(1, this.scene.playerSeats.length || 8);
    const currentSeatIndex = this.scene.currentPlayerSeat;
    for (let seatIndex = 0; seatIndex < seatCount; seatIndex += 1) {
      const isCurrentSeat = seatIndex === currentSeatIndex;
      this.scene.playerSeatRenderer.updateSeat(seatIndex, {
        occupied: isCurrentSeat,
        isCurrentPlayer: isCurrentSeat,
        isBot: false,
        playerName: isCurrentSeat ? "YOU" : "Empty",
        avatarUrl: isCurrentSeat ? this.localAvatarUrl : undefined,
        avatarColor: isCurrentSeat ? new Color3(0.24, 0.84, 0.36) : undefined,
        score: isCurrentSeat ? this.state.score : undefined,
        isComplete: false,
      });
    }
    this.scene.playerSeatRenderer.highlightSeat(currentSeatIndex);
    this.scene.setActiveTurnSeat(currentSeatIndex);
    this.hud.setMultiplayerStandings([], null);
    this.hud.setMultiplayerActiveTurn(null);
    this.hud.setTurnSyncStatus(null);
    this.hud.setLocalWaitStatus(null);
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
      avatarUrl: this.resolveSeatAvatarUrl(
        this.localPlayerId,
        localParticipant?.avatarUrl ?? this.localAvatarUrl,
        false
      ),
      providerId: localParticipant?.providerId,
      seatIndex: currentSeatIndex,
      isBot: false,
      isSeated: localParticipant?.isSeated === true,
      isReady: localParticipant?.isReady === true,
      score: normalizeParticipantScore(localParticipant?.score),
      remainingDice: normalizeRemainingDice(localParticipant?.remainingDice),
      queuedForNextGame: normalizeQueuedForNextGame(localParticipant?.queuedForNextGame),
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
        avatarUrl: this.resolveSeatAvatarUrl(
          participant.playerId,
          participant.avatarUrl,
          participant.isBot
        ),
        providerId: participant.providerId,
        seatIndex: availableSeats[index],
        isBot: participant.isBot,
        isSeated: participant.isSeated,
        isReady: participant.isReady,
        score: participant.score,
        remainingDice: participant.remainingDice,
        queuedForNextGame: participant.queuedForNextGame,
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
    avatarUrl?: string;
    providerId?: string;
    isBot: boolean;
    isSeated: boolean;
    isReady: boolean;
    score: number;
    remainingDice: number;
    queuedForNextGame: boolean;
    isComplete: boolean;
    completedAt: number | null;
    joinedAt: number;
  }> {
    const seen = new Map<
      string,
      {
        playerId: string;
        displayName: string;
        avatarUrl?: string;
        providerId?: string;
        isBot: boolean;
        isSeated: boolean;
        isReady: boolean;
        score: number;
        remainingDice: number;
        queuedForNextGame: boolean;
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
        avatarUrl: this.normalizeMultiplayerAvatarUrl(participant.avatarUrl),
        providerId: this.normalizeMultiplayerProviderId(participant.providerId),
        isBot: Boolean(participant.isBot),
        isSeated: Boolean(participant.isBot) ? true : participant.isSeated !== false,
        isReady:
          Boolean(participant.isBot)
            ? true
            : participant.isSeated !== false && participant.isReady === true,
        score: normalizeParticipantScore(participant.score),
        remainingDice: normalizeRemainingDice(participant.remainingDice),
        queuedForNextGame: normalizeQueuedForNextGame(participant.queuedForNextGame),
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
        avatarUrl: this.localAvatarUrl,
        providerId: undefined,
        isBot: false,
        isSeated: false,
        isReady: false,
        score: normalizeParticipantScore(this.state.score),
        remainingDice: 0,
        queuedForNextGame: false,
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
    if (participant.queuedForNextGame) {
      return `${label} • NEXT`.slice(0, 24);
    }
    if (!participant.isSeated) {
      return `${label} • STAND`.slice(0, 24);
    }
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
    if (!participant.isSeated) {
      return new Color3(0.44, 0.48, 0.56);
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
      : seatedParticipants
          .filter((participant) => participant.isSeated && !participant.queuedForNextGame)
          .map((participant) => ({
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

  private getSessionParticipantById(
    session: MultiplayerSessionRecord,
    playerId: string
  ): MultiplayerSessionParticipant | null {
    const participants = Array.isArray(session.participants) ? session.participants : [];
    for (const participant of participants) {
      if (!participant || typeof participant.playerId !== "string") {
        continue;
      }
      if (participant.playerId === playerId) {
        return participant;
      }
    }
    return null;
  }

  private getLocalMultiplayerSeatState(): {
    isSeated: boolean;
    isReady: boolean;
    queuedForNextGame: boolean;
  } | null {
    if (this.playMode !== "multiplayer") {
      return null;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession) {
      return null;
    }
    const localParticipant = this.getSessionParticipantById(activeSession, this.localPlayerId);
    if (!localParticipant || localParticipant.isBot) {
      return null;
    }
    return {
      isSeated: localParticipant.isSeated !== false,
      isReady: localParticipant.isSeated !== false && localParticipant.isReady === true,
      queuedForNextGame: normalizeQueuedForNextGame(localParticipant.queuedForNextGame),
    };
  }

  private async updateLocalParticipantState(
    action: "sit" | "stand" | "ready" | "unready"
  ): Promise<void> {
    if (this.participantStateUpdateInFlight) {
      return;
    }
    if (this.playMode !== "multiplayer") {
      return;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId) {
      notificationService.show("No active multiplayer room found.", "warning", 2000);
      return;
    }

    this.participantStateUpdateInFlight = true;
    try {
      const nextSession = await this.multiplayerSessionService.updateParticipantState(action);
      if (!nextSession) {
        if (action === "ready") {
          notificationService.show("Sit down before readying up.", "warning", 2200);
        } else {
          notificationService.show("Unable to update seat status right now.", "warning", 2200);
        }
        return;
      }

      this.applyMultiplayerSeatState(nextSession);
      this.touchMultiplayerTurnSyncActivity();
      const successMessageByAction = {
        sit: "You sat down. Tap Ready when you want in.",
        stand: "You stood up and moved to observer mode.",
        ready: "Ready up confirmed.",
        unready: "You are no longer marked ready.",
      } as const;
      notificationService.show(successMessageByAction[action], action === "ready" ? "success" : "info", 1800);
    } finally {
      this.participantStateUpdateInFlight = false;
    }
  }

  private shouldResetLocalStateForNextMultiplayerGame(
    previousSession: MultiplayerSessionRecord,
    nextSession: MultiplayerSessionRecord
  ): boolean {
    if (this.playMode !== "multiplayer") {
      return false;
    }

    const previousLocalParticipant = this.getSessionParticipantById(previousSession, this.localPlayerId);
    const nextLocalParticipant = this.getSessionParticipantById(nextSession, this.localPlayerId);
    if (!previousLocalParticipant || !nextLocalParticipant) {
      return false;
    }

    const previousScore = normalizeParticipantScore(previousLocalParticipant.score);
    const nextScore = normalizeParticipantScore(nextLocalParticipant.score);
    const previousRemaining = normalizeRemainingDice(previousLocalParticipant.remainingDice);
    const nextRemaining = normalizeRemainingDice(nextLocalParticipant.remainingDice);
    const nextRound =
      typeof nextSession.turnState?.round === "number" && Number.isFinite(nextSession.turnState.round)
        ? Math.max(1, Math.floor(nextSession.turnState.round))
        : 1;
    const nextTurnNumber =
      typeof nextSession.turnState?.turnNumber === "number" &&
      Number.isFinite(nextSession.turnState.turnNumber)
        ? Math.max(1, Math.floor(nextSession.turnState.turnNumber))
        : 1;
    if (nextRound !== 1 || nextTurnNumber !== 1) {
      return false;
    }

    if (
      nextScore !== 0 ||
      nextLocalParticipant.isComplete === true ||
      normalizeQueuedForNextGame(nextLocalParticipant.queuedForNextGame) ||
      nextRemaining <= 0
    ) {
      return false;
    }

    const previousRound =
      typeof previousSession.turnState?.round === "number" &&
      Number.isFinite(previousSession.turnState.round)
        ? Math.max(1, Math.floor(previousSession.turnState.round))
        : 1;
    const previousTurnNumber =
      typeof previousSession.turnState?.turnNumber === "number" &&
      Number.isFinite(previousSession.turnState.turnNumber)
        ? Math.max(1, Math.floor(previousSession.turnState.turnNumber))
        : 1;
    const hadRuntimeProgress =
      this.state.score > 0 || this.state.rollIndex > 0 || this.state.status !== "READY";
    const hadSessionProgress =
      previousSession.sessionComplete === true ||
      previousLocalParticipant.isComplete === true ||
      previousScore > 0 ||
      previousRemaining <= 0 ||
      previousRound > 1 ||
      previousTurnNumber > 1;
    if (!hadRuntimeProgress && !hadSessionProgress) {
      return false;
    }

    const countersRewound =
      nextScore < previousScore ||
      nextRemaining > previousRemaining ||
      previousSession.sessionComplete === true;
    if (countersRewound) {
      return true;
    }
    if (!hadSessionProgress) {
      return false;
    }
    return hadRuntimeProgress && previousLocalParticipant.isComplete === true;
  }

  private resetLocalStateForNextMultiplayerGame(options?: { notificationMessage?: string | null }): void {
    this.gameOverController.hide();
    this.state = GameFlowController.createNewGame();
    if (this.playMode === "multiplayer") {
      const sessionDifficulty = this.multiplayerSessionService.getActiveSession()?.gameDifficulty;
      this.applyMultiplayerDifficultyIfPresent(
        sessionDifficulty ?? this.multiplayerOptions.gameDifficulty
      );
    } else {
      GameFlowController.updateHintMode(this.state, this.diceRow);
    }
    this.diceRenderer.clearDice();
    this.scene.returnCameraToDefaultOverview(true);
    this.animating = false;
    this.awaitingMultiplayerRoll = false;
    this.pendingTurnEndSync = false;
    this.activeRollServerId = null;
    this.selectedDieIndex = 0;
    this.selectedSeatFocusIndex = -1;
    this.resetLocalGameClockStart();
    this.applyTurnTiming(null);
    const notificationMessage = options?.notificationMessage;
    if (notificationMessage !== null) {
      notificationService.show(notificationMessage ?? "Next multiplayer game started.", "info", 1800);
    }
  }

  private shouldShowWaitForNextGameAction(): boolean {
    if (this.playMode !== "multiplayer" || this.state.status !== "COMPLETE") {
      return false;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession || activeSession.sessionComplete !== true) {
      return false;
    }
    const localParticipant = this.getSessionParticipantById(activeSession, this.localPlayerId);
    if (!localParticipant || normalizeQueuedForNextGame(localParticipant.queuedForNextGame)) {
      return false;
    }
    if (!Array.isArray(activeSession.standings) || activeSession.standings.length === 0) {
      return false;
    }
    const winnerPlayerId = activeSession.standings[0]?.playerId;
    return winnerPlayerId === this.localPlayerId;
  }

  private async queueForNextMultiplayerGame(): Promise<void> {
    if (this.waitForNextGameRequestInFlight) {
      return;
    }
    this.waitForNextGameRequestInFlight = true;
    this.updateUI();

    try {
      const queuedSession = await this.multiplayerSessionService.queueForNextGame();
      if (!queuedSession) {
        notificationService.show("Unable to queue for the next game yet.", "warning", 2200);
        return;
      }

      this.resetLocalStateForNextMultiplayerGame({ notificationMessage: null });
      this.applyMultiplayerSeatState(queuedSession);
      this.touchMultiplayerTurnSyncActivity();
      notificationService.show("Waiting for next game...", "info", 2000);
    } finally {
      this.waitForNextGameRequestInFlight = false;
      this.updateUI();
    }
  }

  private applyTurnStateFromSession(session: MultiplayerSessionRecord): void {
    this.awaitingMultiplayerRoll = false;
    this.applyTurnTiming(session.turnState?.turnExpiresAt);
    const serverActiveTurnPlayerId = session.turnState?.activeTurnPlayerId ?? null;
    this.hud.setMultiplayerActiveTurn(serverActiveTurnPlayerId);
    if (serverActiveTurnPlayerId) {
      this.clearPendingTurnTransitionSyncRecovery();
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
      this.selectedSeatFocusIndex = -1;
      this.scene.playerSeatRenderer.highlightSeat(this.scene.currentPlayerSeat);
      this.scene.setActiveTurnSeat(this.scene.currentPlayerSeat);
      return;
    }

    if (activePlayerId === this.localPlayerId) {
      this.selectedSeatFocusIndex = -1;
    }

    const seatIndex = this.participantSeatById.get(activePlayerId);
    if (typeof seatIndex === "number") {
      this.scene.playerSeatRenderer.highlightSeat(seatIndex);
      this.scene.setActiveTurnSeat(seatIndex);
      return;
    }

    this.scene.playerSeatRenderer.highlightSeat(this.scene.currentPlayerSeat);
    this.scene.setActiveTurnSeat(this.scene.currentPlayerSeat);
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

  private resolveParticleAnchorPosition(playerId: string): Vector3 | null {
    const normalizedPlayerId =
      typeof playerId === "string" ? playerId.trim() : "";
    if (!normalizedPlayerId) {
      return null;
    }

    let seatIndex = this.participantSeatById.get(normalizedPlayerId);
    if (typeof seatIndex !== "number" && normalizedPlayerId === this.localPlayerId) {
      seatIndex = this.scene.currentPlayerSeat;
    }
    if (typeof seatIndex !== "number") {
      return null;
    }

    const avatarHeadAnchor = this.scene.playerSeatRenderer.getSeatHeadAnchorPosition(seatIndex);
    if (avatarHeadAnchor) {
      return avatarHeadAnchor.clone();
    }

    const scoreZone = this.scene.playerSeatRenderer.getSeatScoreZonePosition(seatIndex);
    if (scoreZone) {
      return scoreZone.clone();
    }

    const seat = this.scene.playerSeats[seatIndex];
    return seat?.position?.clone() ?? null;
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
    this.diceRenderer.cancelSpectatorPreview(this.buildSpectatorPreviewKey(targetPlayerId));
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

  private getParticipantBroadcastLabel(playerId: string): string {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    const participant = participants.find((entry) => entry?.playerId === playerId);
    const displayName =
      typeof participant?.displayName === "string" ? participant.displayName.trim() : "";
    if (displayName) {
      return displayName.slice(0, 20);
    }

    const label = this.participantLabelById.get(playerId);
    if (label && label.toUpperCase() !== "YOU") {
      return label;
    }

    return this.buildDefaultParticipantName(playerId, participant?.isBot === true);
  }

  private isBotParticipant(playerId: string): boolean {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants.some(
      (participant) =>
        participant?.playerId === playerId &&
        participant.isBot === true
    );
  }

  private canComposeRoomChannelMessage(): boolean {
    if (this.playMode !== "multiplayer" || !environment.features.multiplayer) {
      notificationService.show("Room chat is available in multiplayer only.", "info", 1800);
      return false;
    }
    if (!this.multiplayerSessionService.getActiveSession()) {
      notificationService.show("Join a multiplayer room to chat.", "warning", 2000);
      return false;
    }
    if (!this.multiplayerNetwork?.isConnected()) {
      notificationService.show("Reconnect to room chat before sending.", "warning", 2000);
      return false;
    }
    return true;
  }

  private normalizeComposedRoomChannelMessage(value: string | null): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().replace(/\s+/g, " ").slice(0, 320);
    return normalized || null;
  }

  private getWhisperTargets(): Array<{ playerId: string; label: string }> {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants
      .filter(
        (participant) =>
          participant &&
          participant.playerId !== this.localPlayerId &&
          participant.isBot !== true &&
          participant.queuedForNextGame !== true
      )
      .map((participant) => ({
        playerId: participant.playerId,
        label: this.getParticipantBroadcastLabel(participant.playerId),
      }));
  }

  private resolveWhisperTargetPlayerId(rawTarget: string): string | null {
    const whisperTargets = this.getWhisperTargets();
    if (whisperTargets.length === 0) {
      return null;
    }
    const allowedPlayerIds = new Set(whisperTargets.map((target) => target.playerId));
    const trimmedTarget = rawTarget.trim();
    if (!trimmedTarget) {
      return null;
    }

    const byExactId = whisperTargets.find((target) => target.playerId === trimmedTarget);
    if (byExactId) {
      return byExactId.playerId;
    }

    const parsedIndex = Number.parseInt(trimmedTarget, 10);
    if (
      Number.isFinite(parsedIndex) &&
      parsedIndex >= 1 &&
      parsedIndex <= whisperTargets.length &&
      /^\d+$/.test(trimmedTarget)
    ) {
      return whisperTargets[parsedIndex - 1].playerId;
    }

    const byToken = this.resolvePlayerIdByParticipantToken(trimmedTarget);
    if (byToken && allowedPlayerIds.has(byToken)) {
      return byToken;
    }

    return null;
  }

  private sendPlayerRoomChannelMessage(
    options: {
      idPrefix: string;
      channel: "public" | "direct";
      topic?: string;
      title?: string;
      message: string;
      severity?: "info" | "success" | "warning" | "error";
      targetPlayerId?: string;
    },
    timestamp: number = Date.now()
  ): boolean {
    const normalizedMessage = this.normalizeComposedRoomChannelMessage(options.message);
    if (!normalizedMessage) {
      return false;
    }
    const payload: MultiplayerRoomChannelMessage = {
      type: "room_channel",
      id: `${options.idPrefix}-${this.localPlayerId}-${timestamp}`,
      channel: options.channel,
      ...(typeof options.topic === "string" && options.topic.trim().length > 0
        ? { topic: options.topic.trim().toLowerCase().slice(0, 32) }
        : {}),
      playerId: this.localPlayerId,
      sourcePlayerId: this.localPlayerId,
      sourceRole: "player",
      ...(typeof options.title === "string" && options.title.trim().length > 0
        ? { title: options.title.trim().replace(/\s+/g, " ").slice(0, 80) }
        : {}),
      message: normalizedMessage,
      severity: options.severity ?? "info",
      ...(options.channel === "direct" &&
      typeof options.targetPlayerId === "string" &&
      options.targetPlayerId.trim().length > 0
        ? { targetPlayerId: options.targetPlayerId.trim() }
        : {}),
      timestamp,
    };
    return this.multiplayerNetwork?.sendRoomChannelMessage(payload) ?? false;
  }

  private triggerTurnNudge(targetPlayerId: string): void {
    if (!this.activeTurnPlayerId || this.activeTurnPlayerId !== targetPlayerId) {
      return;
    }

    const lastSentAt = this.nudgeCooldownByPlayerId.get(targetPlayerId) ?? 0;
    const now = Date.now();
    if (now - lastSentAt < TURN_NUDGE_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((TURN_NUDGE_COOLDOWN_MS - (now - lastSentAt)) / 1000);
      notificationService.show(
        `Nudge cooldown: ${waitSeconds}s`,
        "info",
        1200
      );
      return;
    }

    const targetLabel = this.getParticipantLabel(targetPlayerId);
    const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
    const sent = this.sendPlayerRoomChannelMessage({
      idPrefix: `nudge-${targetPlayerId}`,
      channel: "direct",
      topic: "nudge",
      title: `Nudge from ${sourceLabel}`,
      message: "Your turn is up. Take your turn!",
      severity: "warning",
      targetPlayerId,
    }, now);

    this.nudgeCooldownByPlayerId.set(targetPlayerId, now);
    this.showSeatBubbleForPlayer(targetPlayerId, "Nudged!", {
      tone: "warning",
      durationMs: 1200,
      isBot: this.isBotParticipant(targetPlayerId),
    });

    if (!sent) {
      notificationService.show(
        `${targetLabel} nudged locally.`,
        "info",
        1400
      );
      return;
    }

    notificationService.show(
      `${targetLabel} nudged.`,
      "info",
      1400
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
    payload:
      | MultiplayerGameUpdateMessage
      | MultiplayerPlayerNotificationMessage
      | MultiplayerRoomChannelMessage
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
    if (this.playMode !== "multiplayer") {
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
      if (bubbled && payload.targetPlayerId !== this.localPlayerId) {
        return;
      }
    }

    if (
      tone === "warning" ||
      tone === "error" ||
      payload.targetPlayerId === this.localPlayerId
    ) {
      const title = payload.title?.trim() || (payload.targetPlayerId === this.localPlayerId ? "Direct" : "Multiplayer");
      notificationService.show(`${title}: ${message}`, tone, 3200);
    }
  }

  private handleMultiplayerRoomChannelMessage(payload: MultiplayerRoomChannelMessage): void {
    if (this.playMode !== "multiplayer") {
      return;
    }
    const channel = payload.channel === "direct" ? "direct" : "public";
    const targetPlayerId =
      typeof payload.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
    if (channel === "direct" && targetPlayerId !== this.localPlayerId) {
      return;
    }

    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (!message) {
      return;
    }
    const topic = typeof payload.topic === "string" ? payload.topic.trim().toLowerCase() : "";
    const countdownMatch = /^next game starts in\s+(\d+)s\.?$/i.exec(message);
    const countdownSeconds = countdownMatch ? Number.parseInt(countdownMatch[1], 10) : null;
    const hasCountdownSeconds =
      typeof countdownSeconds === "number" && Number.isFinite(countdownSeconds);
    if (
      topic === "next_game_countdown" &&
      payload.sourceRole !== "player" &&
      hasCountdownSeconds &&
      countdownSeconds >= 1 &&
      countdownSeconds <= 10
    ) {
      audioService.playSfx("click");
    }
    const sourcePlayerId = this.resolveRealtimeSourcePlayerId(payload);
    const tone =
      payload.severity === "success" ||
      payload.severity === "warning" ||
      payload.severity === "error"
        ? payload.severity
        : "info";

    if (sourcePlayerId && sourcePlayerId !== this.localPlayerId) {
      this.showSeatBubbleForPlayer(sourcePlayerId, message, {
        tone,
        durationMs: channel === "direct" ? 3600 : 2600,
        isBot: payload.bot === true,
      });
    }

    const fallbackTitle = channel === "direct" ? "Direct" : "Room";
    const title = typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : fallbackTitle;
    const durationMs = topic === "next_game_countdown" ? 1400 : channel === "direct" ? 3600 : 2600;
    notificationService.show(`${title}: ${message}`, tone, durationMs);
  }

  private handleMultiplayerSessionState(message: MultiplayerSessionStateMessage): void {
    const previousSession = this.multiplayerSessionService.getActiveSession();
    if (!previousSession) {
      return;
    }
    if (message.sessionId !== previousSession.sessionId) {
      return;
    }
    this.applyMultiplayerClockFromServer(message);

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
      ...(typeof message.gameStartedAt === "number" && Number.isFinite(message.gameStartedAt)
        ? { gameStartedAt: message.gameStartedAt }
        : {}),
      ...(typeof message.nextGameStartsAt === "number" && Number.isFinite(message.nextGameStartsAt)
        ? { nextGameStartsAt: message.nextGameStartsAt }
        : {}),
      ...(typeof message.nextGameAutoStartDelayMs === "number" &&
      Number.isFinite(message.nextGameAutoStartDelayMs)
        ? { nextGameAutoStartDelayMs: message.nextGameAutoStartDelayMs }
        : {}),
      ...(typeof message.expiresAt === "number" && Number.isFinite(message.expiresAt)
        ? { expiresAt: message.expiresAt }
        : {}),
      ...(typeof message.serverNow === "number" && Number.isFinite(message.serverNow)
        ? { serverNow: message.serverNow }
        : {}),
    });
    if (!syncedSession) {
      return;
    }

    this.applyMultiplayerDifficultyIfPresent(syncedSession.gameDifficulty);
    this.touchMultiplayerTurnSyncActivity();
    if (this.shouldResetLocalStateForNextMultiplayerGame(previousSession, syncedSession)) {
      this.resetLocalStateForNextMultiplayerGame();
    }
    this.applyMultiplayerSeatState(syncedSession);
    if (syncedSession.sessionComplete === true && !this.lastSessionComplete) {
      this.lastSessionComplete = true;
      this.scene.triggerVictoryLighting(3200);
      const winnerPlayerId =
        Array.isArray(syncedSession.standings) && syncedSession.standings.length > 0
          ? syncedSession.standings[0]?.playerId
          : null;
      const winnerLabel =
        typeof winnerPlayerId === "string" && winnerPlayerId.length > 0
          ? this.getParticipantLabel(winnerPlayerId)
          : "Winner";
      notificationService.show(`${winnerLabel} wins the round.`, "success", 2800);
    } else if (syncedSession.sessionComplete !== true) {
      this.lastSessionComplete = false;
    }
  }

  private handleMultiplayerTurnStart(message: MultiplayerTurnStartMessage): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    this.clearSelectionSyncDebounce();
    this.applyMultiplayerClockFromServer(message);
    this.touchMultiplayerTurnSyncActivity();
    this.clearPendingTurnTransitionSyncRecovery();
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
    this.updateUI();

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

    this.clearSelectionSyncDebounce();
    this.syncServerClockOffset(message.timestamp);
    this.touchMultiplayerTurnSyncActivity();
    const previousActiveTurnPlayerId = this.activeTurnPlayerId;
    this.pendingTurnEndSync = false;
    this.applyTurnTiming(null);
    this.hud.setMultiplayerActiveTurn(null);
    const endedPlayerId = typeof message.playerId === "string" ? message.playerId : "";
    if (!endedPlayerId) {
      this.activeTurnPlayerId = null;
      this.activeRollServerId = null;
      this.updateTurnSeatHighlight(null);
      this.scheduleTurnTransitionSyncRecovery("turn_end_missing_player");
      this.updateUI();
      return;
    }
    if (!previousActiveTurnPlayerId || previousActiveTurnPlayerId === endedPlayerId) {
      this.activeTurnPlayerId = null;
      this.activeRollServerId = null;
      this.updateTurnSeatHighlight(null);
      this.scheduleTurnTransitionSyncRecovery("turn_end_waiting_for_next", endedPlayerId);
    }
    this.updateUI();

    if (endedPlayerId === this.localPlayerId) {
      notificationService.show("Turn ended", "info", 1200);
      return;
    }

    this.clearSpectatorRollingPreviewForPlayer(endedPlayerId);

    this.showSeatBubbleForPlayer(endedPlayerId, "Turn ended", {
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

    this.syncServerClockOffset(message.timestamp);
    this.touchMultiplayerTurnSyncActivity();
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

    this.clearSelectionSyncDebounce();
    this.syncServerClockOffset(message.timestamp);
    this.touchMultiplayerTurnSyncActivity();
    this.applyTurnTiming(null);
    const playerId = typeof message.playerId === "string" ? message.playerId : "";
    if (!playerId) {
      this.activeTurnPlayerId = null;
      this.activeRollServerId = null;
      this.updateTurnSeatHighlight(null);
      this.scheduleTurnTransitionSyncRecovery("turn_auto_advanced_missing_player");
      this.updateUI();
      return;
    }
    if (this.activeTurnPlayerId === playerId) {
      this.activeTurnPlayerId = null;
      this.activeRollServerId = null;
      this.updateTurnSeatHighlight(null);
      this.scheduleTurnTransitionSyncRecovery("turn_auto_advanced_waiting_for_next", playerId);
    }
    this.clearSpectatorRollingPreviewForPlayer(playerId);
    this.showSeatBubbleForPlayer(playerId, "Turn timed out", {
      tone: "warning",
      durationMs: 2000,
    });
    this.updateUI();
  }

  private handleMultiplayerTurnAction(message: MultiplayerTurnActionMessage): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    this.syncServerClockOffset(message.timestamp);
    this.touchMultiplayerTurnSyncActivity();
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

    if (message.action === "select") {
      const selection = Array.isArray(message.select?.selectedDiceIds)
        ? message.select?.selectedDiceIds ?? []
        : [];
      const selectedDiceIds = selection.filter(
        (dieId): dieId is string => typeof dieId === "string" && dieId.trim().length > 0
      );
      this.diceRenderer.updateSpectatorSelectionPreview(spectatorPreviewKey, selectedDiceIds);
      return;
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
      this.clearSpectatorRollingPreviewForPlayer(message.playerId);
    }

    const actionLabel = message.action === "score" ? "Scored" : "Rolled";
    const scoredPoints =
      message.action === "score" &&
      typeof message.score?.points === "number" &&
      Number.isFinite(message.score.points)
        ? Math.max(0, Math.floor(message.score.points))
        : null;
    const scoreSuffix = scoredPoints !== null ? ` (+${scoredPoints})` : "";
    this.showSeatBubbleForPlayer(message.playerId, `${actionLabel}${scoreSuffix}`, {
      tone:
        message.action === "score"
          ? resolveScoreFeedbackTone(scoredPoints ?? 0)
          : "info",
      durationMs: 1400,
    });
  }

  private handleMultiplayerProtocolError(code: string, message?: string): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    if (code === "room_channel_sender_restricted") {
      notificationService.show("Room chat is restricted for this player.", "warning", 2200);
      return;
    }

    if (code === "room_channel_message_blocked") {
      notificationService.show("Message blocked by room moderation.", "warning", 2200);
      return;
    }

    if (code === "room_channel_blocked") {
      notificationService.show("Message blocked by player privacy settings.", "warning", 2200);
      return;
    }

    if (code === "room_channel_invalid_message") {
      notificationService.show("Message is empty or invalid.", "warning", 1800);
      return;
    }

    if (code === "turn_not_active") {
      this.awaitingMultiplayerRoll = false;
      void this.requestTurnSyncRefresh("turn_not_active");
      return;
    }

    if (code === "turn_unavailable" || code === "turn_advance_failed") {
      this.awaitingMultiplayerRoll = false;
      this.pendingTurnEndSync = false;
      notificationService.show("Turn state unavailable. Resyncing...", "warning", 2000);
      void this.requestTurnSyncRefresh(code);
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
      void this.requestTurnSyncRefresh("turn_action_invalid_phase");
      return;
    }

    if (code === "turn_action_invalid_score") {
      notificationService.show("Score validation failed. Re-roll this turn.", "warning", 2200);
      return;
    }

    if (code === "turn_action_invalid_payload") {
      this.awaitingMultiplayerRoll = false;
      notificationService.show("Turn payload rejected. Syncing...", "warning", 2200);
      void this.requestTurnSyncRefresh("turn_action_invalid_payload");
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
        participant.isSeated !== false &&
        participant.queuedForNextGame !== true &&
        participant.isComplete !== true
    );
  }

  private getUnreadySeatedHumanParticipants(): string[] {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants
      .filter(
        (participant) =>
          participant &&
          !participant.isBot &&
          participant.isSeated !== false &&
          participant.queuedForNextGame !== true &&
          participant.isComplete !== true &&
          participant.isReady !== true
      )
      .map((participant) => participant.playerId);
  }

  private hasActiveBotOpponent(): boolean {
    const participants = this.multiplayerSessionService.getActiveSession()?.participants ?? [];
    return participants.some(
      (participant) =>
        participant &&
        participant.playerId !== this.localPlayerId &&
        participant.isBot === true &&
        participant.isSeated !== false &&
        participant.queuedForNextGame !== true &&
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

    const localSeatState = this.getLocalMultiplayerSeatState();
    if (localSeatState && !localSeatState.isSeated) {
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

    const pendingReadyPlayers = this.getUnreadySeatedHumanParticipants();
    if (!this.activeTurnPlayerId) {
      if (pendingReadyPlayers.length > 0) {
        const previewNames = pendingReadyPlayers
          .slice(0, 2)
          .map((playerId) => this.getParticipantLabel(playerId));
        const remainingCount = pendingReadyPlayers.length - previewNames.length;
        const waitingOn =
          remainingCount > 0
            ? `${previewNames.join(", ")} +${remainingCount}`
            : previewNames.join(", ");
        this.hud.setTurnSyncStatus("ok", "Waiting For Ready");
        notificationService.show(
          waitingOn
            ? `Waiting for players to ready up: ${waitingOn}.`
            : "Waiting for players to ready up.",
          "info",
          1800
        );
        return false;
      }
      if (this.shouldRecoverTurnSyncForBlockedAction()) {
        void this.requestTurnSyncRefresh("local_action_missing_active_turn");
      }
      notificationService.show("Waiting for turn sync...", "warning", 1600);
      return false;
    }

    if (!this.isLocalPlayersTurn()) {
      if (this.shouldRecoverTurnSyncForBlockedAction()) {
        void this.requestTurnSyncRefresh("local_action_waiting_remote_turn");
      }
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

  private shouldRecoverTurnSyncForBlockedAction(): boolean {
    if (!this.isMultiplayerTurnEnforced()) {
      return false;
    }
    if (!this.multiplayerNetwork?.isConnected()) {
      return false;
    }

    const now = Date.now();
    const staleSinceActivity = now - this.lastTurnSyncActivityAt;
    if (staleSinceActivity >= TURN_SYNC_STALE_RECOVERY_MS) {
      return true;
    }

    const deadlinePassed =
      typeof this.activeTurnDeadlineAt === "number" &&
      Number.isFinite(this.activeTurnDeadlineAt) &&
      this.activeTurnDeadlineAt > 0 &&
      now > this.activeTurnDeadlineAt + 600;
    if (deadlinePassed) {
      return true;
    }

    if (!this.activeTurnPlayerId) {
      return true;
    }

    return this.isBotParticipant(this.activeTurnPlayerId) && staleSinceActivity >= 1800;
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

    this.clearSelectionSyncDebounce();
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
      return;
    }
    this.touchMultiplayerTurnSyncActivity();
  }

  private emitTurnAction(
    action: "roll" | "score" | "select",
    details?: Pick<MultiplayerTurnActionMessage, "roll" | "score" | "select">,
    options?: { suppressFailureNotice?: boolean }
  ): boolean {
    if (!this.isMultiplayerTurnEnforced()) {
      return true;
    }

    if (!this.multiplayerNetwork?.isConnected()) {
      if (!options?.suppressFailureNotice) {
        notificationService.show(
          `Unable to ${action} while disconnected.`,
          "warning",
          1800
        );
      }
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
      if (!options?.suppressFailureNotice) {
        notificationService.show(`Failed to sync ${action} action.`, "warning", 1800);
      }
      return false;
    }

    this.touchMultiplayerTurnSyncActivity();
    return true;
  }

  private clearSelectionSyncDebounce(): void {
    if (this.selectionSyncDebounceHandle) {
      clearTimeout(this.selectionSyncDebounceHandle);
      this.selectionSyncDebounceHandle = null;
    }
    this.selectionSyncRollServerId = null;
  }

  private scheduleSelectionSyncDebounced(): void {
    if (!this.isMultiplayerTurnEnforced() || !this.activeRollServerId) {
      return;
    }

    this.selectionSyncRollServerId = this.activeRollServerId;
    if (this.selectionSyncDebounceHandle) {
      clearTimeout(this.selectionSyncDebounceHandle);
    }
    this.selectionSyncDebounceHandle = window.setTimeout(() => {
      this.selectionSyncDebounceHandle = null;
      this.flushSelectionSyncDebounced();
    }, TURN_SELECTION_SYNC_DEBOUNCE_MS);
  }

  private flushSelectionSyncDebounced(): void {
    const rollServerId = this.selectionSyncRollServerId ?? this.activeRollServerId;
    this.selectionSyncRollServerId = null;
    if (!this.isMultiplayerTurnEnforced() || !rollServerId || this.state.status !== "ROLLED") {
      return;
    }

    const selectPayload = this.buildSelectTurnPayload(this.state.selected, rollServerId);
    this.emitTurnAction("select", { select: selectPayload }, { suppressFailureNotice: true });
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
    }, undefined, {
      seed: typeof roll.serverRollId === "string" && roll.serverRollId.trim().length > 0
        ? roll.serverRollId.trim()
        : `roll-${rollIndex}`,
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

  private buildSelectTurnPayload(
    selected: Set<string>,
    rollServerId: string
  ): {
    selectedDiceIds: string[];
    rollServerId: string;
  } {
    return {
      selectedDiceIds: [...selected],
      rollServerId,
    };
  }

  private normalizeInviteRoomCode(rawValue: string | null | undefined): string {
    if (typeof rawValue !== "string") {
      return "";
    }
    return rawValue.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
  }

  private updateSessionQueryParam(sessionId: string, roomCode?: string): void {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("session", sessionId);
    const normalizedRoomCode = this.normalizeInviteRoomCode(roomCode);
    if (normalizedRoomCode) {
      currentUrl.searchParams.set("room", normalizedRoomCode);
    } else {
      currentUrl.searchParams.delete("room");
    }
    window.history.replaceState(window.history.state, "", currentUrl.toString());
  }

  private clearSessionQueryParam(): void {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.delete("session");
    currentUrl.searchParams.delete("room");
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
    this.clearSelectionSyncDebounce();
    this.stopTurnSyncWatchdog();
    this.stopBotMemeAvatarRotation();
    this.botMemeAvatarByPlayerId.clear();
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
    this.hud.setTurnSyncStatus(null);
    playerDataSyncService.setSessionId(undefined);
    this.clearSessionQueryParam();
    this.applySoloSeatState();
    this.updateInviteLinkControlVisibility();
    this.updateUI();
    notificationService.show("Continuing in solo mode.", "info", 2200);
  }

  private async returnToLobby(): Promise<void> {
    if (this.lobbyRedirectInProgress) {
      return;
    }
    this.clearSelectionSyncDebounce();
    this.lobbyRedirectInProgress = true;
    this.sessionExpiryPromptActive = false;
    try {
      await this.multiplayerSessionService.leaveSession();
    } catch (error) {
      log.warn("Failed to leave multiplayer session during lobby return", error);
    }

    this.multiplayerNetwork?.dispose();
    this.multiplayerNetwork = undefined;
    this.stopTurnSyncWatchdog();
    this.stopBotMemeAvatarRotation();
    this.botMemeAvatarByPlayerId.clear();
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
    this.hud.setTurnSyncStatus(null);
    this.hud.setRoundCountdownDeadline(null);
    playerDataSyncService.setSessionId(undefined);
    this.clearSessionQueryParam();
    this.updateInviteLinkControlVisibility();

    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.delete("session");
    redirectUrl.searchParams.delete("room");
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

  private async copySessionInviteLink(sessionId: string, roomCode?: string): Promise<void> {
    if (typeof window === "undefined" || !window.navigator?.clipboard?.writeText) {
      notificationService.show("Clipboard access unavailable on this device.", "warning", 2200);
      return;
    }

    try {
      const inviteUrl = new URL(window.location.href);
      inviteUrl.searchParams.set("session", sessionId);
      const normalizedRoomCode = this.normalizeInviteRoomCode(roomCode);
      if (normalizedRoomCode) {
        inviteUrl.searchParams.set("room", normalizedRoomCode);
      } else {
        inviteUrl.searchParams.delete("room");
      }
      await window.navigator.clipboard.writeText(inviteUrl.toString());
      notificationService.show("Invite link copied to clipboard.", "info", 1800);
    } catch {
      notificationService.show("Unable to copy invite link.", "warning", 2200);
    }
  }

  private updateInviteLinkControlVisibility(): void {
    const showInviteControl =
      this.playMode === "multiplayer" &&
      typeof this.multiplayerSessionService.getActiveSession()?.sessionId === "string";
    if (this.inviteLinkBtn) {
      this.inviteLinkBtn.style.display = showInviteControl ? "flex" : "none";
    }
    if (this.mobileInviteLinkBtn) {
      this.mobileInviteLinkBtn.style.display = showInviteControl ? "flex" : "none";
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

  canManualNewGame(): boolean {
    if (this.playMode !== "multiplayer") {
      return true;
    }
    return !this.multiplayerSessionService.getActiveSession();
  }

  getSelectedDieIndex(): number {
    return this.selectedDieIndex;
  }

  setSelectedDieIndex(index: number): void {
    this.selectedDieIndex = index;
  }

  focusCameraOnDie(dieId: string): void {
    if (this.state.status !== "ROLLED") {
      return;
    }
    const mesh = this.diceRenderer.getMesh(dieId);
    if (!mesh) {
      return;
    }
    const focusTarget = mesh.getAbsolutePosition().clone();
    this.scene.focusCameraOnWorldPointTopDown(focusTarget, true);
  }

  canCyclePlayerFocus(): boolean {
    if (!this.isWaitingForRemoteTurn()) {
      return false;
    }
    return this.getCyclableRemoteSeatIndices().length > 0;
  }

  cyclePlayerFocus(direction: 1 | -1): void {
    const seatIndices = this.getCyclableRemoteSeatIndices();
    if (seatIndices.length === 0) {
      return;
    }

    let currentCursor = seatIndices.indexOf(this.selectedSeatFocusIndex);
    if (currentCursor === -1) {
      const activeSeatIndex = this.getActiveTurnSeatIndex();
      if (typeof activeSeatIndex === "number") {
        const activeCursor = seatIndices.indexOf(activeSeatIndex);
        currentCursor = activeCursor >= 0 ? activeCursor : direction > 0 ? -1 : 0;
      } else {
        currentCursor = direction > 0 ? -1 : 0;
      }
    }

    const nextCursor = (currentCursor + direction + seatIndices.length) % seatIndices.length;
    const seatIndex = seatIndices[nextCursor];
    this.selectedSeatFocusIndex = seatIndex;
    this.focusCameraOnSeat(seatIndex);
  }

  openMultiplayerPublicMessageComposer(): void {
    if (!this.canComposeRoomChannelMessage()) {
      return;
    }
    const message = this.normalizeComposedRoomChannelMessage(
      window.prompt("Send a room message:", "")
    );
    if (!message) {
      return;
    }

    const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
    const sent = this.sendPlayerRoomChannelMessage({
      idPrefix: "chat-public",
      channel: "public",
      topic: "chat",
      title: sourceLabel,
      message,
      severity: "info",
    });

    if (!sent) {
      notificationService.show("Unable to send room message.", "warning", 1800);
      return;
    }
    notificationService.show("Room message sent.", "success", 1200);
  }

  openMultiplayerWhisperComposer(): void {
    if (!this.canComposeRoomChannelMessage()) {
      return;
    }
    const whisperTargets = this.getWhisperTargets();
    if (whisperTargets.length === 0) {
      notificationService.show("No player available to whisper.", "info", 1800);
      return;
    }

    const targetPrompt = whisperTargets
      .map((target, index) => `${index + 1}. ${target.label}`)
      .join("\n");
    const targetInput = window.prompt(
      `Whisper target:\n${targetPrompt}\nType number, player name, or player id.`,
      ""
    );
    if (typeof targetInput !== "string") {
      return;
    }
    const targetPlayerId = this.resolveWhisperTargetPlayerId(targetInput);
    if (!targetPlayerId) {
      notificationService.show("Whisper target not recognized.", "warning", 2000);
      return;
    }
    const targetLabel = this.getParticipantBroadcastLabel(targetPlayerId);
    const message = this.normalizeComposedRoomChannelMessage(
      window.prompt(`Whisper to ${targetLabel}:`, "")
    );
    if (!message) {
      return;
    }

    const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
    const sent = this.sendPlayerRoomChannelMessage({
      idPrefix: `chat-whisper-${targetPlayerId}`,
      channel: "direct",
      topic: "whisper",
      title: `Whisper from ${sourceLabel}`,
      message,
      severity: "info",
      targetPlayerId,
    });

    if (!sent) {
      notificationService.show("Unable to send whisper.", "warning", 1800);
      return;
    }
    notificationService.show(`Whisper sent to ${targetLabel}.`, "success", 1400);
  }

  private focusCameraOnSeat(seatIndex: number): void {
    const headAnchor = this.scene.playerSeatRenderer.getSeatHeadAnchorPosition(seatIndex);
    if (headAnchor) {
      this.scene.focusCameraOnPlayerSeat(headAnchor, true);
      return;
    }

    const seat = this.scene.playerSeats[seatIndex];
    if (!seat) {
      return;
    }
    this.scene.focusCameraOnPlayerSeat(seat.position.clone(), true);
  }

  private getCyclableRemoteSeatIndices(): number[] {
    const remoteSeats = Array.from(this.participantIdBySeat.entries())
      .filter(([, playerId]) => playerId !== this.localPlayerId)
      .map(([seatIndex]) => seatIndex)
      .sort((left, right) => left - right);
    if (remoteSeats.length > 0) {
      return remoteSeats;
    }

    const activeSeat = this.getActiveTurnSeatIndex();
    if (typeof activeSeat === "number" && activeSeat !== this.scene.currentPlayerSeat) {
      return [activeSeat];
    }
    return [];
  }

  private getActiveTurnSeatIndex(): number | null {
    if (!this.activeTurnPlayerId) {
      return null;
    }
    const seatIndex = this.participantSeatById.get(this.activeTurnPlayerId);
    return typeof seatIndex === "number" ? seatIndex : null;
  }

  private isWaitingForRemoteTurn(): boolean {
    return this.isMultiplayerTurnEnforced() && (!this.activeTurnPlayerId || !this.isLocalPlayersTurn());
  }

  private isCameraAssistEnabledForCurrentMode(): boolean {
    const settings = settingsService.getSettings();
    return settings.game.difficulty === "easy" && settings.game.cameraAssistEnabled !== false;
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
    this.settingsModal.show({ preserveOpenModalIds: ["tutorial-modal"] });
    this.settingsModal.showTab(tab);
    this.updateUI();
  }

  togglePause(): void {
    this.paused = !this.paused;

    if (this.paused) {
      notificationService.show("Paused", "info");
      const tutorialActive = tutorialModal.isActive();
      this.settingsModal.show({
        preserveOpenModalIds: tutorialActive ? ["tutorial-modal"] : undefined,
      });
      if (tutorialActive) {
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
        const keyboardHint = this.canManualNewGame()
          ? "← → or +/- to cycle focus, Enter to select die, X to deselect | N=New Game, D=Debug"
          : "← → or +/- to cycle focus, Enter to select die, X to deselect | D=Debug";
        notificationService.show(
          keyboardHint,
          "info"
        );
        sessionStorage.setItem("keyboardHintShown", "true");
      }
    }
  }

  private async handleModeChange(difficulty: GameDifficulty): Promise<void> {
    if (!this.canManualNewGame()) {
      notificationService.show(
        "Difficulty changes are disabled while in a multiplayer room.",
        "warning",
        2400
      );
      this.updateUI();
      return;
    }

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
      this.resetLocalGameClockStart();
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
    const turnActionBannerEl = document.getElementById("turn-action-banner");
    const controlsEl = document.getElementById("controls");
    const cameraControlsEl = document.getElementById("camera-controls");
    const effectHudEl = document.getElementById("effect-hud");

    if (isDebugMode) {
      // Hide game UI
      if (hudEl) hudEl.style.display = "none";
      if (diceRowEl) diceRowEl.style.display = "none";
      if (turnActionBannerEl) turnActionBannerEl.style.display = "none";
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
      if (turnActionBannerEl) turnActionBannerEl.style.display = "";
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
        this.scheduleSelectionSyncDebounced();
        if (this.state.selected.has(dieId) && this.isCameraAssistEnabledForCurrentMode()) {
          this.focusCameraOnDie(dieId);
        }

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
      this.gameOverController.showGameOver(this.state, this.gameStartTime, {
        showWaitForNextGame: this.shouldShowWaitForNextGameAction(),
      });
    }
  }

  handleAction(): void {
    if (this.paused || this.animating) return;

    if (this.playMode === "multiplayer") {
      const localSeatState = this.getLocalMultiplayerSeatState();
      if (localSeatState && localSeatState.isSeated && !localSeatState.isReady) {
        void this.updateLocalParticipantState("ready");
        return;
      }
    }

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

    this.scheduleSelectionSyncDebounced();

    notificationService.show("Deselected All", "info");
  }

  handleCopyInviteLink(): void {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (this.playMode !== "multiplayer" || !activeSession?.sessionId) {
      notificationService.show("Start or join a multiplayer room to copy an invite link.", "warning", 2400);
      return;
    }
    void this.copySessionInviteLink(activeSession.sessionId, activeSession.roomCode);
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
    this.clearSelectionSyncDebounce();
    this.activeRollServerId = null;
    const rollPayload = this.buildRollTurnPayload();
    if (!this.emitTurnAction("roll", { roll: rollPayload })) {
      return;
    }

    // Rolling should always reset any temporary die/player focus camera back to gameplay overview.
    this.scene.returnCameraToDefaultOverview(true);

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
    const activePlayableBeforeScore = this.getActivePlayableDiceCount();
    const selectedCount = selected.size;

    // Calculate points for notification
    const scoredDice = this.state.dice.filter((d) => selected.has(d.id));
    const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
    if (this.isMultiplayerTurnEnforced()) {
      if (!this.activeRollServerId) {
        notificationService.show("Waiting for roll sync before scoring.", "warning", 1800);
        return;
      }

      this.clearSelectionSyncDebounce();
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
      if (this.isCameraAssistEnabledForCurrentMode()) {
        this.scene.returnCameraToDefaultOverview(true);
      }

      // Show score notification
      if (points === 0) {
        notificationService.show("🎉 Perfect Roll! +0", "success");
        // Celebrate perfect roll with particles
        this.scene.celebrateSuccess("perfect");
      } else {
        notificationService.show(`+${points}`, resolveScoreFeedbackTone(points));
      }
    }, localSeatScoreZone
      ? new Vector3(localSeatScoreZone.x, localSeatScoreZone.y, localSeatScoreZone.z)
      : undefined);

    this.dispatch({ t: "SCORE_SELECTED" });
    const completedAllDiceThisScore =
      activePlayableBeforeScore > 0 && selectedCount >= activePlayableBeforeScore;
    const shouldEmitTurnEnd = !(
      this.isMultiplayerTurnEnforced() && completedAllDiceThisScore
    );
    if (shouldEmitTurnEnd) {
      this.emitTurnEnd();
    }

    // Notify tutorial of score action
    if (tutorialModal.isActive()) {
      tutorialModal.onPlayerAction('score');
    }
  }

  handleNewGame(): void {
    if (!this.canManualNewGame()) {
      notificationService.show(
        "Multiplayer game starts are server-controlled.",
        "warning",
        2200
      );
      return;
    }
    this.gameOverController.hide();
    this.state = GameFlowController.createNewGame();
    GameFlowController.resetForNewGame(this.diceRenderer);
    this.animating = false;
    this.resetLocalGameClockStart();
    this.applyTurnTiming(null);
    this.updateUI();
    notificationService.show("New Game!", "success");
  }

  handleWaitForNextGame(): void {
    if (this.playMode !== "multiplayer") {
      notificationService.show("Wait queue is available in multiplayer rooms only.", "warning", 2000);
      return;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId) {
      notificationService.show("No active multiplayer room found.", "warning", 2000);
      return;
    }
    if (this.waitForNextGameRequestInFlight) {
      return;
    }
    void this.queueForNextMultiplayerGame();
  }

  handleReturnToMainMenu(): void {
    void this.returnToLobby();
  }

  startNewGame(): void {
    if (!this.canManualNewGame()) {
      notificationService.show(
        "Multiplayer game starts are server-controlled.",
        "warning",
        2200
      );
      return;
    }

    // Unpause if paused
    if (this.paused) {
      this.paused = false;
    }

    this.gameOverController.hide();
    this.state = GameFlowController.createNewGame();
    GameFlowController.updateHintMode(this.state, this.diceRow);
    GameFlowController.resetForNewGame(this.diceRenderer);
    this.animating = false;
    this.resetLocalGameClockStart();
    this.applyTurnTiming(null);
    this.updateUI();
    notificationService.show("New Game Started!", "success");
  }

  private ensureTurnActionBanner(): HTMLElement | null {
    const existing = document.getElementById("turn-action-banner");
    if (existing) {
      return existing;
    }

    const unifiedHud = document.getElementById("unified-hud");
    if (!unifiedHud) {
      return null;
    }

    const banner = document.createElement("div");
    banner.id = "turn-action-banner";
    banner.className = "turn-action-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-atomic", "true");

    const diceRowEl = document.getElementById("dice-row");
    if (diceRowEl) {
      unifiedHud.insertBefore(banner, diceRowEl);
    } else {
      unifiedHud.appendChild(banner);
    }

    return banner;
  }

  private getActivePlayableDiceCount(): number {
    return this.state.dice.filter((die) => die.inPlay && !die.scored && die.value > 0).length;
  }

  private shouldShowDiceRowForCurrentTurn(activePlayableDiceCount: number): boolean {
    if (activePlayableDiceCount <= 0) {
      return false;
    }

    if (!this.isMultiplayerTurnEnforced()) {
      return true;
    }

    if (!this.isLocalPlayersTurn()) {
      return false;
    }

    return this.state.status === "ROLLED";
  }

  private updateTurnActionBanner(isDiceRowVisible: boolean): void {
    const bannerEl = this.turnActionBannerEl;
    if (!bannerEl) {
      return;
    }

    const hideBanner = () => {
      bannerEl.classList.remove("is-visible", "is-urgent");
      bannerEl.removeAttribute("data-tone");
      bannerEl.textContent = "";
    };

    if (!this.isMultiplayerTurnEnforced() || this.state.status === "COMPLETE") {
      hideBanner();
      return;
    }

    let message = "";
    let tone: "waiting" | "action" | "sync" | "info" = "info";
    let urgent = false;

    if (!this.activeTurnPlayerId) {
      message = "Syncing turn state...";
      tone = "sync";
    } else if (!this.isLocalPlayersTurn()) {
      message = `${this.getParticipantLabel(this.activeTurnPlayerId)} is taking their turn`;
      tone = "waiting";
    } else if (this.awaitingMultiplayerRoll) {
      message = "Rolling... waiting for server sync";
      tone = "sync";
    } else if (this.state.status === "READY") {
      message = "Your turn: Roll dice";
      tone = "action";
      urgent = true;
    } else if (this.state.status === "ROLLED" && !isDiceRowVisible) {
      const selectedCount = this.state.selected.size;
      message =
        selectedCount > 0
          ? `Your turn: score ${selectedCount} die${selectedCount === 1 ? "" : "s"}`
          : "Your turn: Select dice to score";
      tone = "action";
      urgent = true;
    } else {
      hideBanner();
      return;
    }

    bannerEl.textContent = message;
    bannerEl.dataset.tone = tone;
    bannerEl.classList.add("is-visible");
    bannerEl.classList.toggle("is-urgent", urgent);
  }

  private getUndoCountForCurrentRoll(): number {
    let scoreActionsInCurrentRoll = 0;
    for (let index = this.state.actionLog.length - 1; index >= 0; index -= 1) {
      const action = this.state.actionLog[index];
      if (action.t === "SCORE_SELECTED") {
        scoreActionsInCurrentRoll += 1;
        continue;
      }
      if (action.t === "ROLL") {
        break;
      }
    }
    return scoreActionsInCurrentRoll;
  }

  private updateUI(): void {
    this.updateInviteLinkControlVisibility();
    this.hud.update(this.state);
    this.scene.playerSeatRenderer.updateSeat(this.scene.currentPlayerSeat, {
      score: this.state.score,
    });
    this.diceRow.update(this.state);
    const diceRowEl = document.getElementById("dice-row");
    const activePlayableDiceCount = this.getActivePlayableDiceCount();
    const shouldShowDiceRow = this.shouldShowDiceRowForCurrentTurn(activePlayableDiceCount);
    if (diceRowEl) {
      diceRowEl.style.display = shouldShowDiceRow ? "flex" : "none";
    }
    this.updateTurnActionBanner(shouldShowDiceRow);
    const isTurnLocked =
      this.isMultiplayerTurnEnforced() &&
      (!this.activeTurnPlayerId || !this.isLocalPlayersTurn());
    const manualNewGameEnabled = this.canManualNewGame();
    if (this.newGameBtn) {
      this.newGameBtn.disabled = !manualNewGameEnabled;
      this.newGameBtn.title = manualNewGameEnabled
        ? "Start a new game"
        : "Multiplayer game starts are server-controlled";
    }
    if (this.waitNextGameBtn) {
      const showWaitAction = this.shouldShowWaitForNextGameAction();
      this.waitNextGameBtn.style.display = showWaitAction ? "inline-flex" : "none";
      this.waitNextGameBtn.disabled = this.waitForNextGameRequestInFlight;
      this.waitNextGameBtn.textContent = this.waitForNextGameRequestInFlight
        ? "Joining Queue..."
        : "Wait for Next Game";
    }

    const localSeatState = this.getLocalMultiplayerSeatState();
    const needsReadyAction =
      this.playMode === "multiplayer" &&
      localSeatState !== null &&
      localSeatState.isSeated &&
      !localSeatState.isReady;
    const hasSelection = this.state.selected.size > 0;

    // Update multipurpose action button
    if (needsReadyAction) {
      this.actionBtn.textContent = "Ready Up";
      this.actionBtn.disabled = this.animating || this.paused || this.participantStateUpdateInFlight;
      this.actionBtn.className = "btn btn-primary primary";
    } else if (this.state.status === "READY") {
      this.actionBtn.textContent = isTurnLocked
        ? `Waiting: ${this.activeTurnPlayerId ? this.getParticipantLabel(this.activeTurnPlayerId) : "Sync"}`
        : "Roll";
      this.actionBtn.disabled = this.animating || this.paused || isTurnLocked;
      this.actionBtn.className = "btn btn-primary primary";
    } else if (this.state.status === "ROLLED") {
      if (hasSelection) {
        // Calculate points for button text
        const scoredDice = this.state.dice.filter((d) => this.state.selected.has(d.id));
        const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
        this.actionBtn.textContent = isTurnLocked
          ? `Waiting: ${this.activeTurnPlayerId ? this.getParticipantLabel(this.activeTurnPlayerId) : "Sync"}`
          : `Score +${points} (Space)`;
        this.actionBtn.disabled = this.animating || this.paused || isTurnLocked;
        this.actionBtn.className = "btn btn-primary primary";
      } else {
        this.actionBtn.textContent = isTurnLocked
          ? `Waiting: ${this.activeTurnPlayerId ? this.getParticipantLabel(this.activeTurnPlayerId) : "Sync"}`
          : "Select Dice to Score";
        this.actionBtn.disabled = true;
        this.actionBtn.className = "btn btn-secondary secondary";
      }
    } else {
      this.actionBtn.disabled = true;
    }

    // Deselect badge is anchored to the action button so layout remains stable.
    const showDeselectBadge =
      this.state.status === "ROLLED" &&
      hasSelection &&
      !isTurnLocked;
    if (showDeselectBadge) {
      const deselectTooltip = t("shell.controls.deselectAll");
      this.deselectBtn.style.display = "inline-flex";
      this.deselectBtn.disabled = this.animating || this.paused;
      this.deselectBtn.title = deselectTooltip;
      this.deselectBtn.setAttribute("aria-label", deselectTooltip);
      this.deselectBtn.dataset.tooltip = deselectTooltip;
    } else {
      this.deselectBtn.style.display = "none";
      this.deselectBtn.removeAttribute("data-tooltip");
    }

    // Update undo badge (Easy mode only). The badge is anchored on the action button
    // so the action tap target never shifts when undo availability changes.
    const undoCount = this.getUndoCountForCurrentRoll();
    const showUndoBadge =
      isUndoAllowed(this.state.mode) &&
      undoCount > 0 &&
      canUndo(this.state) &&
      (this.state.status === "READY" || this.state.status === "ROLLED");

    if (showUndoBadge) {
      const undoTooltip = t("shell.controls.undoBadgeTooltip", { count: String(undoCount) });
      this.undoBtn.style.display = "inline-flex";
      this.undoBtn.disabled = this.animating || this.paused;
      this.undoBtn.title = undoTooltip;
      this.undoBtn.setAttribute("aria-label", undoTooltip);
      this.undoBtn.dataset.tooltip = undoTooltip;
    } else {
      this.undoBtn.style.display = "none";
      this.undoBtn.removeAttribute("data-tooltip");
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
