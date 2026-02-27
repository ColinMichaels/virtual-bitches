/**
 * Splash Screen
 * Home screen with lazily loaded floating-dice background.
 */

import { audioService } from "../services/audio.js";
import { logger } from "../utils/logger.js";
import type { MultiplayerRoomListing } from "../services/backendApi.js";
import type { SplashBackground3D } from "./splashBackground3d.js";
import { getLocalPlayerId } from "../services/playerIdentity.js";
import { getBrandLogoUrl } from "../services/assetUrl.js";
import { gameBrand } from "../config/brand.js";
import { getLocale, setLocale, t, type LocaleCode } from "../i18n/index.js";
import { confirmAction } from "./confirmModal.js";

const log = logger.create("SplashScreen");

export type SplashPlayMode = "solo" | "multiplayer";

export interface SplashStartOptions {
  playMode: SplashPlayMode;
  forceTutorialReplay?: boolean;
  multiplayer?: {
    botCount: number;
    joinBotCount?: number;
    sessionId?: string;
    roomCode?: string;
  };
}

export class SplashScreen {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private background3d: SplashBackground3D | null = null;
  private backgroundLoadPromise: Promise<void> | null = null;
  private playMode: SplashPlayMode = "solo";
  private botCount = 1;
  private joinBotCount = 1;
  private seedBotsOnJoin = false;
  private roomList: MultiplayerRoomListing[] = [];
  private selectedRoomSessionId: string | null = null;
  private privateRoomCode = "";
  private roomCodeJoinInFlight = false;
  private readonly logoUrl = getBrandLogoUrl();
  private roomCodeFeedback:
    | {
        tone: "info" | "success" | "error";
        message: string;
      }
    | null = null;
  private roomListLoading = false;
  gameTitle = gameBrand.productName;

  constructor(
    onStart: (options: SplashStartOptions) => boolean | Promise<boolean>,
    onSettings: () => void,
    onLeaderboard: () => void,
    onRules: () => void
  ) {
    this.container = document.createElement("div");
    this.container.id = "splash-screen";
    this.container.innerHTML = `
      <canvas id="splash-canvas" aria-hidden="true"></canvas>
      <div class="splash-content">
        <div class="splash-logo-wrap">
          <img class="splash-logo" src="${this.logoUrl}" alt="${this.gameTitle}" />
        </div>
        <p class="splash-subtitle">${t("splash.subtitle")}</p>
        <p class="splash-tagline">${t("splash.tagline")}</p>
        <div class="splash-language-picker">
          <label for="splash-language-select">${t("splash.language.label")}</label>
          <select id="splash-language-select" class="language-select" aria-label="${t("splash.language.label")}">
            <option value="en-US" ${getLocale() === "en-US" ? "selected" : ""}>${this.getLocaleOptionLabel("en-US")}</option>
            <option value="es-ES" ${getLocale() === "es-ES" ? "selected" : ""}>${this.getLocaleOptionLabel("es-ES")}</option>
          </select>
        </div>
        <div class="splash-mode-picker" role="radiogroup" aria-label="${t("splash.playModeAria")}">
          <button
            type="button"
            class="splash-mode-btn active"
            data-play-mode="solo"
            role="radio"
            aria-checked="true"
          >
            ${t("splash.mode.solo")}
          </button>
          <button
            type="button"
            class="splash-mode-btn"
            data-play-mode="multiplayer"
            role="radio"
            aria-checked="false"
          >
            ${t("splash.mode.multiplayer")}
          </button>
        </div>
        <div id="splash-multiplayer-options" class="splash-multiplayer-options" style="display: none;">
          <label for="splash-bot-count">${t("splash.multiplayer.createRoomBots")}</label>
          <select id="splash-bot-count">
            <option value="0">${t("splash.multiplayer.botOption.none")}</option>
            <option value="1" selected>${t("splash.multiplayer.botOption.1")}</option>
            <option value="2">${t("splash.multiplayer.botOption.2")}</option>
            <option value="3">${t("splash.multiplayer.botOption.3")}</option>
          </select>
          <div class="splash-bot-seed-toggle">
            <label for="splash-seed-join-bots">
              <input id="splash-seed-join-bots" type="checkbox" />
              ${t("splash.multiplayer.seedBotsOnJoin")}
            </label>
          </div>
          <label for="splash-join-bot-count">${t("splash.multiplayer.joinBotSeedCount")}</label>
          <select id="splash-join-bot-count" disabled>
            <option value="1" selected>${t("splash.multiplayer.botOption.1")}</option>
            <option value="2">${t("splash.multiplayer.botOption.2")}</option>
            <option value="3">${t("splash.multiplayer.botOption.3")}</option>
            <option value="4">${t("splash.multiplayer.botOption.4")}</option>
          </select>
          <p class="splash-join-bot-seed-note">
            ${t("splash.multiplayer.joinBotSeedNote")}
          </p>
          <label for="splash-room-select">${t("splash.multiplayer.joinExistingRoom")}</label>
          <div class="splash-room-picker">
            <select id="splash-room-select">
              <option value="">${t("splash.multiplayer.createPrivateRoom")}</option>
            </select>
            <button type="button" id="splash-room-refresh" class="btn btn-secondary secondary">${t("splash.multiplayer.refreshRooms")}</button>
          </div>
          <label for="splash-room-code">${t("splash.multiplayer.joinByInviteCode")}</label>
          <div class="splash-room-code-actions">
            <input
              id="splash-room-code"
              type="text"
              inputmode="text"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              placeholder="${t("splash.multiplayer.roomCodePlaceholder")}"
              maxlength="8"
              aria-describedby="splash-room-code-error"
            />
            <button type="button" id="splash-room-code-join" class="btn btn-primary primary">${t("splash.multiplayer.joinCode")}</button>
          </div>
          <p id="splash-room-code-error" class="splash-room-code-error" style="display: none;"></p>
          <p id="splash-room-status">${t("splash.multiplayer.status.noActivePublicRooms")}</p>
          <p>${t("splash.multiplayer.pickLobbyHint")}</p>
        </div>
        <div class="splash-buttons">
          <button id="start-game-btn" class="btn btn-primary primary splash-btn">${t("splash.button.startGame")}</button>
          <button id="splash-rules-btn" class="btn btn-secondary splash-btn">${t("splash.button.howToPlay")}</button>
          <button id="splash-leaderboard-btn" class="btn btn-secondary splash-btn">${t("splash.button.leaderboard")}</button>
          <button id="splash-settings-btn" class="btn btn-secondary splash-btn">${t("splash.button.settings")}</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    document.body.classList.add("splash-active");
    this.canvas = this.container.querySelector("#splash-canvas") as HTMLCanvasElement;

    this.container.querySelectorAll<HTMLElement>("[data-play-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.playMode === "multiplayer" ? "multiplayer" : "solo";
        this.playMode = mode;
        this.syncPlayModeUi();
      });
    });

    const botCountSelect = this.container.querySelector<HTMLSelectElement>("#splash-bot-count");
    botCountSelect?.addEventListener("change", () => {
      const parsed = Number(botCountSelect.value);
      this.botCount = Number.isFinite(parsed) ? Math.max(0, Math.min(3, Math.floor(parsed))) : 0;
    });
    const seedBotsOnJoinCheckbox =
      this.container.querySelector<HTMLInputElement>("#splash-seed-join-bots");
    const joinBotCountSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-join-bot-count");
    seedBotsOnJoinCheckbox?.addEventListener("change", () => {
      this.seedBotsOnJoin = seedBotsOnJoinCheckbox.checked === true;
      this.updateJoinBotSeedUi();
      this.updateRoomStatus();
    });
    joinBotCountSelect?.addEventListener("change", () => {
      const parsed = Number(joinBotCountSelect.value);
      this.joinBotCount = Number.isFinite(parsed) ? Math.max(1, Math.min(4, Math.floor(parsed))) : 1;
      this.updateRoomStatus();
    });

    const roomSelect = this.container.querySelector<HTMLSelectElement>("#splash-room-select");
    const roomCodeInput = this.container.querySelector<HTMLInputElement>("#splash-room-code");
    const roomCodeJoinButton = this.container.querySelector<HTMLButtonElement>("#splash-room-code-join");
    roomSelect?.addEventListener("change", () => {
      const selected = roomSelect.value.trim();
      this.selectedRoomSessionId = selected.length > 0 ? selected : null;
      if (this.selectedRoomSessionId && roomCodeInput) {
        this.privateRoomCode = "";
        roomCodeInput.value = "";
      }
      this.clearRoomCodeFeedback();
      this.updateRoomCodeValidationUi();
      this.updateRoomStatus();
    });
    roomCodeInput?.addEventListener("input", () => {
      const normalized = this.normalizeRoomCode(roomCodeInput.value);
      this.privateRoomCode = normalized;
      roomCodeInput.value = normalized;
      if (normalized.length > 0) {
        this.selectedRoomSessionId = null;
        if (roomSelect) {
          roomSelect.value = "";
        }
      }
      this.clearRoomCodeFeedback();
      this.updateRoomCodeValidationUi();
      this.updateRoomStatus();
    });
    roomCodeInput?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      if (roomCodeJoinButton?.disabled) {
        return;
      }
      audioService.playSfx("click");
      this.playMode = "multiplayer";
      this.syncPlayModeUi();
      void this.handleJoinCodeQuickAction(attemptStart);
    });

    const refreshButton = this.container.querySelector<HTMLButtonElement>("#splash-room-refresh");
    refreshButton?.addEventListener("click", () => {
      audioService.playSfx("click");
      void this.refreshRoomList(true);
    });

    const startButton = this.container.querySelector<HTMLButtonElement>("#start-game-btn");
    const languageSelect = this.container.querySelector<HTMLSelectElement>("#splash-language-select");
    languageSelect?.addEventListener("change", () => {
      void this.handleLanguageSelectionChange(languageSelect);
    });
    const attemptStart = async (options: SplashStartOptions): Promise<boolean> => {
      if (startButton?.disabled) {
        return false;
      }

      if (startButton) {
        startButton.disabled = true;
      }

      try {
        const shouldStart = await Promise.resolve(onStart(options));
        if (!shouldStart) {
          return false;
        }
        this.hide();
        return true;
      } finally {
        if (startButton) {
          startButton.disabled = false;
        }
        this.updateRoomCodeValidationUi();
      }
    };

    startButton?.addEventListener("click", () => {
      const roomCodeValidationError =
        this.playMode === "multiplayer"
          ? this.getRoomCodeValidationError(this.privateRoomCode)
          : null;
      if (roomCodeValidationError) {
        this.setRoomCodeFeedback(roomCodeValidationError, "error");
        this.updateRoomCodeValidationUi();
        return;
      }
      audioService.playSfx("click");
      void attemptStart({
        playMode: this.playMode,
        multiplayer:
          this.playMode === "multiplayer"
            ? {
                botCount: this.botCount,
                joinBotCount: this.getJoinBotSeedCount(),
                sessionId: this.selectedRoomSessionId ?? undefined,
                roomCode: this.privateRoomCode || undefined,
              }
            : undefined,
      });
    });
    roomCodeJoinButton?.addEventListener("click", () => {
      if (roomCodeJoinButton.disabled) {
        return;
      }
      audioService.playSfx("click");
      this.playMode = "multiplayer";
      this.syncPlayModeUi();
      void this.handleJoinCodeQuickAction(attemptStart);
    });

    document.getElementById("splash-rules-btn")?.addEventListener("click", () => {
      audioService.playSfx("click");
      onRules();
    });

    document.getElementById("splash-leaderboard-btn")?.addEventListener("click", () => {
      audioService.playSfx("click");
      onLeaderboard();
    });

    document.getElementById("splash-settings-btn")?.addEventListener("click", () => {
      audioService.playSfx("click");
      onSettings();
    });

    this.syncPlayModeUi();
  }

  async prepareBackground(onStatus?: (message: string) => void): Promise<void> {
    if (this.backgroundLoadPromise) {
      return this.backgroundLoadPromise;
    }

    this.backgroundLoadPromise = (async () => {
      try {
        onStatus?.(t("main.boot.loadingFloatingDice"));
        const module = await import("./splashBackground3d.js");
        this.background3d = new module.SplashBackground3D(this.canvas);
        await this.background3d.initialize(onStatus);
      } catch (error) {
        log.warn("Failed to initialize splash background", error);
        this.backgroundLoadPromise = null;
      }
    })();

    return this.backgroundLoadPromise;
  }

  show(): void {
    document.body.classList.add("splash-active");
    this.container.style.display = "flex";
    this.background3d?.start();

    if (!this.background3d) {
      void this.prepareBackground();
    }
  }

  hide(): void {
    this.container.classList.add("fade-out");
    this.background3d?.stop();

    setTimeout(() => {
      this.container.style.display = "none";
      document.body.classList.remove("splash-active");
      this.background3d?.dispose();
      this.background3d = null;
      this.backgroundLoadPromise = null;
    }, 500);
  }

  dispose(): void {
    document.body.classList.remove("splash-active");
    this.background3d?.dispose();
    this.background3d = null;
    this.backgroundLoadPromise = null;
    this.container.remove();
  }

  private syncPlayModeUi(): void {
    const modeButtons = this.container.querySelectorAll<HTMLElement>("[data-play-mode]");
    modeButtons.forEach((button) => {
      const isActive = button.dataset.playMode === this.playMode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-checked", isActive ? "true" : "false");
    });

    const multiplayerOptions = this.container.querySelector<HTMLElement>("#splash-multiplayer-options");
    if (multiplayerOptions) {
      multiplayerOptions.style.display = this.playMode === "multiplayer" ? "flex" : "none";
    }

    if (this.playMode === "multiplayer") {
      void this.refreshRoomList(false);
    }
    this.updateJoinBotSeedUi();
    this.updateRoomCodeValidationUi();
  }

  private updateRoomStatus(): void {
    const statusEl = this.container.querySelector<HTMLElement>("#splash-room-status");
    if (!statusEl) {
      return;
    }
    if (this.roomListLoading) {
      statusEl.textContent = t("splash.multiplayer.status.refreshingRooms");
      return;
    }
    if (this.privateRoomCode) {
      const roomCodeValidationError = this.getRoomCodeValidationError(this.privateRoomCode);
      if (roomCodeValidationError) {
        statusEl.textContent = t("splash.multiplayer.status.inviteCodeValidation");
        return;
      }
      const joinSeedNote = this.getJoinBotSeedStatusNote();
      statusEl.textContent = joinSeedNote
        ? t("splash.multiplayer.status.joiningPrivateWithNote", {
            roomCode: this.privateRoomCode,
            note: joinSeedNote,
          })
        : t("splash.multiplayer.status.joiningPrivate", {
            roomCode: this.privateRoomCode,
          });
      return;
    }
    if (this.selectedRoomSessionId) {
      const selected = this.roomList.find((room) => room.sessionId === this.selectedRoomSessionId);
      if (selected) {
        const expiresInMinutes = Math.max(1, Math.ceil((selected.expiresAt - Date.now()) / 60000));
        const maxPlayers =
          typeof selected.maxHumanCount === "number" && Number.isFinite(selected.maxHumanCount)
            ? Math.max(1, Math.floor(selected.maxHumanCount))
            : 8;
        const availableSlots =
          typeof selected.availableHumanSlots === "number" && Number.isFinite(selected.availableHumanSlots)
            ? Math.max(0, Math.floor(selected.availableHumanSlots))
            : Math.max(0, maxPlayers - selected.humanCount);
        const joinability =
          availableSlots > 0
            ? t("splash.multiplayer.joinability.openSeats", { count: availableSlots })
            : t("splash.multiplayer.joinability.full");
        statusEl.textContent =
          availableSlots > 0
            ? t("splash.multiplayer.status.joiningRoomOpen", {
                roomCode: selected.roomCode,
                joinability,
                expiresMinutes: expiresInMinutes,
                note: this.getJoinBotSeedStatusNote(true),
              })
            : t("splash.multiplayer.status.joiningRoomFull", {
                roomCode: selected.roomCode,
                joinability,
              });
        return;
      }
    }
    if (this.roomList.length === 0) {
      statusEl.textContent = t("splash.multiplayer.status.noActivePublicRooms");
      return;
    }
    const joinSeedNote = this.getJoinBotSeedStatusNote();
    statusEl.textContent = joinSeedNote
      ? t("splash.multiplayer.status.selectPublicRoomWithNote", {
          note: joinSeedNote,
        })
      : t("splash.multiplayer.status.selectPublicRoom");
  }

  private async refreshRoomList(force: boolean): Promise<void> {
    if (this.playMode !== "multiplayer") {
      return;
    }
    if (this.roomListLoading) {
      return;
    }
    if (!force && this.roomList.length > 0) {
      this.updateRoomStatus();
      return;
    }

    const roomSelect = this.container.querySelector<HTMLSelectElement>("#splash-room-select");
    const refreshButton = this.container.querySelector<HTMLButtonElement>("#splash-room-refresh");
    this.roomListLoading = true;
    if (refreshButton) {
      refreshButton.disabled = true;
    }
    this.updateRoomStatus();

    try {
      const { backendApiService } = await import("../services/backendApi.js");
      const rooms = await backendApiService.listMultiplayerRooms(24);
      this.roomList = Array.isArray(rooms) ? rooms : [];
      if (!roomSelect) {
        return;
      }

      const priorSelection = this.selectedRoomSessionId;
      roomSelect.innerHTML = "";
      const createOption = document.createElement("option");
      createOption.value = "";
      createOption.textContent = t("splash.multiplayer.createPrivateRoom");
      roomSelect.appendChild(createOption);

      this.roomList.forEach((room) => {
        const option = document.createElement("option");
        option.value = room.sessionId;
        const maxPlayers =
          typeof room.maxHumanCount === "number" && Number.isFinite(room.maxHumanCount)
            ? Math.max(1, Math.floor(room.maxHumanCount))
            : 8;
        const availableSlots =
          typeof room.availableHumanSlots === "number" && Number.isFinite(room.availableHumanSlots)
            ? Math.max(0, Math.floor(room.availableHumanSlots))
            : Math.max(0, maxPlayers - room.humanCount);
        const roomFlavor =
          room.roomType === "public_default"
            ? t("splash.multiplayer.roomFlavor.lobby")
            : room.roomType === "public_overflow"
              ? t("splash.multiplayer.roomFlavor.overflow")
              : t("splash.multiplayer.roomFlavor.custom");
        const sessionState = room.sessionComplete
          ? t("splash.multiplayer.roomState.complete")
          : t("splash.multiplayer.roomState.active", { count: room.activeHumanCount });
        option.textContent = t("splash.multiplayer.roomOptionLabel", {
          roomCode: room.roomCode,
          roomFlavor,
          players: `${room.humanCount}/${maxPlayers}`,
          sessionState,
          openSeats: availableSlots,
        });
        roomSelect.appendChild(option);
      });

      const canRestoreSelection =
        typeof priorSelection === "string" &&
        priorSelection.length > 0 &&
        this.privateRoomCode.length === 0 &&
        this.roomList.some((room) => room.sessionId === priorSelection);
      this.selectedRoomSessionId = canRestoreSelection ? priorSelection : null;
      roomSelect.value = this.selectedRoomSessionId ?? "";
    } catch (error) {
      log.warn("Failed to refresh room list", error);
      this.roomList = [];
      this.selectedRoomSessionId = null;
      if (roomSelect) {
        roomSelect.innerHTML = "";
        const createOption = document.createElement("option");
        createOption.value = "";
        createOption.textContent = t("splash.multiplayer.createPrivateRoom");
        roomSelect.appendChild(createOption);
        roomSelect.value = "";
      }
    } finally {
      this.roomListLoading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
      }
      this.updateRoomStatus();
    }
  }

  private normalizeRoomCode(rawValue: string): string {
    return rawValue.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
  }

  private getRoomCodeValidationError(roomCode: string): string | null {
    if (!roomCode) {
      return null;
    }
    if (roomCode.length < 4) {
      return t("splash.multiplayer.status.inviteCodeValidation");
    }
    return null;
  }

  private updateRoomCodeValidationUi(): void {
    const roomCodeInput = this.container.querySelector<HTMLInputElement>("#splash-room-code");
    const roomCodeJoinButton = this.container.querySelector<HTMLButtonElement>("#splash-room-code-join");
    const roomCodeError = this.container.querySelector<HTMLElement>("#splash-room-code-error");
    const validationError = this.getRoomCodeValidationError(this.privateRoomCode);
    const shouldShowFeedback = this.playMode === "multiplayer";
    const feedbackMessage = validationError
      ? validationError
      : this.roomCodeFeedback?.message ?? "";
    const feedbackTone = validationError ? "error" : this.roomCodeFeedback?.tone ?? null;
    const showErrorState = shouldShowFeedback && feedbackTone === "error";

    if (roomCodeInput) {
      roomCodeInput.setAttribute("aria-invalid", showErrorState ? "true" : "false");
      roomCodeInput.disabled = this.roomCodeJoinInFlight;
    }
    if (roomCodeError) {
      roomCodeError.classList.remove("is-info", "is-success", "is-error");
      if (shouldShowFeedback && feedbackMessage) {
        roomCodeError.textContent = feedbackMessage;
        roomCodeError.style.display = "block";
        if (feedbackTone === "info" || feedbackTone === "success" || feedbackTone === "error") {
          roomCodeError.classList.add(`is-${feedbackTone}`);
        }
      } else {
        roomCodeError.textContent = "";
        roomCodeError.style.display = "none";
      }
    }
    if (roomCodeJoinButton) {
      roomCodeJoinButton.disabled =
        this.playMode !== "multiplayer" ||
        this.roomCodeJoinInFlight ||
        this.privateRoomCode.length === 0 ||
        Boolean(validationError);
    }
  }

  private setRoomCodeFeedback(
    message: string,
    tone: "info" | "success" | "error"
  ): void {
    const normalizedMessage = message.trim();
    this.roomCodeFeedback = normalizedMessage
      ? {
          tone,
          message: normalizedMessage,
        }
      : null;
    this.updateRoomCodeValidationUi();
  }

  private clearRoomCodeFeedback(): void {
    this.roomCodeFeedback = null;
  }

  private getRoomCodeJoinFailureMessage(reason: string | undefined): string {
    if (reason === "room_not_found") {
      return t("splash.multiplayer.joinFailure.roomNotFound");
    }
    if (reason === "room_full") {
      return t("splash.multiplayer.joinFailure.roomFull");
    }
    if (reason === "session_expired") {
      return t("splash.multiplayer.joinFailure.sessionExpired");
    }
    return t("splash.multiplayer.joinFailure.default");
  }

  private async handleJoinCodeQuickAction(
    attemptStart: (options: SplashStartOptions) => Promise<boolean>
  ): Promise<void> {
    if (this.roomCodeJoinInFlight) {
      return;
    }

    const validationError = this.getRoomCodeValidationError(this.privateRoomCode);
    if (validationError) {
      this.setRoomCodeFeedback(validationError, "error");
      return;
    }

    const targetRoomCode = this.privateRoomCode;
    const localPlayerId = getLocalPlayerId();
    this.roomCodeJoinInFlight = true;
    this.setRoomCodeFeedback(t("splash.multiplayer.joinCodeChecking"), "info");

    let joinedSessionId: string | null = null;
    try {
      const { backendApiService } = await import("../services/backendApi.js");
      const joinResult = await backendApiService.joinMultiplayerRoomByCode(targetRoomCode, {
        playerId: localPlayerId,
        botCount: this.getJoinBotSeedCount(),
      });

      if (!joinResult.session) {
        this.setRoomCodeFeedback(
          this.getRoomCodeJoinFailureMessage(joinResult.reason),
          "error"
        );
        return;
      }

      joinedSessionId = joinResult.session.sessionId;
      this.setRoomCodeFeedback(
        t("splash.multiplayer.joinCodeFound", { roomCode: joinResult.session.roomCode }),
        "success"
      );
      const started = await attemptStart({
        playMode: "multiplayer",
        multiplayer: {
          botCount: this.botCount,
          joinBotCount: this.getJoinBotSeedCount(),
          sessionId: joinedSessionId,
          roomCode: targetRoomCode,
        },
      });

      if (!started) {
        this.setRoomCodeFeedback(t("splash.multiplayer.joinCodeUnableStart"), "error");
        await backendApiService.leaveMultiplayerSession(joinedSessionId, localPlayerId);
      }
    } catch (error) {
      log.warn("Invite-code join precheck failed", error);
      this.setRoomCodeFeedback(t("splash.multiplayer.joinCodeUnableValidate"), "error");
    } finally {
      this.roomCodeJoinInFlight = false;
      this.updateRoomCodeValidationUi();
    }
  }

  private getJoinBotSeedCount(): number | undefined {
    if (!this.seedBotsOnJoin) {
      return undefined;
    }
    return Math.max(1, Math.min(4, Math.floor(this.joinBotCount)));
  }

  private updateJoinBotSeedUi(): void {
    const joinBotCountSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-join-bot-count");
    if (!joinBotCountSelect) {
      return;
    }
    joinBotCountSelect.disabled = !this.seedBotsOnJoin;
  }

  private getJoinBotSeedStatusNote(withLeadingSpace: boolean = false): string {
    const joinSeedCount = this.getJoinBotSeedCount();
    if (!joinSeedCount) {
      return "";
    }
    const note = t("splash.multiplayer.joinSeedStatus", { count: joinSeedCount });
    return withLeadingSpace ? ` ${note}` : note;
  }

  private async handleLanguageSelectionChange(languageSelect: HTMLSelectElement): Promise<void> {
    const currentLocale = getLocale();
    const rawLocale = languageSelect.value;
    if (rawLocale !== "en-US" && rawLocale !== "es-ES") {
      languageSelect.value = currentLocale;
      return;
    }

    const nextLocale = rawLocale as LocaleCode;
    if (nextLocale === currentLocale) {
      return;
    }

    const confirmed = await confirmAction({
      title: t("splash.language.confirm.title"),
      message: t("splash.language.confirm.message", {
        locale: this.getLocaleLabel(nextLocale),
      }),
      confirmLabel: t("splash.language.confirm.confirm"),
      cancelLabel: t("splash.language.confirm.cancel"),
      tone: "primary",
    });
    if (!confirmed) {
      languageSelect.value = currentLocale;
      return;
    }

    setLocale(nextLocale);
    languageSelect.disabled = true;
    if (typeof window !== "undefined") {
      window.location.reload();
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
}
