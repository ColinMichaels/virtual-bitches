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
import {
  PlayerInteractionsPanel,
  type PlayerInteractionParticipant,
  type PlayerInteractionProfileData,
} from "./ui/playerInteractions.js";
import {
  MultiplayerChatPanel,
  type MultiplayerChatParticipant,
} from "./ui/multiplayerChatPanel.js";
import { confirmAction } from "./ui/confirmModal.js";
import { notificationService } from "./ui/notifications.js";
import {
  showDebugAuditNotification,
  showGameplayThemedNotification,
} from "./ui/notificationThemes.js";
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
import { buildCameraAttackMessageFromProgression } from "./chaos/upgrades/executionProfile.js";
import type { CameraAbilityId } from "./chaos/upgrades/types.js";
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
  type MultiplayerModerationAction,
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
import { buildUnifiedGameConfig, type UnifiedGameCreateConfig } from "./gameplay/gameConfig.js";
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
  autoSeatReady?: boolean;
  demoSpeedMode?: boolean;
}

interface GameSessionBootstrapOptions {
  playMode: GamePlayMode;
  gameConfig?: UnifiedGameCreateConfig;
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
const PLAYER_INTERACTION_COMING_SOON_TOOLTIP = "Coming soon";
const SPECTATOR_SCORE_COMMIT_DELAY_MS = 340;
const SPECTATOR_SCORE_COMMIT_DELAY_FAST_MS = 180;
const DEMO_BOT_SPECTATOR_PREVIEW_LINGER_MS = 1800;

class Game implements GameCallbacks {
  private state: GameState;
  private scene: GameScene;
  private diceRenderer: DiceRenderer;
  private hud: HUD;
  private diceRow: DiceRow;
  private animating = false;
  private paused = false;
  private suppressSettingsCloseResume = false;
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
  private readonly bootstrapGameConfig: UnifiedGameCreateConfig | null;
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
  private spectatorScoreCommitTimersByPlayerId = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private spectatorRollSnapshotByPlayerId = new Map<
    string,
    MultiplayerTurnActionMessage["roll"]
  >();
  private spectatorRenderedRollKeyByPlayerId = new Map<string, string>();
  private spectatorPreviewClearTimersByPlayerId = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private participantSeatById = new Map<string, number>();
  private participantIdBySeat = new Map<number, string>();
  private participantLabelById = new Map<string, string>();
  private nudgeCooldownByPlayerId = new Map<string, number>();
  private lastTurnPlanPreview = "";
  private lastSessionComplete = false;
  private localAvatarUrl: string | undefined;
  private localAdminRole: "viewer" | "operator" | "owner" | null = null;
  private botMemeAvatarByPlayerId = new Map<string, string>();
  private botMemeAvatarRotationHandle: ReturnType<typeof setInterval> | null = null;
  private botMemeAvatarRefreshInFlight = false;
  private waitForNextGameRequestInFlight = false;
  private participantStateUpdateInFlight = false;
  private autoSeatReadySyncInFlight = false;
  private demoControlUpdateInFlight = false;
  private roomChatUnreadCount = 0;
  private roomInteractionAlertCount = 0;
  private roomChatIsOpen = false;
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
  private seatStatusBtn: HTMLButtonElement | null = null;
  private seatStatusBtnLabel: HTMLElement | null = null;
  private deselectBtn: HTMLButtonElement;
  private undoBtn: HTMLButtonElement;
  private newGameBtn: HTMLButtonElement | null = null;
  private waitNextGameBtn: HTMLButtonElement | null = null;
  private demoRunToggleBtn: HTMLButtonElement | null = null;
  private demoSpeedToggleBtn: HTMLButtonElement | null = null;
  private mobileDemoRunToggleBtn: HTMLButtonElement | null = null;
  private mobileDemoSpeedToggleBtn: HTMLButtonElement | null = null;
  private inviteLinkBtn: HTMLButtonElement | null = null;
  private roomChatBtn: HTMLButtonElement | null = null;
  private mobileInviteLinkBtn: HTMLButtonElement | null = null;
  private mobileRoomChatBtn: HTMLButtonElement | null = null;
  private profileBtnEl: HTMLButtonElement | null = null;
  private profileBtnAvatarEl: HTMLImageElement | null = null;
  private pauseMenuModal: HTMLElement | null = null;
  private roomChatBadgeEl: HTMLElement | null = null;
  private mobileRoomChatBadgeEl: HTMLElement | null = null;
  private turnActionBannerEl: HTMLElement | null = null;
  private playerInteractions: PlayerInteractionsPanel | null = null;
  private multiplayerChatPanel: MultiplayerChatPanel | null = null;

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

  private resolveRequestedMultiplayerGameConfig(): UnifiedGameCreateConfig {
    const requestedDifficulty = this.resolveRequestedMultiplayerDifficulty();
    const botCount = Math.max(0, Math.floor(this.multiplayerOptions.botCount ?? 0));
    const demoSpeedMode = this.multiplayerOptions.demoSpeedMode === true;
    const fallbackMode = demoSpeedMode ? "demo" : "multiplayer";
    const bootstrapConfig =
      this.bootstrapGameConfig && this.bootstrapGameConfig.mode !== "solo"
        ? this.bootstrapGameConfig
        : null;
    const mode = bootstrapConfig?.mode === "demo" || demoSpeedMode ? "demo" : fallbackMode;
    const difficulty =
      this.normalizeMultiplayerDifficulty(bootstrapConfig?.difficulty) ?? requestedDifficulty;
    const timingProfile = bootstrapConfig?.timingProfile;
    const capabilities = bootstrapConfig?.capabilities;
    const autoRun =
      mode === "demo"
        ? bootstrapConfig?.automation?.autoRun !== false
        : bootstrapConfig?.automation?.autoRun === true;

    return buildUnifiedGameConfig({
      mode,
      difficulty,
      botCount,
      demoSpeedMode: mode === "demo",
      autoRun,
      timingProfile,
      capabilities,
    });
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
    this.bootstrapGameConfig = sessionBootstrap.gameConfig ?? null;
    this.multiplayerOptions = sessionBootstrap.multiplayer ?? {};
    if (this.playMode === "multiplayer") {
      const bootstrapDifficulty = this.normalizeMultiplayerDifficulty(
        this.bootstrapGameConfig?.difficulty
      );
      if (bootstrapDifficulty) {
        this.multiplayerOptions.gameDifficulty = bootstrapDifficulty;
      }
      if (this.bootstrapGameConfig?.mode === "demo") {
        this.multiplayerOptions.demoSpeedMode = true;
      }
      const bootstrapBotCount = this.bootstrapGameConfig?.automation?.botCount;
      if (typeof bootstrapBotCount === "number" && Number.isFinite(bootstrapBotCount)) {
        this.multiplayerOptions.botCount = Math.max(0, Math.floor(bootstrapBotCount));
      }
    }
    if (this.playMode === "multiplayer" && this.multiplayerOptions.autoSeatReady !== false) {
      this.multiplayerOptions.autoSeatReady = true;
    }

    // Initialize game state from URL or create new game
    this.state = GameFlowController.initializeGameState();
    const bootstrapStateDifficulty = this.normalizeMultiplayerDifficulty(
      this.bootstrapGameConfig?.difficulty
    );
    if (bootstrapStateDifficulty) {
      this.state.mode.difficulty = bootstrapStateDifficulty;
    }
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
      this.multiplayerChatPanel?.setConnected(true);
      this.flushPendingTurnEndSync();
    });
    document.addEventListener("multiplayer:disconnected", () => {
      particleService.enableNetworkSync(false);
      this.touchMultiplayerTurnSyncActivity();
      this.multiplayerChatPanel?.setConnected(false);
      if (this.playMode === "multiplayer") {
        this.hud.setTurnSyncStatus("stale", "Disconnected");
      }
    });
    document.addEventListener("multiplayer:authExpired", () => {
      showDebugAuditNotification("Multiplayer auth expired, refreshing session...", {
        type: "warning",
        duration: 2200,
      });
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
    this.seatStatusBtn = document.getElementById("seat-status-btn") as HTMLButtonElement | null;
    this.seatStatusBtnLabel = document.getElementById("seat-status-btn-label");
    this.deselectBtn = document.getElementById("deselect-btn") as HTMLButtonElement;
    this.undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement | null;
    this.waitNextGameBtn = document.getElementById("wait-next-game-btn") as HTMLButtonElement | null;
    this.demoRunToggleBtn = document.getElementById("demo-run-toggle-btn") as HTMLButtonElement | null;
    this.demoSpeedToggleBtn = document.getElementById("demo-speed-toggle-btn") as HTMLButtonElement | null;
    this.mobileDemoRunToggleBtn = document.getElementById(
      "mobile-demo-run-toggle-btn"
    ) as HTMLButtonElement | null;
    this.mobileDemoSpeedToggleBtn = document.getElementById(
      "mobile-demo-speed-toggle-btn"
    ) as HTMLButtonElement | null;
    this.inviteLinkBtn = document.getElementById("invite-link-btn") as HTMLButtonElement | null;
    this.roomChatBtn = document.getElementById("room-chat-btn") as HTMLButtonElement | null;
    this.profileBtnEl = document.getElementById("profile-btn") as HTMLButtonElement | null;
    this.profileBtnAvatarEl = document.getElementById("profile-btn-avatar") as HTMLImageElement | null;
    this.mobileInviteLinkBtn = document.getElementById("mobile-invite-link-btn") as HTMLButtonElement | null;
    this.mobileRoomChatBtn = document.getElementById("mobile-room-chat-btn") as HTMLButtonElement | null;
    this.demoRunToggleBtn?.addEventListener("click", () => {
      void this.handleDemoRunToggle();
    });
    this.demoSpeedToggleBtn?.addEventListener("click", () => {
      void this.handleDemoSpeedToggle();
    });
    this.mobileDemoRunToggleBtn?.addEventListener("click", () => {
      void this.handleDemoRunToggle();
    });
    this.mobileDemoSpeedToggleBtn?.addEventListener("click", () => {
      void this.handleDemoSpeedToggle();
    });
    this.ensureRoomChatNotificationBadges();
    this.turnActionBannerEl = this.ensureTurnActionBanner();
    this.playerInteractions = new PlayerInteractionsPanel({
      mountRoot: document.getElementById("unified-hud"),
      localPlayerId: this.localPlayerId,
      enableChipRail: false,
      comingSoonTooltip: PLAYER_INTERACTION_COMING_SOON_TOOLTIP,
      onSelectionChange: (playerId) => {
        this.hud.setMultiplayerSelectedPlayer(playerId);
      },
      onInfo: (message) => {
        notificationService.show(message, "info", 1700);
      },
      onWhisper: (playerId) => {
        this.openWhisperComposerForTarget(playerId);
      },
      onCauseChaos: (playerId) => {
        this.sendChaosAttackToPlayer(playerId);
      },
      onNudge: (playerId) => {
        this.triggerTurnNudge(playerId);
      },
      onSendGift: (playerId) => {
        this.sendGiftInteractionToPlayer(playerId);
      },
      onKick: (playerId) => {
        void this.handleModerationAction(playerId, "kick");
      },
      onBan: (playerId) => {
        void this.handleModerationAction(playerId, "ban");
      },
      loadProfile: (playerId) => this.loadPlayerInteractionProfileData(playerId),
      resolveChaosDisabledReason: (participant) => {
        if (!participant.isSeated) {
          return "Player must be seated to target chaos.";
        }
        if (!this.multiplayerNetwork?.isConnected()) {
          return "Reconnect to multiplayer before sending chaos.";
        }
        return "";
      },
      resolveNudgeDisabledReason: (participant, activeTurnPlayerId) =>
        activeTurnPlayerId === participant.playerId
          ? ""
          : "Nudge unlocks when this player is active.",
      resolveGiftDisabledReason: (participant) => {
        if (participant.isBot) {
          return "Bots cannot receive gifts yet.";
        }
        if (!this.multiplayerNetwork?.isConnected()) {
          return "Reconnect to multiplayer before sending gifts.";
        }
        return "";
      },
      resolveKickDisabledReason: (participant) => {
        if (participant.isBot) {
          return "Bots are managed automatically.";
        }
        if (!this.canLocalPlayerModerateMultiplayerRoom()) {
          return "Only room creator or admins can kick players.";
        }
        return "";
      },
      resolveBanDisabledReason: (participant) => {
        if (participant.isBot) {
          return "Bots are managed automatically.";
        }
        if (!this.canLocalPlayerModerateMultiplayerRoom()) {
          return "Only room creator or admins can ban players.";
        }
        return "";
      },
    });
    this.hud.setOnMultiplayerPlayerSelect((playerId) => {
      this.playerInteractions?.open(playerId);
    });
    this.multiplayerChatPanel = new MultiplayerChatPanel({
      localPlayerId: this.localPlayerId,
      onSendPublic: (message) => {
        const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
        return this.sendPlayerRoomChannelMessage({
          idPrefix: "chat-public",
          channel: "public",
          topic: "chat",
          title: sourceLabel,
          message,
          severity: "info",
        });
      },
      onSendWhisper: (targetPlayerId, message) => {
        if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
          return null;
        }
        if (this.isBotParticipant(targetPlayerId)) {
          notificationService.show("Bots cannot receive whispers yet.", "info", 1800);
          return null;
        }
        const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
        return this.sendPlayerRoomChannelMessage({
          idPrefix: `chat-whisper-${targetPlayerId}`,
          channel: "direct",
          topic: "whisper",
          title: `Whisper from ${sourceLabel}`,
          message,
          severity: "info",
          targetPlayerId,
        });
      },
      onInfo: (message, severity = "info") => {
        notificationService.show(message, severity, 1900);
      },
      onUnreadCountChange: (count) => {
        this.roomChatUnreadCount = Math.max(0, Math.floor(count));
        this.updateRoomChatNotificationBadge();
      },
      onVisibilityChange: (isOpen) => {
        this.roomChatIsOpen = isOpen;
        if (isOpen) {
          this.roomInteractionAlertCount = 0;
        }
        this.updateRoomChatNotificationBadge();
      },
    });
    this.multiplayerChatPanel.setConnected(this.multiplayerNetwork?.isConnected() ?? false);
    this.updateRoomChatNotificationBadge();

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
      if (this.suppressSettingsCloseResume) {
        this.suppressSettingsCloseResume = false;
        return;
      }
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
          this.handleSeatStatusToggle();
          return;
        }

        if (
          this.playMode === "multiplayer" &&
          targetPlayerId &&
          targetPlayerId !== this.localPlayerId
        ) {
          this.playerInteractions?.open(targetPlayerId);
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
    this.ensurePauseMenuModal();
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
      nextGameStartsAt?: number | null;
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
    const explicitNextGameStartsAt =
      typeof source.nextGameStartsAt === "number" &&
      Number.isFinite(source.nextGameStartsAt) &&
      source.nextGameStartsAt > 0
        ? Math.floor(source.nextGameStartsAt)
        : null;
    const localCountdownDeadlineAt =
      explicitNextGameStartsAt !== null
        ? this.mapServerTimestampToLocalClock(explicitNextGameStartsAt) ?? explicitNextGameStartsAt
        : null;

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
      this.hud.setRoundCountdownDeadline(localCountdownDeadlineAt);
      return;
    }

    this.gameStartServerAt = serverGameStartAt;
    this.gameStartTime = localGameStartAt;
    this.hud.setGameClockStart(this.gameStartTime);
    if (this.playMode === "multiplayer") {
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
        showDebugAuditNotification("Turn sync refresh failed.", {
          type: "warning",
          duration: 2200,
          detail: reason,
        });
        log.warn(`Turn sync refresh failed (${reason})`, {
          sessionId: activeSession.sessionId,
        });
        return false;
      }
      this.touchMultiplayerTurnSyncActivity();
      this.applyMultiplayerSeatState(refreshedSession);
      this.flushPendingTurnEndSync();
      this.hud.setTurnSyncStatus("ok", "Resynced");
      showDebugAuditNotification("Turn sync refreshed.", {
        type: "success",
        duration: 1500,
        detail: reason,
      });
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
      } else if (joinFailureReason === "room_banned") {
        notificationService.show("You are banned from that room. Creating a new room instead.", "warning", 3000);
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
      } else if (joinFailureReason === "room_banned") {
        notificationService.show("You are banned from that room. Creating a new room instead.", "warning", 3000);
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
    const demoSpeedMode = this.multiplayerOptions.demoSpeedMode === true;
    this.state.mode.difficulty = requestedDifficulty;
    const createdSession = await this.multiplayerSessionService.createSession({
      roomCode: this.multiplayerOptions.roomCode,
      displayName: multiplayerIdentity.displayName,
      avatarUrl: multiplayerIdentity.avatarUrl,
      providerId: multiplayerIdentity.providerId,
      botCount: this.multiplayerOptions.botCount,
      gameDifficulty: requestedDifficulty,
      demoSpeedMode,
      gameConfig: this.resolveRequestedMultiplayerGameConfig(),
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
        } else if (joinFailureReason === "room_banned") {
          notificationService.show("You are banned from that room.", "warning", 3000);
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
        } else if (joinFailureReason === "room_banned") {
          notificationService.show("You are banned from that room.", "warning", 3000);
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
      this.updateProfileButtonAvatar();
      return this.cachedMultiplayerIdentity.value;
    }

    await firebaseAuthService.initialize();
    const firebaseProfile = firebaseAuthService.getCurrentUserProfile();
    const isAuthenticated = Boolean(firebaseProfile && !firebaseProfile.isAnonymous);

    let accountProfile: Awaited<ReturnType<typeof leaderboardService.getAccountProfile>> = null;
    if (isAuthenticated) {
      accountProfile = await leaderboardService.getAccountProfile();
    }
    this.localAdminRole =
      accountProfile?.admin?.role === "viewer" ||
      accountProfile?.admin?.role === "operator" ||
      accountProfile?.admin?.role === "owner"
        ? accountProfile.admin.role
        : null;

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
    this.updateProfileButtonAvatar();
    this.cachedMultiplayerIdentity = {
      value: identity,
      fetchedAt: now,
    };
    return identity;
  }

  private updateProfileButtonAvatar(): void {
    if (!this.profileBtnEl || !this.profileBtnAvatarEl) {
      return;
    }

    const avatarUrl = this.localAvatarUrl;
    if (typeof avatarUrl === "string" && avatarUrl.trim().length > 0) {
      if (this.profileBtnAvatarEl.src !== avatarUrl) {
        this.profileBtnAvatarEl.src = avatarUrl;
      }
      this.profileBtnAvatarEl.style.display = "";
      this.profileBtnEl.classList.add("has-profile-avatar");
      return;
    }

    this.profileBtnAvatarEl.removeAttribute("src");
    this.profileBtnAvatarEl.style.display = "none";
    this.profileBtnEl.classList.remove("has-profile-avatar");
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
    this.roomInteractionAlertCount = 0;
    this.updateRoomChatNotificationBadge();
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
    void this.ensureAutoSeatReadyForSession(session.sessionId);
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
        this.clearSpectatorRollingPreviewForPlayer(playerId);
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
          isInLounge: participant.isSeated !== true,
          playerName: this.formatSeatDisplayName(participant, isCurrentPlayer, showReadyState),
          avatarUrl: participant.avatarUrl,
          avatarColor: this.resolveSeatColor(participant, isCurrentPlayer),
          score: participant.score,
          isComplete: participant.isComplete,
        });
        continue;
      }

      const isCurrentSeat = seatIndex === currentSeatIndex;
      const showCurrentSeatOccupant = isCurrentSeat && localSeatState?.isSeated === true;
      this.scene.playerSeatRenderer.updateSeat(seatIndex, {
        occupied: showCurrentSeatOccupant,
        isCurrentPlayer: showCurrentSeatOccupant,
        isBot: false,
        isInLounge: false,
        playerName: showCurrentSeatOccupant ? "YOU" : "Empty",
        avatarUrl: showCurrentSeatOccupant ? this.localAvatarUrl : undefined,
        avatarColor: showCurrentSeatOccupant ? new Color3(0.24, 0.84, 0.36) : undefined,
        score: showCurrentSeatOccupant ? this.state.score : undefined,
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
    this.playerInteractions?.updateParticipants(
      this.buildPlayerInteractionParticipants(seatedParticipants),
      this.activeTurnPlayerId
    );
    this.multiplayerChatPanel?.setSessionContext(session.sessionId, session.roomCode);
    this.multiplayerChatPanel?.setParticipants(
      this.buildMultiplayerChatParticipants(session.participants ?? [])
    );
    this.multiplayerChatPanel?.setConnected(this.multiplayerNetwork?.isConnected() ?? false);
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
    this.playerInteractions?.clear();
    this.multiplayerChatPanel?.clear();
    this.roomChatUnreadCount = 0;
    this.roomInteractionAlertCount = 0;
    this.roomChatIsOpen = false;
    this.updateRoomChatNotificationBadge();
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
        isInLounge: false,
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

  private buildPlayerInteractionParticipants(
    seatedParticipants: SeatedMultiplayerParticipant[]
  ): PlayerInteractionParticipant[] {
    return seatedParticipants
      .filter(
        (participant) =>
          participant.playerId !== this.localPlayerId &&
          participant.isSeated &&
          !participant.queuedForNextGame
      )
      .map((participant) => ({
        playerId: participant.playerId,
        label: this.getParticipantBroadcastLabel(participant.playerId),
        avatarUrl: participant.avatarUrl,
        isBot: participant.isBot,
        isSeated: participant.isSeated,
        isReady: participant.isReady,
        queuedForNextGame: participant.queuedForNextGame,
        isComplete: participant.isComplete,
        score: participant.score,
      }));
  }

  private buildMultiplayerChatParticipants(
    participants: MultiplayerSessionParticipant[]
  ): MultiplayerChatParticipant[] {
    return participants
      .filter(
        (participant) =>
          participant &&
          typeof participant.playerId === "string" &&
          participant.playerId !== this.localPlayerId
      )
      .map((participant) => ({
        playerId: participant.playerId,
        label: this.getParticipantBroadcastLabel(participant.playerId),
        isBot: participant.isBot === true,
        isSeated: participant.isSeated !== false,
      }));
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

  private isAutoSeatReadyEnabled(): boolean {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (activeSession?.demoMode === true) {
      return false;
    }
    return (
      this.playMode === "multiplayer" &&
      environment.features.multiplayerAutoSeatReady &&
      this.multiplayerOptions.autoSeatReady !== false
    );
  }

  private async ensureAutoSeatReadyForSession(sessionId: string): Promise<void> {
    if (!this.isAutoSeatReadyEnabled() || this.autoSeatReadySyncInFlight) {
      return;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId || activeSession.sessionId !== sessionId) {
      return;
    }

    const localParticipant = this.getSessionParticipantById(activeSession, this.localPlayerId);
    if (!localParticipant || localParticipant.isBot) {
      return;
    }
    if (localParticipant.isSeated === true && localParticipant.isReady === true) {
      return;
    }

    this.autoSeatReadySyncInFlight = true;
    try {
      let latestSession: MultiplayerSessionRecord | null = activeSession;

      if (localParticipant.isSeated !== true) {
        latestSession = await this.multiplayerSessionService.updateParticipantState("sit");
        if (!latestSession) {
          log.warn(`Auto seat failed for session ${sessionId}`);
          return;
        }
      }

      const refreshedSession = latestSession ?? this.multiplayerSessionService.getActiveSession();
      if (!refreshedSession || refreshedSession.sessionId !== sessionId) {
        return;
      }

      const refreshedLocalParticipant = this.getSessionParticipantById(
        refreshedSession,
        this.localPlayerId
      );
      if (
        !refreshedLocalParticipant ||
        refreshedLocalParticipant.isBot ||
        refreshedLocalParticipant.isSeated !== true
      ) {
        return;
      }

      if (refreshedLocalParticipant.isReady !== true) {
        latestSession = await this.multiplayerSessionService.updateParticipantState("ready");
        if (!latestSession) {
          log.warn(`Auto ready failed for session ${sessionId}`);
          return;
        }
      }

      const nextSession = latestSession ?? this.multiplayerSessionService.getActiveSession();
      if (nextSession?.sessionId === sessionId) {
        this.applyMultiplayerSeatState(nextSession);
        this.touchMultiplayerTurnSyncActivity();
      }
    } finally {
      this.autoSeatReadySyncInFlight = false;
    }
  }

  private resolveSeatToggleAction(
    localSeatState: { isSeated: boolean; isReady: boolean }
  ): "sit" | "stand" {
    if (!localSeatState.isSeated) {
      return "sit";
    }
    return "stand";
  }

  private isPlayableDisruptionStateForLocalSeatChange(
    localSeatState: { isSeated: boolean; isReady: boolean }
  ): boolean {
    if (!localSeatState.isSeated || !localSeatState.isReady) {
      return false;
    }

    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession || activeSession.sessionComplete === true) {
      return false;
    }

    const round =
      typeof activeSession.turnState?.round === "number" &&
      Number.isFinite(activeSession.turnState.round)
        ? Math.max(1, Math.floor(activeSession.turnState.round))
        : 1;
    const turnNumber =
      typeof activeSession.turnState?.turnNumber === "number" &&
      Number.isFinite(activeSession.turnState.turnNumber)
        ? Math.max(1, Math.floor(activeSession.turnState.turnNumber))
        : 1;
    const hasQueuedOpponents = this.hasActiveHumanOpponent() || this.hasActiveBotOpponent();
    const hasTurnRuntimeProgress =
      this.state.status !== "READY" ||
      this.state.rollIndex > 0 ||
      this.state.selected.size > 0;

    return (
      hasTurnRuntimeProgress ||
      this.activeTurnPlayerId === this.localPlayerId ||
      (hasQueuedOpponents &&
        (round > 1 || turnNumber > 1 || typeof activeSession.turnState?.activeTurnPlayerId === "string"))
    );
  }

  private async confirmDisruptiveSeatOrRoomExit(
    action: "stand" | "leave_room",
    localSeatState: { isSeated: boolean; isReady: boolean } | null
  ): Promise<boolean> {
    if (
      this.playMode !== "multiplayer" ||
      !localSeatState ||
      !this.isPlayableDisruptionStateForLocalSeatChange(localSeatState)
    ) {
      return true;
    }

    const title = action === "stand" ? "Stand Up And Exit Queue?" : "Leave Room Now?";
    const message =
      action === "stand"
        ? "This will remove you from the active game queue immediately. The room will continue without you and other players will be notified."
        : "This will remove you from the active game queue and leave the room immediately. The room will continue without you and other players will be notified.";
    const confirmLabel = action === "stand" ? "Stand Up" : "Leave Room";

    return confirmAction({
      title,
      message,
      confirmLabel,
      cancelLabel: "Stay",
      tone: "danger",
    });
  }

  private announceLocalPresenceChange(event: "stood_up" | "left_room"): void {
    if (this.playMode !== "multiplayer") {
      return;
    }
    const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
    const message =
      event === "stood_up"
        ? `${sourceLabel} stood up and left the active queue.`
        : `${sourceLabel} left the room.`;
    this.sendPlayerRoomChannelMessage({
      idPrefix: event === "stood_up" ? "presence-stand" : "presence-left",
      channel: "public",
      topic: "presence",
      title: "Room Presence",
      message,
      severity: "info",
    });
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
    const previousLocalSeatState = this.getLocalMultiplayerSeatState();

    this.participantStateUpdateInFlight = true;
    this.updateUI();
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
      const nextLocalSeatState = this.getLocalMultiplayerSeatState();
      this.touchMultiplayerTurnSyncActivity();
      const transitionedToStanding =
        action === "stand" &&
        previousLocalSeatState?.isSeated === true &&
        nextLocalSeatState?.isSeated === false;
      if (transitionedToStanding) {
        this.resetLocalStateForNextMultiplayerGame({ notificationMessage: null });
        this.announceLocalPresenceChange("stood_up");
        this.updateUI();
      }
      const successMessageByAction = {
        sit: "You sat down. Tap Ready when you want in.",
        stand: "You stood up, left the queue, and moved to observer mode.",
        ready: "Ready up confirmed.",
        unready: "You are no longer marked ready.",
      } as const;
      notificationService.show(successMessageByAction[action], action === "ready" ? "success" : "info", 1800);
    } finally {
      this.participantStateUpdateInFlight = false;
      this.updateUI();
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
    this.clearScheduledSpectatorPreviewClear();
    this.clearPendingSpectatorScoreCommit();
    this.spectatorRollSnapshotByPlayerId.clear();
    this.spectatorRenderedRollKeyByPlayerId.clear();
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

  private isPrivateRoomSession(session: MultiplayerSessionRecord | null | undefined): boolean {
    if (!session) {
      return false;
    }
    if (session.roomType === "private") {
      return true;
    }
    return session.isPublic === false;
  }

  private isLocalPlayerPrivateRoomHost(
    session: MultiplayerSessionRecord | null | undefined
  ): boolean {
    if (this.playMode !== "multiplayer" || !this.isPrivateRoomSession(session)) {
      return false;
    }
    if (!session) {
      return false;
    }
    const ownerPlayerId =
      typeof session.ownerPlayerId === "string" ? session.ownerPlayerId.trim() : "";
    return ownerPlayerId.length > 0 && ownerPlayerId === this.localPlayerId;
  }

  private async applyDemoControlUpdate(
    action: "pause" | "resume" | "speed_normal" | "speed_fast"
  ): Promise<void> {
    if (this.demoControlUpdateInFlight) {
      return;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!this.isLocalPlayerPrivateRoomHost(activeSession)) {
      showGameplayThemedNotification(
        "host_control_forbidden",
        "Only the room host can update host controls."
      );
      return;
    }

    this.demoControlUpdateInFlight = true;
    this.updateUI();
    try {
      const updatedSession = await this.multiplayerSessionService.updateDemoControls(action);
      if (!updatedSession) {
        const activeSessionId =
          typeof activeSession?.sessionId === "string" ? activeSession.sessionId : "unknown";
        showGameplayThemedNotification(
          "host_control_update_failed",
          "Unable to update host controls right now."
        );
        showDebugAuditNotification(
          "Host-control update request returned no session payload.",
          {
            type: "warning",
            duration: 3200,
            detail: `action=${action}; session=${activeSessionId}`,
          }
        );
        return;
      }

      this.applyMultiplayerSeatState(updatedSession);
      this.touchMultiplayerTurnSyncActivity();
      if (action === "pause") {
        showGameplayThemedNotification("host_control_paused", "Auto-run paused.");
        showDebugAuditNotification("Host control applied.", {
          detail: `action=${action}; session=${updatedSession.sessionId}`,
        });
      } else if (action === "resume") {
        showGameplayThemedNotification("host_control_resumed", "Auto-run restarted with fresh bots.");
        showDebugAuditNotification("Host control applied.", {
          detail: `action=${action}; session=${updatedSession.sessionId}`,
        });
      } else if (action === "speed_fast") {
        showGameplayThemedNotification("host_control_speed_fast", "Gameplay speed set to fast.");
        showDebugAuditNotification("Host control applied.", {
          detail: `action=${action}; session=${updatedSession.sessionId}`,
        });
      } else if (action === "speed_normal") {
        showGameplayThemedNotification(
          "host_control_speed_normal",
          "Gameplay speed set to normal."
        );
        showDebugAuditNotification("Host control applied.", {
          detail: `action=${action}; session=${updatedSession.sessionId}`,
        });
      }
    } finally {
      this.demoControlUpdateInFlight = false;
      this.updateUI();
    }
  }

  private async handleDemoRunToggle(): Promise<void> {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession || !this.isLocalPlayerPrivateRoomHost(activeSession)) {
      showGameplayThemedNotification(
        "host_control_forbidden",
        "Host controls are only available to the room host."
      );
      return;
    }
    const isRunning = activeSession.demoMode === true && activeSession.demoAutoRun !== false;
    await this.applyDemoControlUpdate(isRunning ? "pause" : "resume");
  }

  private async handleDemoSpeedToggle(): Promise<void> {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession || !this.isLocalPlayerPrivateRoomHost(activeSession)) {
      showGameplayThemedNotification(
        "host_control_forbidden",
        "Host controls are only available to the room host."
      );
      return;
    }
    const isFast = activeSession.demoMode === true && activeSession.demoSpeedMode === true;
    await this.applyDemoControlUpdate(isFast ? "speed_normal" : "speed_fast");
  }

  private updateDemoControlButtons(): void {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    const showControls = this.isLocalPlayerPrivateRoomHost(activeSession);
    const isRunning = activeSession?.demoMode === true && activeSession?.demoAutoRun !== false;
    const isFast = activeSession?.demoMode === true && activeSession?.demoSpeedMode === true;
    const runLabel = isRunning ? "Pause Auto-Run" : "Start Auto-Run";
    const speedLabel = isFast ? "Speed: Fast" : "Speed: Normal";
    const controlsEl = document.getElementById("controls");
    controlsEl?.classList.toggle("has-demo-controls", showControls);

    if (this.demoRunToggleBtn) {
      this.demoRunToggleBtn.style.display = showControls ? "inline-flex" : "none";
      this.demoRunToggleBtn.textContent = runLabel;
      this.demoRunToggleBtn.title = isRunning
        ? "Pause bot autoplay in this room"
        : "Start bot autoplay in this room";
      this.demoRunToggleBtn.disabled = !showControls || this.demoControlUpdateInFlight;
    }

    if (this.demoSpeedToggleBtn) {
      this.demoSpeedToggleBtn.style.display = showControls ? "inline-flex" : "none";
      this.demoSpeedToggleBtn.textContent = speedLabel;
      this.demoSpeedToggleBtn.title = "Toggle bot pacing speed";
      this.demoSpeedToggleBtn.disabled = !showControls || this.demoControlUpdateInFlight;
    }

    if (this.mobileDemoRunToggleBtn) {
      this.mobileDemoRunToggleBtn.style.display = "none";
      const label = this.mobileDemoRunToggleBtn.querySelector("span");
      if (label) {
        label.textContent = runLabel;
      } else {
        this.mobileDemoRunToggleBtn.textContent = runLabel;
      }
      this.mobileDemoRunToggleBtn.title = isRunning
        ? "Pause bot autoplay in this room"
        : "Start bot autoplay in this room";
      this.mobileDemoRunToggleBtn.disabled = !showControls || this.demoControlUpdateInFlight;
    }

    if (this.mobileDemoSpeedToggleBtn) {
      this.mobileDemoSpeedToggleBtn.style.display = "none";
      const label = this.mobileDemoSpeedToggleBtn.querySelector("span");
      if (label) {
        label.textContent = speedLabel;
      } else {
        this.mobileDemoSpeedToggleBtn.textContent = speedLabel;
      }
      this.mobileDemoSpeedToggleBtn.title = "Toggle bot pacing speed";
      this.mobileDemoSpeedToggleBtn.disabled = !showControls || this.demoControlUpdateInFlight;
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
    this.playerInteractions?.setActiveTurnPlayer(activePlayerId);
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
    if (center) {
      return {
        seatIndex,
        x: center.x,
        y: center.y,
        z: center.z,
      };
    }

    const fallbackSeat = this.scene.playerSeats[seatIndex];
    if (!fallbackSeat?.position) {
      return null;
    }

    return {
      seatIndex,
      x: fallbackSeat.position.x,
      y: fallbackSeat.position.y,
      z: fallbackSeat.position.z,
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

  private buildSpectatorRollCacheKey(
    roll: MultiplayerTurnActionMessage["roll"] | null | undefined
  ): string | null {
    if (!roll || !Array.isArray(roll.dice) || roll.dice.length === 0) {
      return null;
    }

    const serverRollId =
      typeof roll.serverRollId === "string" ? roll.serverRollId.trim() : "";
    if (serverRollId) {
      return `srv:${serverRollId}`;
    }

    const rollIndex =
      Number.isFinite(roll.rollIndex) && roll.rollIndex > 0
        ? Math.floor(roll.rollIndex)
        : 0;
    const diceKey = roll.dice
      .map((die) => {
        const dieId = typeof die?.dieId === "string" ? die.dieId.trim() : "";
        const sides = Number.isFinite(die?.sides) ? Math.floor(die.sides) : 0;
        const value = Number.isFinite(die?.value) ? Math.floor(die.value as number) : 0;
        return `${dieId}:${sides}:${value}`;
      })
      .filter((entry) => entry.length > 0)
      .join("|");
    return `idx:${rollIndex}:${diceKey}`;
  }

  private syncSpectatorRollPreviewForPlayer(
    playerId: string | null | undefined,
    roll: MultiplayerTurnActionMessage["roll"] | null | undefined,
    options?: { forceReplay?: boolean }
  ): boolean {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      return false;
    }
    if (!roll || !Array.isArray(roll.dice) || roll.dice.length === 0) {
      return false;
    }

    const seatScoreZone = this.getSeatScoreZonePosition(targetPlayerId);
    if (!seatScoreZone) {
      return false;
    }

    const rollKey = this.buildSpectatorRollCacheKey(roll);
    if (!options?.forceReplay && rollKey) {
      const currentRollKey = this.spectatorRenderedRollKeyByPlayerId.get(targetPlayerId);
      if (currentRollKey === rollKey) {
        return true;
      }
    }

    this.clearScheduledSpectatorPreviewClear(targetPlayerId);
    this.clearPendingSpectatorScoreCommit(targetPlayerId);
    this.spectatorRollSnapshotByPlayerId.set(targetPlayerId, roll);
    if (rollKey) {
      this.spectatorRenderedRollKeyByPlayerId.set(targetPlayerId, rollKey);
    } else {
      this.spectatorRenderedRollKeyByPlayerId.delete(targetPlayerId);
    }

    const started = this.diceRenderer.startSpectatorRollPreview(
      this.buildSpectatorPreviewKey(targetPlayerId),
      roll,
      new Vector3(seatScoreZone.x, seatScoreZone.y, seatScoreZone.z)
    );
    if (!started) {
      this.spectatorRenderedRollKeyByPlayerId.delete(targetPlayerId);
    }
    return started;
  }

  private clearSpectatorRollingPreviewForPlayer(playerId: string | null | undefined): void {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      return;
    }
    this.clearScheduledSpectatorPreviewClear(targetPlayerId);
    this.clearPendingSpectatorScoreCommit(targetPlayerId);
    this.spectatorRollSnapshotByPlayerId.delete(targetPlayerId);
    this.spectatorRenderedRollKeyByPlayerId.delete(targetPlayerId);
    this.diceRenderer.cancelSpectatorPreview(this.buildSpectatorPreviewKey(targetPlayerId));
  }

  private clearScheduledSpectatorPreviewClear(playerId?: string | null): void {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (targetPlayerId) {
      const timer = this.spectatorPreviewClearTimersByPlayerId.get(targetPlayerId);
      if (timer) {
        clearTimeout(timer);
        this.spectatorPreviewClearTimersByPlayerId.delete(targetPlayerId);
      }
      return;
    }

    this.spectatorPreviewClearTimersByPlayerId.forEach((timer) => {
      clearTimeout(timer);
    });
    this.spectatorPreviewClearTimersByPlayerId.clear();
  }

  private resolveSpectatorPreviewClearDelayMs(playerId: string): number {
    if (!this.shouldShowDetailedDemoBotTurnAction(playerId)) {
      return 0;
    }
    return DEMO_BOT_SPECTATOR_PREVIEW_LINGER_MS;
  }

  private scheduleSpectatorPreviewClearForPlayer(
    playerId: string | null | undefined,
    delayMs?: number
  ): void {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      return;
    }

    this.clearScheduledSpectatorPreviewClear(targetPlayerId);
    const resolvedDelayMs =
      typeof delayMs === "number" && Number.isFinite(delayMs)
        ? Math.max(0, Math.floor(delayMs))
        : this.resolveSpectatorPreviewClearDelayMs(targetPlayerId);
    if (resolvedDelayMs <= 0) {
      this.clearSpectatorRollingPreviewForPlayer(targetPlayerId);
      return;
    }

    const clearHandle = window.setTimeout(() => {
      this.spectatorPreviewClearTimersByPlayerId.delete(targetPlayerId);
      this.clearSpectatorRollingPreviewForPlayer(targetPlayerId);
    }, resolvedDelayMs);
    this.spectatorPreviewClearTimersByPlayerId.set(targetPlayerId, clearHandle);
  }

  private clearPendingSpectatorScoreCommit(playerId?: string | null): void {
    const targetPlayerId = typeof playerId === "string" ? playerId.trim() : "";
    if (targetPlayerId) {
      const timer = this.spectatorScoreCommitTimersByPlayerId.get(targetPlayerId);
      if (timer) {
        clearTimeout(timer);
        this.spectatorScoreCommitTimersByPlayerId.delete(targetPlayerId);
      }
      return;
    }

    this.spectatorScoreCommitTimersByPlayerId.forEach((timer) => {
      clearTimeout(timer);
    });
    this.spectatorScoreCommitTimersByPlayerId.clear();
  }

  private resolveSpectatorScoreCommitDelayMs(): number {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    const isFastDemo =
      activeSession?.demoMode === true &&
      activeSession?.demoSpeedMode === true;
    return isFastDemo
      ? SPECTATOR_SCORE_COMMIT_DELAY_FAST_MS
      : SPECTATOR_SCORE_COMMIT_DELAY_MS;
  }

  private stageSpectatorScoreCommit(
    playerId: string,
    selectedDiceIds: string[],
    seatScoreZone: { seatIndex: number; x: number; y: number; z: number } | null
  ): void {
    const key = this.buildSpectatorPreviewKey(playerId);
    this.diceRenderer.updateSpectatorSelectionPreview(key, selectedDiceIds);
    this.clearPendingSpectatorScoreCommit(playerId);
    const delayMs = this.resolveSpectatorScoreCommitDelayMs();
    const commitTimer = window.setTimeout(() => {
      this.spectatorScoreCommitTimersByPlayerId.delete(playerId);
      const previewCompleted = this.diceRenderer.completeSpectatorScorePreview(key, selectedDiceIds);
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
      this.scheduleSpectatorPreviewClearForPlayer(playerId);
    }, Math.max(80, Math.floor(delayMs)));
    this.spectatorScoreCommitTimersByPlayerId.set(playerId, commitTimer);
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

  private openWhisperComposerForTarget(targetPlayerId: string): void {
    if (!this.canComposeRoomChannelMessage()) {
      return;
    }
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      notificationService.show("Pick another player to whisper.", "warning", 1800);
      return;
    }
    if (this.isBotParticipant(targetPlayerId)) {
      notificationService.show("Bots cannot receive whispers yet.", "info", 1800);
      return;
    }
    this.multiplayerChatPanel?.openWhisper(targetPlayerId);
  }

  private ensureRoomChatNotificationBadges(): void {
    if (this.roomChatBtn && !this.roomChatBadgeEl) {
      const existingBadge = this.roomChatBtn.querySelector<HTMLElement>(".room-chat-badge");
      if (existingBadge) {
        this.roomChatBadgeEl = existingBadge;
      } else {
        const badge = document.createElement("span");
        badge.className = "room-chat-badge";
        badge.style.display = "none";
        this.roomChatBtn.appendChild(badge);
        this.roomChatBadgeEl = badge;
      }
    }

    if (this.mobileRoomChatBtn && !this.mobileRoomChatBadgeEl) {
      const existingBadge = this.mobileRoomChatBtn.querySelector<HTMLElement>(".mobile-room-chat-badge");
      if (existingBadge) {
        this.mobileRoomChatBadgeEl = existingBadge;
      } else {
        const badge = document.createElement("span");
        badge.className = "mobile-updates-badge mobile-room-chat-badge";
        badge.style.display = "none";
        this.mobileRoomChatBtn.appendChild(badge);
        this.mobileRoomChatBadgeEl = badge;
      }
    }
  }

  private updateRoomChatNotificationBadge(): void {
    this.ensureRoomChatNotificationBadges();
    const totalUnread = this.roomChatIsOpen
      ? 0
      : Math.max(0, this.roomChatUnreadCount + this.roomInteractionAlertCount);
    const label = totalUnread > 99 ? "99+" : String(totalUnread);
    const shouldDisplay = totalUnread > 0;

    if (this.roomChatBadgeEl) {
      this.roomChatBadgeEl.textContent = label;
      this.roomChatBadgeEl.style.display = shouldDisplay ? "flex" : "none";
    }
    if (this.mobileRoomChatBadgeEl) {
      this.mobileRoomChatBadgeEl.textContent = label;
      this.mobileRoomChatBadgeEl.style.display = shouldDisplay ? "inline-flex" : "none";
    }
  }

  private canLocalPlayerModerateMultiplayerRoom(): boolean {
    if (this.playMode !== "multiplayer") {
      return false;
    }
    if (this.localAdminRole === "operator" || this.localAdminRole === "owner") {
      return true;
    }
    const ownerPlayerId = this.multiplayerSessionService.getActiveSession()?.ownerPlayerId;
    return (
      typeof ownerPlayerId === "string" &&
      ownerPlayerId.trim().length > 0 &&
      ownerPlayerId.trim() === this.localPlayerId
    );
  }

  private sendGiftInteractionToPlayer(targetPlayerId: string): void {
    if (!this.canComposeRoomChannelMessage()) {
      return;
    }
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      notificationService.show("Pick another player for gifts.", "warning", 1800);
      return;
    }
    if (this.isBotParticipant(targetPlayerId)) {
      notificationService.show("Bots cannot receive gifts yet.", "info", 1800);
      return;
    }

    const sourceLabel = this.getParticipantBroadcastLabel(this.localPlayerId);
    const payload: MultiplayerPlayerNotificationMessage = {
      type: "player_notification",
      id: `gift-${this.localPlayerId}-${targetPlayerId}-${Date.now()}`,
      playerId: this.localPlayerId,
      sourcePlayerId: this.localPlayerId,
      title: `Gift from ${sourceLabel}`,
      message: `${sourceLabel} sent you a gift. Rewards are in preview mode.`,
      severity: "success",
      targetPlayerId,
      timestamp: Date.now(),
    };
    const sent = this.multiplayerNetwork?.sendPlayerNotification(payload) ?? false;
    if (!sent) {
      notificationService.show("Unable to send gift right now.", "warning", 2000);
      return;
    }

    notificationService.show(`Gift sent to ${this.getParticipantLabel(targetPlayerId)}.`, "success", 2000);
  }

  private async handleModerationAction(
    targetPlayerId: string,
    action: MultiplayerModerationAction
  ): Promise<void> {
    if (this.playMode !== "multiplayer") {
      notificationService.show("Moderation is available in multiplayer rooms only.", "info", 1800);
      return;
    }

    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId) {
      notificationService.show("No active multiplayer room found.", "warning", 2000);
      return;
    }
    if (!this.canLocalPlayerModerateMultiplayerRoom()) {
      notificationService.show("Only room creator or admins can moderate players.", "warning", 2200);
      return;
    }
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      notificationService.show("You cannot moderate yourself.", "warning", 1800);
      return;
    }
    if (this.isBotParticipant(targetPlayerId)) {
      notificationService.show("Bots are managed automatically.", "info", 1800);
      return;
    }

    const targetLabel = this.getParticipantLabel(targetPlayerId);
    const confirmed = await confirmAction({
      title: action === "ban" ? `Ban ${targetLabel}?` : `Kick ${targetLabel}?`,
      message:
        action === "ban"
          ? "This removes them now and blocks them from rejoining this room."
          : "This removes them from the current room immediately.",
      confirmLabel: action === "ban" ? "Ban Player" : "Kick Player",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    const result = await this.multiplayerSessionService.moderateParticipant(targetPlayerId, action);
    if (!result.ok) {
      notificationService.show(
        this.resolveModerationFailureMessage(result.reason),
        "warning",
        2400
      );
      return;
    }
    if (result.session) {
      this.applyMultiplayerSeatState(result.session);
    }

    notificationService.show(
      action === "ban"
        ? `${targetLabel} was banned from the room.`
        : `${targetLabel} was removed from the room.`,
      "success",
      2400
    );
  }

  private resolveModerationFailureMessage(reason: string | undefined): string {
    if (reason === "not_room_owner") {
      return "Only room creator or admins can moderate players.";
    }
    if (reason === "unknown_player") {
      return "That player is no longer in this room.";
    }
    if (reason === "session_expired" || reason === "unknown_session") {
      return "Room expired while applying moderation.";
    }
    if (reason === "cannot_moderate_self") {
      return "You cannot moderate yourself.";
    }
    if (reason === "unauthorized") {
      return "Moderation requires valid room authorization.";
    }
    return "Unable to apply moderation action.";
  }

  private async loadPlayerInteractionProfileData(
    targetPlayerId: string
  ): Promise<PlayerInteractionProfileData | null> {
    const [profile, scoreList] = await Promise.all([
      backendApiService.getPlayerProfile(targetPlayerId),
      backendApiService.getPlayerScores(targetPlayerId, 80),
    ]);

    const stats = scoreList?.stats;
    const totalGames =
      typeof stats?.totalGames === "number" && Number.isFinite(stats.totalGames)
        ? Math.max(0, Math.floor(stats.totalGames))
        : 0;
    const bestScore =
      typeof stats?.bestScore === "number" && Number.isFinite(stats.bestScore)
        ? Math.floor(stats.bestScore)
        : null;
    const averageScore =
      typeof stats?.averageScore === "number" && Number.isFinite(stats.averageScore)
        ? Math.round(stats.averageScore)
        : null;
    const totalPlayTimeMs =
      typeof stats?.totalPlayTime === "number" && Number.isFinite(stats.totalPlayTime)
        ? Math.max(0, Math.floor(stats.totalPlayTime))
        : 0;

    const recentRuns = Array.isArray(scoreList?.entries)
      ? scoreList.entries.slice(0, 3).map((entry) => {
          const difficulty: PlayerInteractionProfileData["recentRuns"][number]["difficulty"] =
            entry.mode?.difficulty === "easy" || entry.mode?.difficulty === "hard"
              ? entry.mode.difficulty
              : "normal";
          return {
            score:
              typeof entry.score === "number" && Number.isFinite(entry.score)
                ? Math.floor(entry.score)
                : 0,
            difficulty,
            durationMs:
              typeof entry.duration === "number" && Number.isFinite(entry.duration)
                ? Math.max(0, Math.floor(entry.duration))
                : 0,
          };
        })
      : [];

    const hasAnyData =
      Boolean(profile) ||
      Boolean(scoreList) ||
      totalGames > 0 ||
      recentRuns.length > 0;
    if (!hasAnyData) {
      return null;
    }

    return {
      playerId: targetPlayerId,
      totalGames,
      bestScore,
      averageScore,
      totalPlayTimeMs,
      recentRuns,
      profileUpdatedAt:
        typeof profile?.updatedAt === "number" && Number.isFinite(profile.updatedAt)
          ? profile.updatedAt
          : undefined,
    };
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
  ): MultiplayerRoomChannelMessage | null {
    const normalizedMessage = this.normalizeComposedRoomChannelMessage(options.message);
    if (!normalizedMessage) {
      return null;
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
    const sent = this.multiplayerNetwork?.sendRoomChannelMessage(payload) ?? false;
    return sent ? payload : null;
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
      notificationService.show(`${title}: ${message}`, tone, 3200, {
        channel: payload.targetPlayerId === this.localPlayerId ? "private" : "gameplay",
      });
    }

    if (
      sourcePlayerId &&
      sourcePlayerId !== this.localPlayerId &&
      payload.targetPlayerId === this.localPlayerId &&
      !this.roomChatIsOpen
    ) {
      this.roomInteractionAlertCount += 1;
      this.updateRoomChatNotificationBadge();
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
    this.multiplayerChatPanel?.appendIncomingChannelMessage(payload);
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

    const shouldSurfaceNotification =
      !this.multiplayerChatPanel?.isOpen() ||
      tone === "warning" ||
      tone === "error" ||
      channel === "direct" ||
      topic === "next_game_countdown";
    if (shouldSurfaceNotification) {
      const fallbackTitle = channel === "direct" ? "Direct" : "Room";
      const title = typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : fallbackTitle;
      const durationMs = topic === "next_game_countdown" ? 1400 : channel === "direct" ? 3600 : 2600;
      notificationService.show(`${title}: ${message}`, tone, durationMs, {
        channel: channel === "direct" ? "private" : "gameplay",
      });
    }
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
    const hasNextGameStartsAt = Object.prototype.hasOwnProperty.call(message, "nextGameStartsAt");
    const syncedSession = this.multiplayerSessionService.syncSessionState({
      sessionId: message.sessionId,
      roomCode: message.roomCode,
      gameDifficulty: message.gameDifficulty,
      gameConfig: message.gameConfig,
      demoMode: message.demoMode,
      demoAutoRun: message.demoAutoRun,
      demoSpeedMode: message.demoSpeedMode,
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
      ...(hasNextGameStartsAt
        ? { nextGameStartsAt: message.nextGameStartsAt ?? null }
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
      ...(typeof message.ownerPlayerId === "string" && message.ownerPlayerId.trim().length > 0
        ? { ownerPlayerId: message.ownerPlayerId.trim() }
        : { ownerPlayerId: undefined }),
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
    this.recoverSpectatorPreviewFromSessionTurnState(syncedSession.turnState);
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
      showGameplayThemedNotification("round_winner", `${winnerLabel} wins the round.`);
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
    this.recoverSpectatorTurnPreviewFromSnapshot(
      message.playerId,
      message.phase,
      message.activeRoll
    );
    if (previousActiveTurnPlayerId && previousActiveTurnPlayerId !== message.playerId) {
      this.scheduleSpectatorPreviewClearForPlayer(previousActiveTurnPlayerId);
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

    this.scheduleSpectatorPreviewClearForPlayer(endedPlayerId);

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
    const autoStandReason =
      typeof message.reason === "string" &&
      (message.reason.includes("turn_timeout_stand") ||
        message.reason.includes("turn_timeout_auto_score_stand"));
    if (autoStandReason && playerId === this.localPlayerId) {
      notificationService.show(
        "Timed out twice. You were moved to observer lounge.",
        "warning",
        2600
      );
    }
    this.showSeatBubbleForPlayer(playerId, "Turn timed out", {
      tone: "warning",
      durationMs: 2000,
    });
    this.updateUI();
  }

  private handleMultiplayerTurnAction(message: MultiplayerTurnActionMessage): void {
    if (this.playMode !== "multiplayer" || !environment.features.multiplayer) {
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
    if (message.action === "roll" && message.roll) {
      this.syncSpectatorRollPreviewForPlayer(message.playerId, message.roll, {
        forceReplay: true,
      });
    }

    if (message.action === "select") {
      const selection = Array.isArray(message.select?.selectedDiceIds)
        ? message.select?.selectedDiceIds ?? []
        : [];
      const selectedDiceIds = selection.filter(
        (dieId): dieId is string => typeof dieId === "string" && dieId.trim().length > 0
      );
      this.diceRenderer.updateSpectatorSelectionPreview(spectatorPreviewKey, selectedDiceIds);
    }

    if (message.action === "score") {
      const scoreSelection = Array.isArray(message.score?.selectedDiceIds)
        ? message.score?.selectedDiceIds ?? []
        : [];
      const selectedDiceIds = scoreSelection.filter(
        (dieId): dieId is string => typeof dieId === "string" && dieId.trim().length > 0
      );
      if (selectedDiceIds.length > 0) {
        this.stageSpectatorScoreCommit(message.playerId, selectedDiceIds, seatScoreZone);
      } else {
        this.clearPendingSpectatorScoreCommit(message.playerId);
        if (seatScoreZone) {
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
        this.scheduleSpectatorPreviewClearForPlayer(message.playerId);
      }
    }

    const scoredPoints =
      message.action === "score" &&
      typeof message.score?.points === "number" &&
      Number.isFinite(message.score.points)
        ? Math.max(0, Math.floor(message.score.points))
        : null;
    const actionBubbleMessage = this.buildTurnActionBubbleMessage(message, scoredPoints);
    this.showSeatBubbleForPlayer(message.playerId, actionBubbleMessage, {
      tone:
        message.action === "score"
          ? resolveScoreFeedbackTone(scoredPoints ?? 0)
          : "info",
      durationMs: 1400,
    });
  }

  private buildTurnActionBubbleMessage(
    message: MultiplayerTurnActionMessage,
    scoredPoints: number | null
  ): string {
    const playerId = typeof message.playerId === "string" ? message.playerId.trim() : "";
    if (playerId && this.shouldShowDetailedDemoBotTurnAction(playerId)) {
      const detailedMessage = this.buildDetailedDemoBotTurnActionBubbleMessage(
        playerId,
        message,
        scoredPoints
      );
      if (detailedMessage) {
        return detailedMessage;
      }
    }

    if (message.action === "score") {
      return scoredPoints !== null ? `Scored (+${scoredPoints})` : "Scored";
    }
    if (message.action === "select") {
      return "Selected";
    }
    return "Rolled";
  }

  private shouldShowDetailedDemoBotTurnAction(playerId: string): boolean {
    const activeSession = this.multiplayerSessionService.getActiveSession();
    return (
      activeSession?.demoMode === true &&
      activeSession?.demoAutoRun !== false &&
      this.isBotParticipant(playerId)
    );
  }

  private buildDetailedDemoBotTurnActionBubbleMessage(
    playerId: string,
    message: MultiplayerTurnActionMessage,
    scoredPoints: number | null
  ): string | null {
    if (message.action === "roll") {
      const rollSummary = this.formatTurnRollDiceSummary(message.roll);
      return rollSummary ? `Roll ${rollSummary}` : "Rolled";
    }

    if (message.action === "score") {
      const selectedDiceIds = Array.isArray(message.score?.selectedDiceIds)
        ? message.score.selectedDiceIds.filter(
            (dieId): dieId is string => typeof dieId === "string" && dieId.trim().length > 0
          )
        : [];
      const selectedSummary = this.formatSelectedDiceSummary(playerId, selectedDiceIds);
      if (selectedSummary) {
        return scoredPoints !== null
          ? `Pick ${selectedSummary} (+${scoredPoints})`
          : `Pick ${selectedSummary}`;
      }
      if (selectedDiceIds.length > 0) {
        return scoredPoints !== null
          ? `Picked ${selectedDiceIds.length} (+${scoredPoints})`
          : `Picked ${selectedDiceIds.length}`;
      }
      return scoredPoints !== null ? `Scored (+${scoredPoints})` : "Scored";
    }

    if (message.action === "select") {
      const selectedDiceIds = Array.isArray(message.select?.selectedDiceIds)
        ? message.select.selectedDiceIds.filter(
            (dieId): dieId is string => typeof dieId === "string" && dieId.trim().length > 0
          )
        : [];
      const selectedSummary = this.formatSelectedDiceSummary(playerId, selectedDiceIds);
      if (selectedSummary) {
        return `Select ${selectedSummary}`;
      }
      if (selectedDiceIds.length > 0) {
        return `Selecting ${selectedDiceIds.length}`;
      }
      return "Selecting";
    }

    return null;
  }

  private formatTurnRollDiceSummary(
    roll: MultiplayerTurnActionMessage["roll"] | null | undefined
  ): string | null {
    if (!roll || !Array.isArray(roll.dice) || roll.dice.length === 0) {
      return null;
    }

    const sample = roll.dice
      .slice(0, 4)
      .map((die) => this.formatTurnDieLabel(die?.dieId, die?.sides, die?.value))
      .filter((value) => value.length > 0)
      .join(", ");
    const extraCount = Math.max(0, roll.dice.length - 4);
    const extraSuffix = extraCount > 0 ? ` +${extraCount}` : "";
    if (!sample) {
      return `${roll.dice.length} dice`;
    }
    return `${sample}${extraSuffix}`;
  }

  private formatSelectedDiceSummary(playerId: string, selectedDiceIds: string[]): string {
    if (!selectedDiceIds.length) {
      return "";
    }

    const rollSnapshot = this.spectatorRollSnapshotByPlayerId.get(playerId);
    const dieById = new Map<
      string,
      { sides: number | undefined; value: number | undefined }
    >();
    if (rollSnapshot && Array.isArray(rollSnapshot.dice)) {
      rollSnapshot.dice.forEach((die) => {
        const dieId = typeof die?.dieId === "string" ? die.dieId.trim() : "";
        if (!dieId) {
          return;
        }
        const numericSides = Number(die?.sides);
        const numericValue = Number(die?.value);
        dieById.set(dieId, {
          sides: Number.isFinite(numericSides) ? Math.floor(numericSides) : undefined,
          value: Number.isFinite(numericValue) ? Math.floor(numericValue) : undefined,
        });
      });
    }

    const labels = selectedDiceIds.map((dieId) => {
      const snapshot = dieById.get(dieId);
      return this.formatTurnDieLabel(dieId, snapshot?.sides, snapshot?.value);
    });
    const preview = labels.slice(0, 3).join(", ");
    const extraCount = Math.max(0, labels.length - 3);
    const extraSuffix = extraCount > 0 ? ` +${extraCount}` : "";
    return `${preview}${extraSuffix}`;
  }

  private formatTurnDieLabel(
    dieId: unknown,
    sides: unknown,
    value: unknown
  ): string {
    const normalizedDieId = typeof dieId === "string" ? dieId.trim() : "";
    const normalizedSides = Number.isFinite(sides)
      ? Math.max(2, Math.floor(sides as number))
      : this.resolveDieSidesFromId(normalizedDieId);
    const normalizedValue = Number.isFinite(value)
      ? Math.max(1, Math.floor(value as number))
      : null;
    if (normalizedSides !== null && normalizedValue !== null) {
      return `d${normalizedSides}=${normalizedValue}`;
    }
    if (normalizedSides !== null) {
      return `d${normalizedSides}`;
    }
    if (normalizedDieId) {
      return normalizedDieId;
    }
    return "die";
  }

  private resolveDieSidesFromId(dieId: string): number | null {
    if (!dieId) {
      return null;
    }

    const botStyleMatch = dieId.match(/-s(\d+)(?:-|$)/i);
    if (botStyleMatch) {
      const parsed = Number(botStyleMatch[1]);
      if (Number.isFinite(parsed) && parsed >= 2) {
        return Math.floor(parsed);
      }
    }

    const standardDieMatch = dieId.match(/^d(\d+)(?:-|$)/i);
    if (standardDieMatch) {
      const parsed = Number(standardDieMatch[1]);
      if (Number.isFinite(parsed) && parsed >= 2) {
        return Math.floor(parsed);
      }
    }

    return null;
  }

  private handleMultiplayerProtocolError(code: string, message?: string): void {
    const isChatOrInteractionError =
      code === "room_channel_sender_restricted" ||
      code === "room_channel_message_blocked" ||
      code === "room_channel_sender_muted" ||
      code === "room_channel_blocked" ||
      code === "room_channel_invalid_message" ||
      code === "interaction_blocked";
    if (!this.isMultiplayerTurnEnforced() && !isChatOrInteractionError) {
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

    if (code === "room_channel_sender_muted") {
      notificationService.show("Room chat is temporarily muted for your account.", "warning", 2400);
      return;
    }

    if (code === "room_channel_blocked") {
      notificationService.show("Message blocked by player privacy settings.", "warning", 2200);
      return;
    }

    if (code === "interaction_blocked") {
      notificationService.show("Interaction blocked by player privacy settings.", "warning", 2200);
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
      showDebugAuditNotification("Turn state unavailable. Resyncing...", {
        type: "warning",
        duration: 2000,
      });
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
      showDebugAuditNotification("Turn sync conflict. Wait for turn update.", {
        type: "warning",
        duration: 2000,
      });
      void this.requestTurnSyncRefresh("turn_action_invalid_phase");
      return;
    }

    if (code === "turn_action_invalid_score") {
      notificationService.show("Score validation failed. Re-roll this turn.", "warning", 2200);
      return;
    }

    if (code === "turn_action_invalid_payload") {
      this.awaitingMultiplayerRoll = false;
      showDebugAuditNotification("Turn payload rejected. Syncing...", {
        type: "warning",
        duration: 2200,
      });
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
    if (this.playMode === "multiplayer") {
      const localSeatState = this.getLocalMultiplayerSeatState();
      if (localSeatState && !localSeatState.isSeated) {
        this.hud.setTurnSyncStatus("ok", "Sit To Play");
        notificationService.show("Sit down to join the multiplayer game.", "info", 1800);
        return false;
      }
      if (localSeatState && !localSeatState.isReady) {
        this.hud.setTurnSyncStatus("ok", "Ready Up");
        notificationService.show("Tap Ready Up before taking a turn.", "info", 1800);
        return false;
      }
    }

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

  private recoverSpectatorTurnPreviewFromSnapshot(
    activePlayerId: string | null | undefined,
    phase: MultiplayerTurnPhase | undefined,
    activeRoll: MultiplayerTurnActionMessage["roll"] | null | undefined
  ): void {
    if (!this.isMultiplayerTurnEnforced()) {
      return;
    }

    const targetPlayerId = typeof activePlayerId === "string" ? activePlayerId.trim() : "";
    if (!targetPlayerId || targetPlayerId === this.localPlayerId) {
      return;
    }

    if (phase === "await_score") {
      this.syncSpectatorRollPreviewForPlayer(targetPlayerId, activeRoll);
      return;
    }

    if (phase === "ready_to_end") {
      if (!this.syncSpectatorRollPreviewForPlayer(targetPlayerId, activeRoll)) {
        this.scheduleSpectatorPreviewClearForPlayer(targetPlayerId);
      }
      return;
    }

    if (phase === "await_roll") {
      this.scheduleSpectatorPreviewClearForPlayer(targetPlayerId);
    }
  }

  private recoverSpectatorPreviewFromSessionTurnState(
    turnState: MultiplayerSessionRecord["turnState"] | null | undefined
  ): void {
    if (!turnState) {
      return;
    }

    this.recoverSpectatorTurnPreviewFromSnapshot(
      turnState.activeTurnPlayerId,
      turnState.phase,
      turnState.activeRoll
    );
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
    showDebugAuditNotification("Connection issue detected. Rejoining room...", {
      type: "info",
      duration: 2200,
      detail: reason,
    });

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
          showDebugAuditNotification("Reconnected to multiplayer room.", {
            type: "success",
            duration: 2400,
            detail: reason,
          });
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
      void this.returnToLobby({ skipDisruptionConfirm: true });
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
    this.clearScheduledSpectatorPreviewClear();
    this.clearPendingSpectatorScoreCommit();
    this.spectatorRollSnapshotByPlayerId.clear();
    this.spectatorRenderedRollKeyByPlayerId.clear();
    this.diceRenderer.cancelAllSpectatorPreviews();
    this.lastTurnPlanPreview = "";
    this.lastSessionComplete = false;
    this.hud.setTurnSyncStatus(null);
    this.multiplayerChatPanel?.clear();
    playerDataSyncService.setSessionId(undefined);
    this.clearSessionQueryParam();
    this.applySoloSeatState();
    this.updateInviteLinkControlVisibility();
    this.updateUI();
    notificationService.show("Continuing in solo mode.", "info", 2200);
  }

  private async returnToLobby(options?: { skipDisruptionConfirm?: boolean }): Promise<void> {
    if (this.lobbyRedirectInProgress) {
      return;
    }
    if (this.playMode === "multiplayer" && options?.skipDisruptionConfirm !== true) {
      const localSeatState = this.getLocalMultiplayerSeatState();
      const confirmed = await this.confirmDisruptiveSeatOrRoomExit("leave_room", localSeatState);
      if (!confirmed) {
        return;
      }
    }
    this.clearSelectionSyncDebounce();
    this.playerInteractions?.clear();
    this.multiplayerChatPanel?.clear();
    this.lobbyRedirectInProgress = true;
    this.sessionExpiryPromptActive = false;
    if (options?.skipDisruptionConfirm !== true) {
      this.announceLocalPresenceChange("left_room");
    }
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
    this.clearScheduledSpectatorPreviewClear();
    this.clearPendingSpectatorScoreCommit();
    this.spectatorRollSnapshotByPlayerId.clear();
    this.spectatorRenderedRollKeyByPlayerId.clear();
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
    const hasActiveMultiplayerSession =
      this.playMode === "multiplayer" &&
      typeof this.multiplayerSessionService.getActiveSession()?.sessionId === "string";
    const showInviteControl = hasActiveMultiplayerSession;
    const showRoomChatControl = hasActiveMultiplayerSession;
    if (this.inviteLinkBtn) {
      this.inviteLinkBtn.style.display = showInviteControl ? "flex" : "none";
    }
    if (this.roomChatBtn) {
      this.roomChatBtn.style.display = showRoomChatControl ? "flex" : "none";
    }
    if (this.mobileInviteLinkBtn) {
      this.mobileInviteLinkBtn.style.display = showInviteControl ? "flex" : "none";
    }
    if (this.mobileRoomChatBtn) {
      this.mobileRoomChatBtn.style.display = showRoomChatControl ? "flex" : "none";
    }
    if (!showRoomChatControl) {
      this.roomChatUnreadCount = 0;
      this.roomInteractionAlertCount = 0;
      this.roomChatIsOpen = false;
    }
    this.updateRoomChatNotificationBadge();
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
    this.multiplayerChatPanel?.openRoom();
  }

  openMultiplayerWhisperComposer(): void {
    if (!this.canComposeRoomChannelMessage()) {
      return;
    }
    this.multiplayerChatPanel?.openWhisper();
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
    this.hidePauseMenu();
    this.settingsModal.show({ preserveOpenModalIds: ["tutorial-modal"] });
    this.settingsModal.showTab(tab);
    this.updateUI();
  }

  private ensurePauseMenuModal(): void {
    if (this.pauseMenuModal) {
      return;
    }

    const modal = document.createElement("div");
    modal.id = "pause-menu-modal";
    modal.className = "modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content pause-menu-content">
        <div class="modal-header">
          <h2>Paused</h2>
          <button class="modal-close" type="button" aria-label="Resume">&times;</button>
        </div>
        <div class="pause-menu-body">
          <p class="pause-menu-description">Game paused. Choose what to do next.</p>
          <div class="pause-menu-actions">
            <button id="pause-menu-return-lobby-btn" class="btn btn-danger">Return To Lobby</button>
            <button id="pause-menu-settings-btn" class="btn btn-secondary">Settings</button>
            <button id="pause-menu-resume-btn" class="btn btn-primary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    const backdrop = modal.querySelector(".modal-backdrop");
    backdrop?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resumeFromPauseMenu();
    });

    const closeBtn = modal.querySelector<HTMLButtonElement>(".modal-close");
    closeBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resumeFromPauseMenu();
    });

    const resumeBtn = modal.querySelector<HTMLButtonElement>("#pause-menu-resume-btn");
    resumeBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resumeFromPauseMenu();
    });

    const settingsBtn = modal.querySelector<HTMLButtonElement>("#pause-menu-settings-btn");
    settingsBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.openSettingsFromPauseMenu();
    });

    const returnLobbyBtn = modal.querySelector<HTMLButtonElement>("#pause-menu-return-lobby-btn");
    returnLobbyBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hidePauseMenu();
      void this.handleReturnToLobbyRequest().then((didProceed) => {
        if (!didProceed) {
          this.openPauseMenu({ notify: false });
        }
      });
    });

    document.body.appendChild(modal);
    this.pauseMenuModal = modal;
  }

  private isPauseMenuVisible(): boolean {
    return this.pauseMenuModal?.style.display === "flex";
  }

  private hidePauseMenu(): void {
    if (!this.pauseMenuModal || this.pauseMenuModal.style.display === "none") {
      return;
    }
    this.pauseMenuModal.style.display = "none";
  }

  private openPauseMenu(options?: { notify?: boolean }): void {
    this.ensurePauseMenuModal();
    if (!this.pauseMenuModal) {
      return;
    }
    this.paused = true;
    this.pauseMenuModal.style.display = "flex";
    if (options?.notify !== false) {
      notificationService.show("Paused", "info");
    }
    const resumeBtn = this.pauseMenuModal.querySelector<HTMLButtonElement>("#pause-menu-resume-btn");
    resumeBtn?.focus();
    this.updateUI();
  }

  private resumeFromPauseMenu(): void {
    this.hidePauseMenu();
    if (this.paused) {
      this.paused = false;
    }
    notificationService.show("Resume!", "info");
    this.updateUI();
  }

  openSettingsModal(): void {
    const wasPaused = this.paused;
    this.paused = true;
    this.hidePauseMenu();
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
    if (!wasPaused) {
      notificationService.show("Paused", "info");
    }
    this.updateUI();
  }

  private openSettingsFromPauseMenu(): void {
    this.ensurePauseMenuModal();
    this.openSettingsModal();
  }

  handleEscapePauseMenu(): void {
    if (this.settingsModal.isVisible()) {
      this.suppressSettingsCloseResume = true;
      this.settingsModal.hide();
      this.openPauseMenu({ notify: false });
      return;
    }
    if (this.isPauseMenuVisible()) {
      this.resumeFromPauseMenu();
      return;
    }
    this.openPauseMenu();
  }

  togglePause(): void {
    this.paused = !this.paused;

    if (this.paused) {
      notificationService.show("Paused", "info");
      this.hidePauseMenu();
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
      this.hidePauseMenu();
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
    const playerChipRailEl = document.getElementById("multiplayer-player-chip-rail");
    const turnActionBannerEl = document.getElementById("turn-action-banner");
    const controlsEl = document.getElementById("controls");
    const cameraControlsEl = document.getElementById("camera-controls");
    const effectHudEl = document.getElementById("effect-hud");

    if (isDebugMode) {
      // Hide game UI
      if (hudEl) hudEl.style.display = "none";
      if (diceRowEl) diceRowEl.style.display = "none";
      if (playerChipRailEl) playerChipRailEl.style.display = "none";
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
      if (playerChipRailEl) {
        playerChipRailEl.style.display = this.playMode === "multiplayer" ? "flex" : "none";
      }
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

  handleSeatStatusToggle(): void {
    if (this.playMode !== "multiplayer") {
      notificationService.show("Seat status is available in multiplayer only.", "info", 1800);
      return;
    }
    if (this.participantStateUpdateInFlight) {
      return;
    }
    const localSeatState = this.getLocalMultiplayerSeatState();
    if (!localSeatState) {
      notificationService.show("No active multiplayer room found.", "warning", 2000);
      return;
    }

    const nextAction = this.resolveSeatToggleAction(localSeatState);
    void (async () => {
      if (nextAction === "stand") {
        const confirmed = await this.confirmDisruptiveSeatOrRoomExit("stand", localSeatState);
        if (!confirmed) {
          return;
        }
      }
      await this.updateLocalParticipantState(nextAction);
    })();
  }

  handleAction(): void {
    if (this.paused || this.animating) return;

    if (this.playMode === "multiplayer") {
      const localSeatState = this.getLocalMultiplayerSeatState();
      if (localSeatState?.isSeated && !localSeatState.isReady) {
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
    void this.handleReturnToLobbyRequest();
  }

  private async handleReturnToLobbyRequest(): Promise<boolean> {
    const confirmed = await confirmAction({
      title: t("settings.confirm.returnLobby.title"),
      message: t("settings.confirm.returnLobby.message"),
      confirmLabel: t("settings.confirm.returnLobby.confirm"),
      cancelLabel: t("settings.confirm.returnLobby.cancel"),
      tone: "danger",
    });
    if (!confirmed) {
      return false;
    }

    if (this.settingsModal.isVisible()) {
      this.suppressSettingsCloseResume = true;
      this.settingsModal.hide();
    }
    this.hidePauseMenu();
    await this.returnToLobby({ skipDisruptionConfirm: true });
    return true;
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

  private resolveChaosAbilityIdFromInput(rawValue: string): CameraAbilityId | null {
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized) {
      return "screen_shake";
    }
    if (normalized === "1" || normalized.includes("shake")) {
      return "screen_shake";
    }
    if (normalized === "2" || normalized.includes("drunk")) {
      return "drunk_vision";
    }
    if (normalized === "3" || normalized.includes("spin")) {
      return "camera_spin";
    }
    return null;
  }

  private sendChaosAttackToPlayer(targetPlayerId: string): void {
    if (this.playMode !== "multiplayer") {
      notificationService.show("Chaos interactions are multiplayer-only.", "warning", 1800);
      return;
    }
    if (!this.multiplayerNetwork?.isConnected()) {
      notificationService.show("Reconnect before sending chaos.", "warning", 1800);
      return;
    }
    const activeSession = this.multiplayerSessionService.getActiveSession();
    if (!activeSession?.sessionId) {
      notificationService.show("No active multiplayer room found.", "warning", 1800);
      return;
    }

    const rawChoice = window.prompt(
      "Chaos attack:\n1. Screen Shake\n2. Drunk Vision\n3. Camera Spin",
      "1"
    );
    if (rawChoice === null) {
      return;
    }
    const abilityId = this.resolveChaosAbilityIdFromInput(rawChoice);
    if (!abilityId) {
      notificationService.show("Chaos choice not recognized.", "warning", 1800);
      return;
    }

    const message = buildCameraAttackMessageFromProgression(abilityId, {
      gameId: activeSession.sessionId,
      attackerId: this.localPlayerId,
      targetId: targetPlayerId,
    });

    document.dispatchEvent(
      new CustomEvent<CameraAttackMessage>("chaos:cameraAttack:send", {
        detail: message,
      })
    );
  }

  private getActivePlayableDiceCount(): number {
    return this.state.dice.filter((die) => die.inPlay && !die.scored && die.value > 0).length;
  }

  private shouldShowDiceRowForCurrentTurn(activePlayableDiceCount: number): boolean {
    if (activePlayableDiceCount <= 0) {
      return false;
    }

    if (this.playMode === "multiplayer") {
      const localSeatState = this.getLocalMultiplayerSeatState();
      if (localSeatState && (!localSeatState.isSeated || !localSeatState.isReady)) {
        return false;
      }
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

    const localSeatState = this.getLocalMultiplayerSeatState();
    if (this.playMode === "multiplayer" && localSeatState) {
      if (!localSeatState.isSeated) {
        bannerEl.textContent = "Observer mode: use Seat toggle to sit down";
        bannerEl.dataset.tone = "info";
        bannerEl.classList.add("is-visible");
        bannerEl.classList.remove("is-urgent");
        return;
      }
      if (!localSeatState.isReady) {
        bannerEl.textContent = "Tap Ready Up to enter the turn queue";
        bannerEl.dataset.tone = "action";
        bannerEl.classList.add("is-visible", "is-urgent");
        return;
      }
    }

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
    this.updateProfileButtonAvatar();
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
    this.updateDemoControlButtons();

    const localSeatState = this.getLocalMultiplayerSeatState();
    const controlsEl = document.getElementById("controls");
    const showSeatStatusToggle = this.playMode === "multiplayer" && localSeatState !== null;
    controlsEl?.classList.toggle("has-seat-status-toggle", showSeatStatusToggle);
    if (this.seatStatusBtn) {
      this.seatStatusBtn.style.display = showSeatStatusToggle ? "inline-flex" : "none";
      if (!showSeatStatusToggle) {
        this.seatStatusBtn.disabled = true;
        this.seatStatusBtn.removeAttribute("data-seat-action");
      } else {
        const nextAction = this.resolveSeatToggleAction(localSeatState);
        const labelByAction: Record<typeof nextAction, string> = {
          sit: "Sit Down",
          stand: "Stand Up",
        };
        const titleByAction: Record<typeof nextAction, string> = {
          sit: "Sit down and join the active game queue",
          stand: "Stand up, leave queue, and observe the room",
        };
        this.seatStatusBtn.dataset.seatAction = nextAction;
        if (this.seatStatusBtnLabel) {
          this.seatStatusBtnLabel.textContent = labelByAction[nextAction];
        }
        this.seatStatusBtn.title = titleByAction[nextAction];
        this.seatStatusBtn.setAttribute("aria-label", titleByAction[nextAction]);
        this.seatStatusBtn.disabled =
          this.participantStateUpdateInFlight ||
          this.waitForNextGameRequestInFlight ||
          this.paused ||
          this.animating;
      }
    }

    const needsSitAction =
      this.playMode === "multiplayer" &&
      localSeatState !== null &&
      !localSeatState.isSeated;
    const needsReadyAction =
      this.playMode === "multiplayer" &&
      localSeatState !== null &&
      localSeatState.isSeated &&
      !localSeatState.isReady;
    const hasSelection = this.state.selected.size > 0;

    // Update multipurpose action button
    if (needsSitAction) {
      this.actionBtn.textContent = "Observer Mode";
      this.actionBtn.disabled = true;
      this.actionBtn.className = "btn btn-secondary secondary";
    } else if (needsReadyAction) {
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
  gameConfig?: UnifiedGameCreateConfig;
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
    gameConfig: options.gameConfig,
    multiplayer: options.multiplayer,
  });
}
