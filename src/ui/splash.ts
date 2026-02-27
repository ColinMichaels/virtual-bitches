/**
 * Splash Screen
 * Home screen with lazily loaded floating-dice background.
 */

import { audioService } from "../services/audio.js";
import { logger } from "../utils/logger.js";
import type { MultiplayerGameDifficulty, MultiplayerRoomListing } from "../services/backendApi.js";
import type { SplashBackground3D } from "./splashBackground3d.js";
import { getLocalPlayerId } from "../services/playerIdentity.js";
import { getBrandLogoUrl } from "../services/assetUrl.js";
import { gameBrand } from "../config/brand.js";
import { getLocale, setLocale, t, type LocaleCode } from "../i18n/index.js";
import { confirmAction } from "./confirmModal.js";
import { environment } from "@env";

const log = logger.create("SplashScreen");

export type SplashPlayMode = "solo" | "multiplayer";

export interface SplashStartOptions {
  playMode: SplashPlayMode;
  forceTutorialReplay?: boolean;
  multiplayer?: {
    botCount: number;
    joinBotCount?: number;
    gameDifficulty?: MultiplayerGameDifficulty;
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
  private lastRenderedPlayMode: SplashPlayMode = "solo";
  private botCount = 0;
  private joinBotCount = 1;
  private seedBotsOnJoin = false;
  private privateRoomMode = false;
  private privateRoomName = "";
  private privateRoomMaxPlayers = 8;
  private multiplayerDifficulty: MultiplayerGameDifficulty = "normal";
  private roomFilterType: "all" | "public_default" | "public_overflow" | "custom" = "all";
  private roomFilterDifficulty: "all" | MultiplayerGameDifficulty = "all";
  private roomFilterMinPlayers = 0;
  private roomSearchQuery = "";
  private roomPageSize = 6;
  private roomPageIndex = 0;
  private multiplayerOverlayOpen = false;
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
        <div id="splash-multiplayer-launch" class="splash-multiplayer-launch" style="display: none;">
          <button
            type="button"
            id="splash-multiplayer-open"
            class="btn btn-secondary secondary splash-multiplayer-open-btn"
          >
            ${t("splash.multiplayer.manageButton")}
          </button>
        </div>
        <div id="splash-multiplayer-overlay" class="splash-multiplayer-overlay" aria-hidden="true">
          <button
            type="button"
            id="splash-multiplayer-overlay-backdrop"
            class="splash-multiplayer-overlay-backdrop"
            aria-label="${t("splash.multiplayer.closePanel")}"
          ></button>
          <section
            id="splash-multiplayer-options"
            class="splash-multiplayer-options"
            role="dialog"
            aria-modal="true"
            aria-labelledby="splash-multiplayer-title"
          >
            <div class="splash-multiplayer-header">
              <h2 id="splash-multiplayer-title">${t("splash.multiplayer.panelTitle")}</h2>
              <button
                type="button"
                id="splash-multiplayer-close"
                class="modal-close splash-multiplayer-close-btn"
                title="${t("splash.multiplayer.closePanel")}"
                aria-label="${t("splash.multiplayer.closePanel")}"
              >
                &times;
              </button>
            </div>

            <div class="splash-multiplayer-section">
              <div class="splash-multiplayer-section-head">
                <h3>${t("splash.multiplayer.joinExistingRoom")}</h3>
                <button
                  type="button"
                  id="splash-room-refresh"
                  class="splash-multiplayer-icon-btn"
                  title="${t("splash.multiplayer.refreshRooms")}"
                  aria-label="${t("splash.multiplayer.refreshRooms")}"
                >
                  &#x21bb;
                </button>
              </div>
              <div class="splash-room-filters">
                <div class="splash-room-filter">
                  <label for="splash-room-filter-search">${t("splash.multiplayer.filters.searchLabel")}</label>
                  <input
                    id="splash-room-filter-search"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    maxlength="24"
                    placeholder="${t("splash.multiplayer.filters.searchPlaceholder")}"
                  />
                </div>
                <div class="splash-room-filter">
                  <label for="splash-room-filter-type">${t("splash.multiplayer.filters.roomTypeLabel")}</label>
                  <select id="splash-room-filter-type">
                    <option value="all">${t("splash.multiplayer.filters.any")}</option>
                    <option value="public_default">${t("splash.multiplayer.roomFlavor.lobby")}</option>
                    <option value="public_overflow">${t("splash.multiplayer.roomFlavor.overflow")}</option>
                    <option value="custom">${t("splash.multiplayer.roomFlavor.custom")}</option>
                  </select>
                </div>
                <div class="splash-room-filter">
                  <label for="splash-room-filter-difficulty">${t("splash.multiplayer.filters.difficultyLabel")}</label>
                  <select id="splash-room-filter-difficulty">
                    <option value="all">${t("splash.multiplayer.filters.any")}</option>
                    <option value="easy">${t("difficulty.easy")}</option>
                    <option value="normal">${t("difficulty.normal")}</option>
                    <option value="hard">${t("difficulty.hard")}</option>
                  </select>
                </div>
                <div class="splash-room-filter">
                  <label for="splash-room-filter-players">${t("splash.multiplayer.filters.playersLabel")}</label>
                  <select id="splash-room-filter-players">
                    <option value="0">${t("splash.multiplayer.filters.any")}</option>
                    <option value="1">${t("splash.multiplayer.filters.playersMin", { count: 1 })}</option>
                    <option value="2">${t("splash.multiplayer.filters.playersMin", { count: 2 })}</option>
                    <option value="3">${t("splash.multiplayer.filters.playersMin", { count: 3 })}</option>
                    <option value="4">${t("splash.multiplayer.filters.playersMin", { count: 4 })}</option>
                    <option value="5">${t("splash.multiplayer.filters.playersMin", { count: 5 })}</option>
                    <option value="6">${t("splash.multiplayer.filters.playersMin", { count: 6 })}</option>
                    <option value="7">${t("splash.multiplayer.filters.playersMin", { count: 7 })}</option>
                    <option value="8">${t("splash.multiplayer.filters.playersMin", { count: 8 })}</option>
                  </select>
                </div>
              </div>
              <div id="splash-room-grid" class="splash-room-grid">
                <div class="splash-room-card splash-room-card-empty">
                  <p>${t("splash.multiplayer.roomsLoading")}</p>
                </div>
              </div>
              <div class="splash-room-pagination">
                <p id="splash-room-pagination-count" class="splash-room-pagination-count"></p>
                <div class="splash-room-pagination-controls">
                  <label for="splash-room-page-size">${t("splash.multiplayer.filters.pageSizeLabel")}</label>
                  <select id="splash-room-page-size">
                    <option value="4">4</option>
                    <option value="6" selected>6</option>
                    <option value="9">9</option>
                    <option value="12">12</option>
                  </select>
                  <button type="button" id="splash-room-page-prev" class="btn btn-secondary btn-sm">
                    ${t("splash.multiplayer.filters.prevPage")}
                  </button>
                  <span id="splash-room-page-indicator" class="splash-room-page-indicator"></span>
                  <button type="button" id="splash-room-page-next" class="btn btn-secondary btn-sm">
                    ${t("splash.multiplayer.filters.nextPage")}
                  </button>
                </div>
              </div>
            </div>

            <div class="splash-multiplayer-section splash-multiplayer-section-difficulty">
              <label>${t("splash.multiplayer.difficultyLabel")}</label>
              <div class="splash-difficulty-picker" role="group" aria-label="${t("splash.multiplayer.difficultyLabel")}">
                <button type="button" class="splash-difficulty-btn" data-multiplayer-difficulty="easy">
                  ${t("difficulty.easy")}
                </button>
                <button type="button" class="splash-difficulty-btn is-active" data-multiplayer-difficulty="normal">
                  ${t("difficulty.normal")}
                </button>
                <button type="button" class="splash-difficulty-btn" data-multiplayer-difficulty="hard">
                  ${t("difficulty.hard")}
                </button>
              </div>
            </div>

            <div class="splash-multiplayer-section">
              <div class="splash-private-toggle">
                <label for="splash-private-room-toggle">
                  <input id="splash-private-room-toggle" type="checkbox" />
                  ${t("splash.multiplayer.privateToggle")}
                </label>
              </div>
              <div id="splash-private-room-settings" class="splash-private-room-settings" hidden>
                <div class="splash-private-config-grid">
                  <div>
                    <label for="splash-private-room-name">${t("splash.multiplayer.privateRoomName")}</label>
                    <input
                      id="splash-private-room-name"
                      type="text"
                      autocomplete="off"
                      spellcheck="false"
                      maxlength="24"
                      placeholder="${t("splash.multiplayer.privateRoomNamePlaceholder")}"
                    />
                  </div>
                  <div>
                    <label for="splash-private-room-player-limit">${t("splash.multiplayer.privatePlayerLimit")}</label>
                    <select id="splash-private-room-player-limit">
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="5">5</option>
                      <option value="6">6</option>
                      <option value="7">7</option>
                      <option value="8" selected>8</option>
                    </select>
                  </div>
                </div>
                <p class="splash-private-room-limit-note">${t("splash.multiplayer.privatePlayerLimitNote")}</p>
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
                  <button type="button" id="splash-room-code-join" class="btn btn-primary primary">
                    ${t("splash.multiplayer.joinCode")}
                  </button>
                </div>
                <p id="splash-room-code-error" class="splash-room-code-error" style="display: none;"></p>
              </div>
            </div>

            <div class="splash-multiplayer-section splash-multiplayer-section-seed">
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
              <p class="splash-join-bot-seed-note">${t("splash.multiplayer.joinBotSeedNote")}</p>
            </div>

            <p id="splash-room-status">${t("splash.multiplayer.status.noActivePublicRooms")}</p>
            <p class="splash-multiplayer-hint">${t("splash.multiplayer.pickLobbyHint")}</p>
          </section>
        </div>
        <div class="splash-buttons">
          <button id="start-game-btn" class="btn btn-primary primary splash-btn">${t("splash.button.startGame")}</button>
          <button id="splash-rules-btn" class="btn btn-secondary splash-btn">${t("splash.button.howToPlay")}</button>
          <button id="splash-feedback-btn" class="btn btn-secondary splash-btn">${t("splash.button.feedback")}</button>
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

    const multiplayerOpenButton =
      this.container.querySelector<HTMLButtonElement>("#splash-multiplayer-open");
    const multiplayerCloseButton =
      this.container.querySelector<HTMLButtonElement>("#splash-multiplayer-close");
    const multiplayerBackdropButton =
      this.container.querySelector<HTMLButtonElement>("#splash-multiplayer-overlay-backdrop");
    const privateRoomToggle =
      this.container.querySelector<HTMLInputElement>("#splash-private-room-toggle");
    const privateRoomNameInput =
      this.container.querySelector<HTMLInputElement>("#splash-private-room-name");
    const privateRoomPlayerLimitSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-private-room-player-limit");
    const multiplayerDifficultyButtons = Array.from(
      this.container.querySelectorAll<HTMLButtonElement>("[data-multiplayer-difficulty]")
    );
    const seedBotsOnJoinCheckbox =
      this.container.querySelector<HTMLInputElement>("#splash-seed-join-bots");
    const joinBotCountSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-join-bot-count");
    const roomGrid = this.container.querySelector<HTMLElement>("#splash-room-grid");
    const roomFilterSearchInput =
      this.container.querySelector<HTMLInputElement>("#splash-room-filter-search");
    const roomFilterTypeSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-room-filter-type");
    const roomFilterDifficultySelect =
      this.container.querySelector<HTMLSelectElement>("#splash-room-filter-difficulty");
    const roomFilterPlayersSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-room-filter-players");
    const roomPageSizeSelect =
      this.container.querySelector<HTMLSelectElement>("#splash-room-page-size");
    const roomPagePrevButton =
      this.container.querySelector<HTMLButtonElement>("#splash-room-page-prev");
    const roomPageNextButton =
      this.container.querySelector<HTMLButtonElement>("#splash-room-page-next");
    const roomCodeInput = this.container.querySelector<HTMLInputElement>("#splash-room-code");
    const roomCodeJoinButton = this.container.querySelector<HTMLButtonElement>("#splash-room-code-join");
    const refreshButton = this.container.querySelector<HTMLButtonElement>("#splash-room-refresh");

    multiplayerOpenButton?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.playMode = "multiplayer";
      this.syncPlayModeUi();
      this.setMultiplayerOverlayOpen(true);
    });
    multiplayerCloseButton?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.setMultiplayerOverlayOpen(false);
    });
    multiplayerBackdropButton?.addEventListener("click", () => {
      this.setMultiplayerOverlayOpen(false);
    });

    privateRoomToggle?.addEventListener("change", () => {
      this.privateRoomMode = privateRoomToggle.checked;
      if (this.privateRoomMode) {
        this.selectedRoomSessionId = null;
      } else {
        this.privateRoomCode = "";
        if (roomCodeInput) {
          roomCodeInput.value = "";
        }
      }
      this.clearRoomCodeFeedback();
      this.renderRoomCards();
      this.updatePrivateRoomModeUi();
      this.updateMultiplayerDifficultyUi();
      this.updateRoomCodeValidationUi();
      this.updateRoomStatus();
    });
    privateRoomNameInput?.addEventListener("input", () => {
      this.privateRoomName = privateRoomNameInput.value.trim().slice(0, 24);
      privateRoomNameInput.value = this.privateRoomName;
    });
    privateRoomPlayerLimitSelect?.addEventListener("change", () => {
      const parsed = Number(privateRoomPlayerLimitSelect.value);
      this.privateRoomMaxPlayers = Number.isFinite(parsed)
        ? Math.max(2, Math.min(8, Math.floor(parsed)))
        : 8;
    });
    multiplayerDifficultyButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const requested = button.dataset.multiplayerDifficulty;
        this.multiplayerDifficulty = this.normalizeMultiplayerDifficulty(requested);
        this.updateMultiplayerDifficultyUi();
      });
    });
    roomFilterSearchInput?.addEventListener("input", () => {
      this.roomSearchQuery = roomFilterSearchInput.value.trim().slice(0, 24);
      roomFilterSearchInput.value = this.roomSearchQuery;
      this.roomPageIndex = 0;
      this.syncSelectedRoomWithVisibleRooms();
      this.renderRoomCards();
      this.updateRoomStatus();
    });
    roomFilterTypeSelect?.addEventListener("change", () => {
      this.roomFilterType = this.normalizeRoomTypeFilter(roomFilterTypeSelect.value);
      this.roomPageIndex = 0;
      this.syncSelectedRoomWithVisibleRooms();
      this.renderRoomCards();
      this.updateRoomStatus();
    });
    roomFilterDifficultySelect?.addEventListener("change", () => {
      this.roomFilterDifficulty = this.normalizeRoomDifficultyFilter(roomFilterDifficultySelect.value);
      this.roomPageIndex = 0;
      this.syncSelectedRoomWithVisibleRooms();
      this.renderRoomCards();
      this.updateRoomStatus();
    });
    roomFilterPlayersSelect?.addEventListener("change", () => {
      const parsed = Number(roomFilterPlayersSelect.value);
      this.roomFilterMinPlayers = Number.isFinite(parsed)
        ? Math.max(0, Math.min(8, Math.floor(parsed)))
        : 0;
      this.roomPageIndex = 0;
      this.syncSelectedRoomWithVisibleRooms();
      this.renderRoomCards();
      this.updateRoomStatus();
    });
    roomPageSizeSelect?.addEventListener("change", () => {
      const parsed = Number(roomPageSizeSelect.value);
      this.roomPageSize = Number.isFinite(parsed)
        ? Math.max(4, Math.min(24, Math.floor(parsed)))
        : 6;
      this.roomPageIndex = 0;
      this.renderRoomCards();
      this.updateRoomStatus();
    });
    roomPagePrevButton?.addEventListener("click", () => {
      if (this.roomPageIndex <= 0) {
        return;
      }
      this.roomPageIndex = Math.max(0, this.roomPageIndex - 1);
      this.renderRoomCards();
    });
    roomPageNextButton?.addEventListener("click", () => {
      const filteredRooms = this.getFilteredRooms();
      const pageCount = this.getFilteredRoomPageCount(filteredRooms.length);
      if (this.roomPageIndex >= pageCount - 1) {
        return;
      }
      this.roomPageIndex = Math.min(pageCount - 1, this.roomPageIndex + 1);
      this.renderRoomCards();
    });

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

    roomGrid?.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const card = target.closest<HTMLButtonElement>(".splash-room-card");
      const sessionId = card?.dataset.roomSessionId?.trim();
      if (!sessionId) {
        return;
      }

      this.selectedRoomSessionId = sessionId;
      this.privateRoomMode = false;
      const selectedRoom = this.roomList.find((room) => room.sessionId === sessionId);
      if (selectedRoom) {
        this.multiplayerDifficulty = this.resolveRoomDifficulty(selectedRoom);
      }
      if (privateRoomToggle) {
        privateRoomToggle.checked = false;
      }
      if (roomCodeInput) {
        this.privateRoomCode = "";
        roomCodeInput.value = "";
      }
      this.clearRoomCodeFeedback();
      this.updateMultiplayerDifficultyUi();
      this.updatePrivateRoomModeUi();
      this.updateRoomCodeValidationUi();
      this.renderRoomCards();
      this.updateRoomStatus();
    });

    roomCodeInput?.addEventListener("input", () => {
      const normalized = this.normalizeRoomCode(roomCodeInput.value);
      this.privateRoomCode = normalized;
      roomCodeInput.value = normalized;
      if (normalized.length > 0) {
        this.privateRoomMode = true;
        this.selectedRoomSessionId = null;
        if (privateRoomToggle) {
          privateRoomToggle.checked = true;
        }
      }
      this.clearRoomCodeFeedback();
      this.renderRoomCards();
      this.updatePrivateRoomModeUi();
      this.updateMultiplayerDifficultyUi();
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
      this.privateRoomMode = true;
      if (privateRoomToggle) {
        privateRoomToggle.checked = true;
      }
      this.updatePrivateRoomModeUi();
      this.updateMultiplayerDifficultyUi();
      void this.handleJoinCodeQuickAction(attemptStart);
    });

    refreshButton?.addEventListener("click", () => {
      audioService.playSfx("click");
      void this.refreshRoomList(true);
    });

    this.container.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.multiplayerOverlayOpen) {
        return;
      }
      this.setMultiplayerOverlayOpen(false);
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
      const privateModeEnabled = this.isPrivateRoomModeEnabled();
      const roomCodeValidationError =
        this.playMode === "multiplayer" && privateModeEnabled
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
              gameDifficulty: this.multiplayerDifficulty,
              sessionId: privateModeEnabled ? undefined : this.selectedRoomSessionId ?? undefined,
              roomCode: privateModeEnabled ? this.privateRoomCode || undefined : undefined,
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
      this.privateRoomMode = true;
      if (privateRoomToggle) {
        privateRoomToggle.checked = true;
      }
      this.updatePrivateRoomModeUi();
      this.updateMultiplayerDifficultyUi();
      void this.handleJoinCodeQuickAction(attemptStart);
    });

    document.getElementById("splash-rules-btn")?.addEventListener("click", () => {
      audioService.playSfx("click");
      onRules();
    });

    document.getElementById("splash-feedback-btn")?.addEventListener("click", () => {
      audioService.playSfx("click");
      const feedbackUrl = environment.feedbackFormUrl?.trim() || "/feedback";
      const opened = window.open(feedbackUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        window.location.assign(feedbackUrl);
      }
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

    const multiplayerLaunch = this.container.querySelector<HTMLElement>("#splash-multiplayer-launch");
    if (multiplayerLaunch) {
      multiplayerLaunch.style.display = this.playMode === "multiplayer" ? "flex" : "none";
    }

    const modeChanged = this.lastRenderedPlayMode !== this.playMode;
    if (this.playMode === "multiplayer" && modeChanged) {
      this.setMultiplayerOverlayOpen(true);
      void this.refreshRoomList(false);
    } else if (this.playMode !== "multiplayer") {
      this.setMultiplayerOverlayOpen(false);
    }

    if (this.playMode === "multiplayer" && !this.roomListLoading && this.roomList.length === 0) {
      void this.refreshRoomList(false);
    }

    this.updatePrivateRoomModeUi();
    this.updateMultiplayerDifficultyUi();
    this.updateJoinBotSeedUi();
    this.renderRoomCards();
    this.updateRoomCodeValidationUi();
    this.updateRoomStatus();
    this.lastRenderedPlayMode = this.playMode;
  }

  private setMultiplayerOverlayOpen(isOpen: boolean): void {
    const overlay = this.container.querySelector<HTMLElement>("#splash-multiplayer-overlay");
    const shouldOpen = isOpen && this.playMode === "multiplayer";
    this.multiplayerOverlayOpen = shouldOpen;
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("is-open", shouldOpen);
    overlay.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
  }

  private isPrivateRoomModeEnabled(): boolean {
    return this.privateRoomMode;
  }

  private updatePrivateRoomModeUi(): void {
    const privateRoomToggle =
      this.container.querySelector<HTMLInputElement>("#splash-private-room-toggle");
    const privateRoomSettings =
      this.container.querySelector<HTMLElement>("#splash-private-room-settings");
    const privateEnabled = this.isPrivateRoomModeEnabled();

    if (privateRoomToggle && privateRoomToggle.checked !== privateEnabled) {
      privateRoomToggle.checked = privateEnabled;
    }
    if (privateRoomSettings) {
      privateRoomSettings.hidden = !privateEnabled;
    }
  }

  private normalizeMultiplayerDifficulty(
    value: string | null | undefined
  ): MultiplayerGameDifficulty {
    if (value === "easy" || value === "hard") {
      return value;
    }
    return "normal";
  }

  private resolveRoomDifficulty(room: MultiplayerRoomListing): MultiplayerGameDifficulty {
    return this.normalizeMultiplayerDifficulty(room.gameDifficulty);
  }

  private isRoomDifficultyLockedBySelection(): boolean {
    return (
      this.playMode === "multiplayer" &&
      !this.isPrivateRoomModeEnabled() &&
      typeof this.selectedRoomSessionId === "string" &&
      this.selectedRoomSessionId.length > 0
    );
  }

  private updateMultiplayerDifficultyUi(): void {
    const difficultyButtons =
      this.container.querySelectorAll<HTMLButtonElement>("[data-multiplayer-difficulty]");
    const difficultyLocked = this.isRoomDifficultyLockedBySelection();
    difficultyButtons.forEach((button) => {
      const level = this.normalizeMultiplayerDifficulty(button.dataset.multiplayerDifficulty);
      const isActive = level === this.multiplayerDifficulty;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.disabled = difficultyLocked;
    });
  }

  private normalizeRoomTypeFilter(
    value: string | null | undefined
  ): "all" | "public_default" | "public_overflow" | "custom" {
    if (value === "public_default" || value === "public_overflow" || value === "custom") {
      return value;
    }
    return "all";
  }

  private normalizeRoomDifficultyFilter(
    value: string | null | undefined
  ): "all" | MultiplayerGameDifficulty {
    if (value === "all") {
      return "all";
    }
    return this.normalizeMultiplayerDifficulty(value);
  }

  private resolveRoomType(room: MultiplayerRoomListing): "public_default" | "public_overflow" | "custom" {
    if (room.roomType === "public_default" || room.roomType === "public_overflow") {
      return room.roomType;
    }
    return "custom";
  }

  private getFilteredRooms(): MultiplayerRoomListing[] {
    const normalizedSearch = this.roomSearchQuery.trim().toLowerCase();
    return this.roomList.filter((room) => {
      if (
        this.roomFilterDifficulty !== "all" &&
        this.resolveRoomDifficulty(room) !== this.roomFilterDifficulty
      ) {
        return false;
      }
      if (this.roomFilterType !== "all" && this.resolveRoomType(room) !== this.roomFilterType) {
        return false;
      }
      if (this.roomFilterMinPlayers > 0 && room.humanCount < this.roomFilterMinPlayers) {
        return false;
      }
      if (normalizedSearch.length > 0) {
        const searchBlob =
          `${room.roomCode} ${this.resolveRoomType(room)} ${this.resolveRoomDifficulty(room)}`.toLowerCase();
        if (!searchBlob.includes(normalizedSearch)) {
          return false;
        }
      }
      return true;
    });
  }

  private getFilteredRoomPageCount(filteredRoomCount: number): number {
    const safePageSize = Math.max(1, Math.floor(this.roomPageSize));
    return Math.max(1, Math.ceil(filteredRoomCount / safePageSize));
  }

  private getPagedRooms(filteredRooms: MultiplayerRoomListing[]): MultiplayerRoomListing[] {
    const safePageSize = Math.max(1, Math.floor(this.roomPageSize));
    const pageCount = this.getFilteredRoomPageCount(filteredRooms.length);
    this.roomPageIndex = Math.max(0, Math.min(this.roomPageIndex, pageCount - 1));
    const start = this.roomPageIndex * safePageSize;
    return filteredRooms.slice(start, start + safePageSize);
  }

  private syncSelectedRoomWithVisibleRooms(): void {
    if (this.selectedRoomSessionId === null) {
      return;
    }
    const filteredRooms = this.getFilteredRooms();
    if (!filteredRooms.some((room) => room.sessionId === this.selectedRoomSessionId)) {
      this.selectedRoomSessionId = null;
      this.updateMultiplayerDifficultyUi();
    }
  }

  private updateRoomBrowserUi(
    filteredRooms: MultiplayerRoomListing[],
    totalRooms: number
  ): void {
    const countEl = this.container.querySelector<HTMLElement>("#splash-room-pagination-count");
    const pageIndicatorEl = this.container.querySelector<HTMLElement>("#splash-room-page-indicator");
    const prevButton = this.container.querySelector<HTMLButtonElement>("#splash-room-page-prev");
    const nextButton = this.container.querySelector<HTMLButtonElement>("#splash-room-page-next");

    const pageCount = this.getFilteredRoomPageCount(filteredRooms.length);
    const currentPage = Math.max(1, Math.min(pageCount, this.roomPageIndex + 1));
    if (countEl) {
      countEl.textContent = t("splash.multiplayer.filters.resultsCount", {
        shown: filteredRooms.length,
        total: totalRooms,
      });
    }
    if (pageIndicatorEl) {
      pageIndicatorEl.textContent = t("splash.multiplayer.filters.pageIndicator", {
        page: currentPage,
        total: pageCount,
      });
    }
    if (prevButton) {
      prevButton.disabled = this.roomPageIndex <= 0 || filteredRooms.length === 0;
    }
    if (nextButton) {
      nextButton.disabled = this.roomPageIndex >= pageCount - 1 || filteredRooms.length === 0;
    }
  }

  private resolveRoomCapacity(room: MultiplayerRoomListing): {
    maxPlayers: number;
    availableSlots: number;
  } {
    const maxPlayers =
      typeof room.maxHumanCount === "number" && Number.isFinite(room.maxHumanCount)
        ? Math.max(1, Math.floor(room.maxHumanCount))
        : 8;
    const availableSlots =
      typeof room.availableHumanSlots === "number" && Number.isFinite(room.availableHumanSlots)
        ? Math.max(0, Math.floor(room.availableHumanSlots))
        : Math.max(0, maxPlayers - room.humanCount);
    return {
      maxPlayers,
      availableSlots,
    };
  }

  private resolveRoomExpiresInMinutes(room: MultiplayerRoomListing): number {
    return Math.max(1, Math.ceil((room.expiresAt - Date.now()) / 60000));
  }

  private appendRoomGridEmptyState(roomGrid: HTMLElement, message: string): void {
    const emptyCard = document.createElement("div");
    emptyCard.className = "splash-room-card splash-room-card-empty";
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = message;
    emptyCard.appendChild(emptyMessage);
    roomGrid.appendChild(emptyCard);
  }

  private appendRoomGridPlaceholders(roomGrid: HTMLElement, count: number): void {
    const placeholderCount = Math.max(0, Math.floor(count));
    for (let index = 0; index < placeholderCount; index += 1) {
      const placeholderCard = document.createElement("div");
      placeholderCard.className = "splash-room-card splash-room-card-placeholder";
      placeholderCard.setAttribute("aria-hidden", "true");
      roomGrid.appendChild(placeholderCard);
    }
  }

  private renderRoomCards(): void {
    const roomGrid = this.container.querySelector<HTMLElement>("#splash-room-grid");
    if (!roomGrid) {
      return;
    }

    const pageSize = Math.max(1, Math.floor(this.roomPageSize));
    roomGrid.innerHTML = "";
    roomGrid.setAttribute("aria-busy", this.roomListLoading ? "true" : "false");
    if (this.roomListLoading) {
      this.appendRoomGridEmptyState(roomGrid, t("splash.multiplayer.roomsLoading"));
      this.appendRoomGridPlaceholders(roomGrid, pageSize - 1);
      this.updateRoomBrowserUi([], this.roomList.length);
      return;
    }

    if (this.roomList.length === 0) {
      this.appendRoomGridEmptyState(roomGrid, t("splash.multiplayer.roomsEmpty"));
      this.appendRoomGridPlaceholders(roomGrid, pageSize - 1);
      this.updateRoomBrowserUi([], 0);
      return;
    }

    const filteredRooms = this.getFilteredRooms();
    const pagedRooms = this.getPagedRooms(filteredRooms);
    this.updateRoomBrowserUi(filteredRooms, this.roomList.length);
    if (filteredRooms.length === 0) {
      this.appendRoomGridEmptyState(roomGrid, t("splash.multiplayer.roomsNoMatch"));
      this.appendRoomGridPlaceholders(roomGrid, pageSize - 1);
      return;
    }

    const fragment = document.createDocumentFragment();
    pagedRooms.forEach((room) => {
      const { maxPlayers, availableSlots } = this.resolveRoomCapacity(room);
      const expiresMinutes = this.resolveRoomExpiresInMinutes(room);
      const isSelected = room.sessionId === this.selectedRoomSessionId;
      const roomDifficulty = this.resolveRoomDifficulty(room);
      const roomFlavor =
        room.roomType === "public_default"
          ? t("splash.multiplayer.roomFlavor.lobby")
          : room.roomType === "public_overflow"
            ? t("splash.multiplayer.roomFlavor.overflow")
            : t("splash.multiplayer.roomFlavor.custom");
      const sessionState = room.sessionComplete
        ? t("splash.multiplayer.roomState.complete")
        : t("splash.multiplayer.roomState.active", { count: room.activeHumanCount });
      const joinability =
        availableSlots > 0
          ? t("splash.multiplayer.joinability.openSeats", { count: availableSlots })
          : t("splash.multiplayer.joinability.full");

      const card = document.createElement("button");
      card.type = "button";
      card.className = "splash-room-card";
      card.dataset.roomSessionId = room.sessionId;
      card.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) {
        card.classList.add("is-selected");
      }
      if (availableSlots <= 0 || room.sessionComplete) {
        card.classList.add("is-full");
      }

      const header = document.createElement("div");
      header.className = "splash-room-card-head";
      const code = document.createElement("strong");
      code.textContent = room.roomCode;
      const badges = document.createElement("div");
      badges.className = "splash-room-card-badges";
      const difficultyBadge = document.createElement("span");
      difficultyBadge.className = `splash-room-card-difficulty is-${roomDifficulty}`;
      difficultyBadge.textContent =
        roomDifficulty === "easy"
          ? t("difficulty.easy")
          : roomDifficulty === "hard"
            ? t("difficulty.hard")
            : t("difficulty.normal");
      const flavor = document.createElement("span");
      flavor.className = "splash-room-card-flavor";
      flavor.textContent = roomFlavor;
      badges.append(difficultyBadge, flavor);
      header.append(code, badges);

      const players = document.createElement("p");
      players.className = "splash-room-card-stat";
      players.textContent = t("splash.multiplayer.roomCard.players", {
        count: room.humanCount,
        max: maxPlayers,
      });

      const state = document.createElement("p");
      state.className = "splash-room-card-stat";
      state.textContent = sessionState;

      const expires = document.createElement("p");
      expires.className = "splash-room-card-stat";
      expires.textContent = t("splash.multiplayer.roomCard.expires", {
        minutes: expiresMinutes,
      });

      const footer = document.createElement("div");
      footer.className = "splash-room-card-footer";
      const seats = document.createElement("span");
      seats.textContent = joinability;
      const cta = document.createElement("span");
      cta.textContent = isSelected
        ? t("splash.multiplayer.roomCard.selected")
        : availableSlots > 0
          ? t("splash.multiplayer.roomCard.join")
          : t("splash.multiplayer.roomCard.full");
      footer.append(seats, cta);

      card.append(header, players, state, expires, footer);
      fragment.appendChild(card);
    });

    roomGrid.appendChild(fragment);
    this.appendRoomGridPlaceholders(roomGrid, pageSize - pagedRooms.length);
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
    if (this.isPrivateRoomModeEnabled()) {
      if (!this.privateRoomCode) {
        const joinSeedNote = this.getJoinBotSeedStatusNote();
        statusEl.textContent = joinSeedNote
          ? t("splash.multiplayer.status.privateReadyWithNote", {
              note: joinSeedNote,
            })
          : t("splash.multiplayer.status.privateReady");
        return;
      }
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
        const expiresInMinutes = this.resolveRoomExpiresInMinutes(selected);
        const { availableSlots } = this.resolveRoomCapacity(selected);
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
    const filteredRooms = this.getFilteredRooms();
    if (this.roomList.length > 0 && filteredRooms.length === 0) {
      statusEl.textContent = t("splash.multiplayer.status.noMatchingRooms");
      return;
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
      this.renderRoomCards();
      this.updateRoomStatus();
      return;
    }

    const refreshButton = this.container.querySelector<HTMLButtonElement>("#splash-room-refresh");
    this.roomListLoading = true;
    if (refreshButton) {
      refreshButton.disabled = true;
    }
    this.renderRoomCards();
    this.updateRoomStatus();

    try {
      const { backendApiService } = await import("../services/backendApi.js");
      const rooms = await backendApiService.listMultiplayerRooms(100);
      this.roomList = Array.isArray(rooms) ? rooms : [];
      const priorSelection = this.selectedRoomSessionId;
      const canRestoreSelection =
        typeof priorSelection === "string" &&
        priorSelection.length > 0 &&
        !this.isPrivateRoomModeEnabled() &&
        this.roomList.some((room) => room.sessionId === priorSelection);
      this.selectedRoomSessionId = canRestoreSelection ? priorSelection : null;
      this.syncSelectedRoomWithVisibleRooms();
    } catch (error) {
      log.warn("Failed to refresh room list", error);
      this.roomList = [];
      this.selectedRoomSessionId = null;
    } finally {
      this.roomListLoading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
      }
      this.renderRoomCards();
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
    const privateRoomEnabled = this.playMode === "multiplayer" && this.isPrivateRoomModeEnabled();
    const validationError = privateRoomEnabled
      ? this.getRoomCodeValidationError(this.privateRoomCode)
      : null;
    const shouldShowFeedback = privateRoomEnabled;
    const feedbackMessage = validationError
      ? validationError
      : this.roomCodeFeedback?.message ?? "";
    const feedbackTone = validationError ? "error" : this.roomCodeFeedback?.tone ?? null;
    const showErrorState = shouldShowFeedback && feedbackTone === "error";

    if (roomCodeInput) {
      roomCodeInput.setAttribute("aria-invalid", showErrorState ? "true" : "false");
      roomCodeInput.disabled = this.roomCodeJoinInFlight || !privateRoomEnabled;
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
        !privateRoomEnabled ||
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
    if (!this.isPrivateRoomModeEnabled()) {
      this.privateRoomMode = true;
      this.selectedRoomSessionId = null;
      this.updatePrivateRoomModeUi();
      this.updateMultiplayerDifficultyUi();
      this.renderRoomCards();
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
        gameDifficulty: this.multiplayerDifficulty,
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
          gameDifficulty: this.multiplayerDifficulty,
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
