import { SplashScreen } from "./ui/splash.js";
import { LoadingScreen } from "./ui/loadingScreen.js";
import { notificationService } from "./ui/notifications.js";
import { themeManager } from "./services/themeManager.js";
import { settingsService } from "./services/settings.js";
import { getBrandLogoUrl } from "./services/assetUrl.js";
import { environment } from "@env";
import { logger } from "./utils/logger.js";
import { applyBrandMetadataToDocument } from "./config/brand.js";
import { applyTranslationsToDom, onLocaleChange, t } from "./i18n/index.js";
import type { SplashStartOptions } from "./ui/splash.js";
import { initializeFacebookShareMeta } from "./social/share/facebookShareMeta.js";

import type { SettingsModal } from "./ui/settings.js";
import type { LeaderboardModal } from "./ui/leaderboard.js";
import type { RulesModal } from "./ui/rules.js";
import type { TutorialModal } from "./ui/tutorial.js";
import type { AuthGateModal } from "./ui/authGate.js";
import type { ProfileModal } from "./ui/profile.js";
import type { AlphaWarningModal } from "./ui/alphaWarning.js";
import type { UpdatesPanel } from "./ui/updates.js";

type GameRuntimeModule = typeof import("./gameRuntime.js");
type FirebaseAuthService = typeof import("./services/firebaseAuth.js")["firebaseAuthService"];
type BackendApiService = typeof import("./services/backendApi.js")["backendApiService"];

const log = logger.create("MainShell");
const BOOT_MIN_VISIBLE_MS = 1100;
const BOOT_FINAL_HOLD_MS = 120;
const BOOT_PROGRESS_EASE = 0.18;
const BOOT_PROGRESS_MIN_STEP = 0.4;

let splash: SplashScreen;
let gameStarted = false;
let runtimeModulePromise: Promise<GameRuntimeModule> | null = null;
let authServicesPromise: Promise<{ backendApiService: BackendApiService; firebaseAuthService: FirebaseAuthService }> | null = null;
let bootLoadingScreen: LoadingScreen | null = new LoadingScreen();
let bootStartedAt = performance.now();
let bootProgressValue = 0;
let bootProgressTarget = 0;
let bootProgressRaf: number | null = null;

let settingsModalPromise: Promise<SettingsModal> | null = null;
let leaderboardModalPromise: Promise<LeaderboardModal> | null = null;
let rulesModalPromise: Promise<RulesModal> | null = null;
let tutorialModalPromise: Promise<TutorialModal> | null = null;
let authGateModalPromise: Promise<AuthGateModal> | null = null;
let profileModalPromise: Promise<ProfileModal> | null = null;
let alphaWarningModalPromise: Promise<AlphaWarningModal> | null = null;
let updatesPanelPromise: Promise<UpdatesPanel> | null = null;

const GUEST_MODE_KEY = `${environment.storage.prefix}-guest-mode-enabled`;
const FIREBASE_REAUTH_PROMPT_COOLDOWN_MS = 15000;
let firebaseReauthPromptInFlight = false;
let lastFirebaseReauthPromptAt = 0;

registerAuthSessionHandlers();
hydrateBrandAssets();
applyBrandMetadataToDocument();
initializeFacebookShareMeta();
applyTranslationsToDom();
onLocaleChange(() => {
  applyTranslationsToDom();
});
applyMobileDiceLayoutPreference(settingsService.getSettings().controls.mobileDiceLayout);
settingsService.onChange((settings) => {
  applyMobileDiceLayoutPreference(settings.controls.mobileDiceLayout);
});

bootLoadingScreen.show();
setBootStatus(t("main.boot.loadingThemeCatalog"), 8);

void themeManager
  .initialize()
  .then(() => {
    log.info("Theme manager initialized successfully");
    void initializeShellUi();
  })
  .catch((error) => {
    log.error("Failed to initialize theme manager:", error);
    void initializeShellUi();
  });

async function initializeShellUi(): Promise<void> {
  setBootStatus(t("main.boot.preparingMainMenu"), 18);

  splash = new SplashScreen(
    (startOptions) => startGame(startOptions),
    () => {
      void showSettings();
    },
    () => {
      void showLeaderboard();
    },
    () => {
      void showRules();
    }
  );

  try {
    setBootStatus(t("main.boot.loadingFloatingDice"), 36);
    await splash.prepareBackground((status) => {
      const normalized = status.toLowerCase();
      if (normalized.includes("initializing")) {
        setBootStatus(t("main.boot.starting3dMenu"), 50);
        return;
      }
      if (normalized.includes("assets")) {
        setBootStatus(t("main.boot.loadingDiceAssets"), 64);
        return;
      }
      if (normalized.includes("spawning")) {
        setBootStatus(t("main.boot.summoningFloatingDice"), 76);
        return;
      }
      if (normalized.includes("animating")) {
        setBootStatus(t("main.boot.finalizingMenu"), 84);
        return;
      }
      setBootStatus(status, 58);
    });

    setBootStatus(t("main.boot.checkingUpdates"), 90);
    await getUpdatesPanel();
    void maybeShowAlphaWarning();
  } catch (error) {
    log.warn("Shell initialization encountered an error", error);
  } finally {
    await completeBootLoading();
    void maybeAutoStartFromMultiplayerInvite();
  }
}

async function startGame(startOptions: SplashStartOptions): Promise<boolean> {
  const { firebaseAuthService } = await getAuthServices();
  await firebaseAuthService.initialize();

  const canStart = await ensurePlayerAccessChoice(firebaseAuthService);
  if (!canStart) {
    return false;
  }

  if (gameStarted) {
    return true;
  }

  let resolvedStartOptions = startOptions;
  if (startOptions.forceTutorialReplay) {
    settingsService.updateGame({ showTutorial: true });
    resolvedStartOptions = {
      playMode: "solo",
      forceTutorialReplay: true,
    };
  }

  try {
    const [settingsModal, leaderboardModal, rulesModal, tutorialModal, profileModal, runtime] = await Promise.all([
      getSettingsModal(),
      getLeaderboardModal(),
      getRulesModal(),
      getTutorialModal(),
      getProfileModal(),
      loadGameRuntime(),
    ]);

    runtime.startGameRuntime({
      settingsModal,
      leaderboardModal,
      rulesModal,
      tutorialModal,
      profileModal,
      playMode: resolvedStartOptions.playMode,
      multiplayer: resolvedStartOptions.multiplayer,
    });

    gameStarted = true;
    return true;
  } catch (error) {
    log.error("Failed to load game runtime:", error);
    notificationService.show(t("main.error.loadGameEngine"), "error", 3200);
    return false;
  }
}

function normalizeInviteRoomCode(rawValue: string | null | undefined): string {
  if (typeof rawValue !== "string") {
    return "";
  }
  return rawValue.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
}

function resolveInviteAutostartOptions():
  | {
      sessionId?: string;
      roomCode?: string;
    }
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const query = new URLSearchParams(window.location.search);
  const sessionId = query.get("session")?.trim() ?? "";
  const roomCode = normalizeInviteRoomCode(query.get("room"));
  if (!sessionId && !roomCode) {
    return null;
  }

  return {
    sessionId: sessionId || undefined,
    roomCode: roomCode || undefined,
  };
}

async function maybeAutoStartFromMultiplayerInvite(): Promise<void> {
  if (gameStarted) {
    return;
  }

  const invite = resolveInviteAutostartOptions();
  if (!invite) {
    return;
  }

  const inviteLabel = invite.roomCode ?? invite.sessionId ?? t("main.multiplayer.roomFallback");
  notificationService.show(t("main.multiplayer.rejoining", { room: inviteLabel }), "info", 2200);
  const { firebaseAuthService } = await getAuthServices();
  await firebaseAuthService.initialize();
  if (!firebaseAuthService.isAuthenticated()) {
    setGuestModeEnabled(false);
  }
  const started = await startGame({
    playMode: "multiplayer",
    multiplayer: {
      botCount: 0,
      sessionId: invite.sessionId,
      roomCode: invite.roomCode,
    },
  });
  if (started) {
    splash.hide();
  }
}

function hydrateBrandAssets(): void {
  const miniLogo = document.getElementById("stats-mini-logo") as HTMLImageElement | null;
  if (miniLogo) {
    miniLogo.src = getBrandLogoUrl();
  }
}

function applyMobileDiceLayoutPreference(layout: "wrapped" | "single-row" | "perimeter"): void {
  document.body.dataset.mobileDiceLayout = layout;
}

function loadGameRuntime(): Promise<GameRuntimeModule> {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import("./gameRuntime.js");
  }
  return runtimeModulePromise;
}

async function getAuthServices(): Promise<{
  backendApiService: BackendApiService;
  firebaseAuthService: FirebaseAuthService;
}> {
  if (!authServicesPromise) {
    authServicesPromise = Promise.all([
      import("./services/backendApi.js"),
      import("./services/firebaseAuth.js"),
    ]).then(([backendModule, firebaseModule]) => {
      const backendApiService = backendModule.backendApiService;
      const firebaseAuthService = firebaseModule.firebaseAuthService;

      backendApiService.setFirebaseTokenProvider(() => firebaseAuthService.getIdToken());

      return {
        backendApiService,
        firebaseAuthService,
      };
    });
  }

  return authServicesPromise;
}

async function showSettings(): Promise<void> {
  const modal = await getSettingsModal();
  modal.show();
}

async function showLeaderboard(): Promise<void> {
  const modal = await getLeaderboardModal();
  modal.show();
}

async function showRules(): Promise<void> {
  const modal = await getRulesModal();
  modal.show();
}

async function getSettingsModal(): Promise<SettingsModal> {
  if (!settingsModalPromise) {
    settingsModalPromise = import("./ui/settings.js").then(
      ({ SettingsModal }) => new SettingsModal()
    );
  }

  return settingsModalPromise;
}

async function getLeaderboardModal(): Promise<LeaderboardModal> {
  if (!leaderboardModalPromise) {
    leaderboardModalPromise = import("./ui/leaderboard.js").then(
      ({ LeaderboardModal }) => new LeaderboardModal()
    );
  }

  return leaderboardModalPromise;
}

async function getRulesModal(): Promise<RulesModal> {
  if (!rulesModalPromise) {
    rulesModalPromise = import("./ui/rules.js").then(({ RulesModal }) => new RulesModal());
  }

  return rulesModalPromise;
}

async function getTutorialModal(): Promise<TutorialModal> {
  if (!tutorialModalPromise) {
    tutorialModalPromise = import("./ui/tutorial.js").then(
      ({ TutorialModal }) => new TutorialModal()
    );
  }

  return tutorialModalPromise;
}

async function getAuthGateModal(): Promise<AuthGateModal> {
  if (!authGateModalPromise) {
    authGateModalPromise = import("./ui/authGate.js").then(
      ({ AuthGateModal }) => new AuthGateModal()
    );
  }

  return authGateModalPromise;
}

async function getProfileModal(): Promise<ProfileModal> {
  if (!profileModalPromise) {
    profileModalPromise = import("./ui/profile.js").then(({ ProfileModal }) => new ProfileModal());
  }

  return profileModalPromise;
}

async function getAlphaWarningModal(): Promise<AlphaWarningModal> {
  if (!alphaWarningModalPromise) {
    alphaWarningModalPromise = import("./ui/alphaWarning.js").then(
      ({ AlphaWarningModal }) => new AlphaWarningModal()
    );
  }

  return alphaWarningModalPromise;
}

async function getUpdatesPanel(): Promise<UpdatesPanel> {
  if (!updatesPanelPromise) {
    updatesPanelPromise = import("./ui/updates.js").then(({ UpdatesPanel }) => new UpdatesPanel());
  }

  return updatesPanelPromise;
}

async function maybeShowAlphaWarning(): Promise<void> {
  const { AlphaWarningModal } = await import("./ui/alphaWarning.js");
  if (AlphaWarningModal.hasSeenWarning()) {
    return;
  }

  const modal = await getAlphaWarningModal();
  setTimeout(() => {
    modal.show();
  }, 1000);
}

function registerAuthSessionHandlers(): void {
  if (typeof document === "undefined") {
    return;
  }

  document.addEventListener("auth:firebaseSessionExpired", ((event: Event) => {
    const detail = (event as CustomEvent<{ reason?: string; path?: string }>).detail;
    void promptForFirebaseReauth(detail?.reason);
  }) as EventListener);
}

async function promptForFirebaseReauth(reason?: string): Promise<void> {
  const now = Date.now();
  if (
    firebaseReauthPromptInFlight ||
    (lastFirebaseReauthPromptAt > 0 &&
      now - lastFirebaseReauthPromptAt < FIREBASE_REAUTH_PROMPT_COOLDOWN_MS)
  ) {
    return;
  }

  firebaseReauthPromptInFlight = true;
  lastFirebaseReauthPromptAt = now;

  try {
    const { firebaseAuthService } = await getAuthServices();
    await firebaseAuthService.initialize();
    if (firebaseAuthService.isAuthenticated()) {
      return;
    }

    notificationService.show(
      t("main.auth.sessionExpired", { reason: reason ? ` (${reason})` : "" }),
      "warning",
      3200
    );

    const authGateModal = await getAuthGateModal();
    const choice = await authGateModal.prompt();
    if (choice === "google") {
      const signedIn = await firebaseAuthService.signInWithGoogle();
      if (signedIn) {
        setGuestModeEnabled(false);
        notificationService.show(t("main.auth.signInSuccess"), "success", 2200);
      }
      return;
    }

    if (choice === "guest") {
      setGuestModeEnabled(true);
      notificationService.show(t("main.auth.continueGuest"), "info", 2400);
    }
  } finally {
    firebaseReauthPromptInFlight = false;
  }
}

async function ensurePlayerAccessChoice(firebaseAuthService: FirebaseAuthService): Promise<boolean> {
  const existing = firebaseAuthService.getCurrentUserProfile();
  if (existing && !existing.isAnonymous) {
    setGuestModeEnabled(false);
    return true;
  }

  if (isGuestModeEnabled()) {
    return true;
  }

  const authGateModal = await getAuthGateModal();
  const choice = await authGateModal.prompt();
  if (choice === "cancel") {
    return false;
  }

  if (choice === "guest") {
    setGuestModeEnabled(true);
    notificationService.show(t("main.auth.guestModeEnabled"), "info", 2600);
    return true;
  }

  const signedIn = await firebaseAuthService.signInWithGoogle();
  if (!signedIn) {
    notificationService.show(t("main.auth.googleSignInFailed"), "warning", 2800);
    return false;
  }

  setGuestModeEnabled(false);
  return true;
}

function isGuestModeEnabled(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }

  try {
    return localStorage.getItem(GUEST_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function setGuestModeEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    if (enabled) {
      localStorage.setItem(GUEST_MODE_KEY, "1");
    } else {
      localStorage.removeItem(GUEST_MODE_KEY);
    }
  } catch {
    // no-op
  }
}

function setBootStatus(message: string, progress?: number): void {
  bootLoadingScreen?.setStatus(message);
  if (typeof progress === "number") {
    bootProgressTarget = Math.max(
      bootProgressTarget,
      Math.max(0, Math.min(100, progress))
    );
    scheduleBootProgressAnimation();
  }
}

async function completeBootLoading(): Promise<void> {
  setBootStatus(t("main.boot.ready"), 100);
  await waitForBootProgress(99, 1000);

  const elapsed = performance.now() - bootStartedAt;
  if (elapsed < BOOT_MIN_VISIBLE_MS) {
    await sleep(BOOT_MIN_VISIBLE_MS - elapsed);
  }

  await sleep(BOOT_FINAL_HOLD_MS);
  hideBootLoadingScreen();
}

function hideBootLoadingScreen(): void {
  if (!bootLoadingScreen) {
    return;
  }

  if (bootProgressRaf !== null) {
    window.cancelAnimationFrame(bootProgressRaf);
    bootProgressRaf = null;
  }

  const loading = bootLoadingScreen;
  bootLoadingScreen = null;
  loading.hide();
}

function scheduleBootProgressAnimation(): void {
  if (!bootLoadingScreen || bootProgressRaf !== null) {
    return;
  }

  bootProgressRaf = window.requestAnimationFrame(() => {
    bootProgressRaf = null;
    if (!bootLoadingScreen) {
      return;
    }

    const delta = bootProgressTarget - bootProgressValue;
    if (delta <= 0.05) {
      bootProgressValue = bootProgressTarget;
      bootLoadingScreen.setProgress(bootProgressValue);
      return;
    }

    const step = Math.max(BOOT_PROGRESS_MIN_STEP, delta * BOOT_PROGRESS_EASE);
    bootProgressValue = Math.min(bootProgressTarget, bootProgressValue + step);
    bootLoadingScreen.setProgress(bootProgressValue);
    scheduleBootProgressAnimation();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForBootProgress(target: number, timeoutMs: number): Promise<void> {
  const timeoutAt = performance.now() + timeoutMs;
  while (bootProgressValue < target && performance.now() < timeoutAt) {
    await sleep(16);
  }
}
