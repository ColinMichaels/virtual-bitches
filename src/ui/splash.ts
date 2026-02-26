/**
 * Splash Screen
 * Home screen with lazily loaded floating-dice background.
 */

import { audioService } from "../services/audio.js";
import { environment } from "../environments/environment.js";
import { logger } from "../utils/logger.js";
import type { MultiplayerRoomListing } from "../services/backendApi.js";
import type { SplashBackground3D } from "./splashBackground3d.js";
import { getLocalPlayerId } from "../services/playerIdentity.js";
import { getBrandLogoUrl } from "../services/assetUrl.js";

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
  gameTitle = environment.gameTitle;

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
        <p class="splash-subtitle">Push Your Luck Dice Game</p>
        <p class="splash-tagline">Roll • Select • Score Low to Win</p>
        <div class="splash-mode-picker" role="radiogroup" aria-label="Play mode">
          <button
            type="button"
            class="splash-mode-btn active"
            data-play-mode="solo"
            role="radio"
            aria-checked="true"
          >
            Solo
          </button>
          <button
            type="button"
            class="splash-mode-btn"
            data-play-mode="multiplayer"
            role="radio"
            aria-checked="false"
          >
            Multiplayer
          </button>
        </div>
        <div id="splash-multiplayer-options" class="splash-multiplayer-options" style="display: none;">
          <label for="splash-bot-count">Create Room Bots</label>
          <select id="splash-bot-count">
            <option value="0">0 (human-only)</option>
            <option value="1" selected>1 bot</option>
            <option value="2">2 bots</option>
            <option value="3">3 bots</option>
          </select>
          <div class="splash-bot-seed-toggle">
            <label for="splash-seed-join-bots">
              <input id="splash-seed-join-bots" type="checkbox" />
              Seed bots when joining rooms (testing)
            </label>
          </div>
          <label for="splash-join-bot-count">Join Room Bot Seed Count</label>
          <select id="splash-join-bot-count" disabled>
            <option value="1" selected>1 bot</option>
            <option value="2">2 bots</option>
            <option value="3">3 bots</option>
            <option value="4">4 bots</option>
          </select>
          <p class="splash-join-bot-seed-note">
            Join seeding applies only when joining an existing room.
          </p>
          <label for="splash-room-select">Join Existing Room</label>
          <div class="splash-room-picker">
            <select id="splash-room-select">
              <option value="">Create Private Room</option>
            </select>
            <button type="button" id="splash-room-refresh" class="btn btn-secondary secondary">Refresh</button>
          </div>
          <label for="splash-room-code">Join By Invite Code</label>
          <div class="splash-room-code-actions">
            <input
              id="splash-room-code"
              type="text"
              inputmode="text"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              placeholder="Enter room code"
              maxlength="8"
              aria-describedby="splash-room-code-error"
            />
            <button type="button" id="splash-room-code-join" class="btn btn-primary primary">Join Code</button>
          </div>
          <p id="splash-room-code-error" class="splash-room-code-error" style="display: none;"></p>
          <p id="splash-room-status">No active public rooms found. Starting creates a private room.</p>
          <p>Pick a public lobby, or create a private room and invite others with your share link.</p>
        </div>
        <div class="splash-buttons">
          <button id="start-game-btn" class="btn btn-primary primary splash-btn">Start Game</button>
          <button id="splash-replay-tutorial-btn" class="btn btn-secondary secondary splash-btn">Replay Tutorial</button>
          <button id="splash-rules-btn" class="btn btn-secondary splash-btn">How to Play</button>
          <button id="splash-leaderboard-btn" class="btn btn-secondary splash-btn">Leaderboard</button>
          <button id="splash-settings-btn" class="btn btn-secondary splash-btn">Settings</button>
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
    const replayTutorialButton = this.container.querySelector<HTMLButtonElement>("#splash-replay-tutorial-btn");
    const attemptStart = async (options: SplashStartOptions): Promise<boolean> => {
      if (startButton?.disabled || replayTutorialButton?.disabled) {
        return false;
      }

      if (startButton) {
        startButton.disabled = true;
      }
      if (replayTutorialButton) {
        replayTutorialButton.disabled = true;
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
        if (replayTutorialButton) {
          replayTutorialButton.disabled = false;
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

    replayTutorialButton?.addEventListener("click", () => {
      audioService.playSfx("click");
      void attemptStart({
        playMode: "solo",
        forceTutorialReplay: true,
      });
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
        onStatus?.("Loading floating dice...");
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
      statusEl.textContent = "Refreshing rooms...";
      return;
    }
    if (this.privateRoomCode) {
      const roomCodeValidationError = this.getRoomCodeValidationError(this.privateRoomCode);
      if (roomCodeValidationError) {
        statusEl.textContent = "Invite code must be 4-8 letters or numbers.";
        return;
      }
      const joinSeedNote = this.getJoinBotSeedStatusNote();
      statusEl.textContent = joinSeedNote
        ? `Joining private room ${this.privateRoomCode}. ${joinSeedNote}`
        : `Joining private room ${this.privateRoomCode}.`;
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
        const joinability = availableSlots > 0 ? `${availableSlots} open seat(s)` : "Room is currently full";
        statusEl.textContent =
          availableSlots > 0
            ? `Joining room ${selected.roomCode} (${joinability}). Expires in ~${expiresInMinutes}m without activity.${this.getJoinBotSeedStatusNote(true)}`
            : `Joining room ${selected.roomCode} (${joinability}). Select "Create Private Room" to start your own room now.`;
        return;
      }
    }
    if (this.roomList.length === 0) {
      statusEl.textContent = "No active public rooms found. Starting creates a private room.";
      return;
    }
    const joinSeedNote = this.getJoinBotSeedStatusNote();
    statusEl.textContent = joinSeedNote
      ? `Select a public room to join, or choose Create Private Room at any time. ${joinSeedNote}`
      : "Select a public room to join, or choose Create Private Room at any time.";
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
      createOption.textContent = "Create Private Room";
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
            ? "Lobby"
            : room.roomType === "public_overflow"
              ? "Overflow"
              : "Custom";
        const sessionState = room.sessionComplete ? "complete" : `${room.activeHumanCount} active`;
        option.textContent = `${room.roomCode} • ${roomFlavor} • ${room.humanCount}/${maxPlayers} players • ${sessionState} • ${availableSlots} open`;
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
        createOption.textContent = "Create Private Room";
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
      return "Invite code must be 4-8 letters or numbers.";
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
      return "No room found for that invite code.";
    }
    if (reason === "room_full") {
      return "That room is full right now.";
    }
    if (reason === "session_expired") {
      return "That room has expired.";
    }
    return "Unable to join with that invite code right now.";
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
    this.setRoomCodeFeedback("Checking invite code...", "info");

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
        `Room ${joinResult.session.roomCode} found. Joining...`,
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
        this.setRoomCodeFeedback("Unable to start game. Try again.", "error");
        await backendApiService.leaveMultiplayerSession(joinedSessionId, localPlayerId);
      }
    } catch (error) {
      log.warn("Invite-code join precheck failed", error);
      this.setRoomCodeFeedback("Unable to validate invite code right now.", "error");
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
    const prefix = withLeadingSpace ? " " : "";
    return `${prefix}Join seeding: +${joinSeedCount} bot${joinSeedCount === 1 ? "" : "s"}.`;
  }
}
