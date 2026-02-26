/**
 * Splash Screen
 * Home screen with lazily loaded floating-dice background.
 */

import { audioService } from "../services/audio.js";
import { environment } from "../environments/environment.js";
import { logger } from "../utils/logger.js";
import type { SplashBackground3D } from "./splashBackground3d.js";

const log = logger.create("SplashScreen");

export type SplashPlayMode = "solo" | "multiplayer";

export interface SplashStartOptions {
  playMode: SplashPlayMode;
  multiplayer?: {
    botCount: number;
  };
}

export class SplashScreen {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private background3d: SplashBackground3D | null = null;
  private backgroundLoadPromise: Promise<void> | null = null;
  private playMode: SplashPlayMode = "solo";
  private botCount = 1;
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
        <h1 class="splash-title">${this.gameTitle}</h1>
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
          <label for="splash-bot-count">Testing Bots</label>
          <select id="splash-bot-count">
            <option value="0">0 (human-only)</option>
            <option value="1" selected>1 bot</option>
            <option value="2">2 bots</option>
            <option value="3">3 bots</option>
          </select>
          <p>Bots send lightweight update and chaos events for multiplayer testing.</p>
        </div>
        <div class="splash-buttons">
          <button id="start-game-btn" class="primary splash-btn">Start Game</button>
          <button id="splash-rules-btn" class="splash-btn">How to Play</button>
          <button id="splash-leaderboard-btn" class="splash-btn">Leaderboard</button>
          <button id="splash-settings-btn" class="splash-btn">Settings</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
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

    document.getElementById("start-game-btn")?.addEventListener("click", async () => {
      audioService.playSfx("click");
      const startButton = document.getElementById("start-game-btn") as HTMLButtonElement | null;
      if (startButton?.disabled) {
        return;
      }

      if (startButton) {
        startButton.disabled = true;
      }

      try {
        const shouldStart = await Promise.resolve(
          onStart({
            playMode: this.playMode,
            multiplayer:
              this.playMode === "multiplayer"
                ? {
                    botCount: this.botCount,
                  }
                : undefined,
          })
        );
        if (!shouldStart) {
          return;
        }
        this.hide();
      } finally {
        if (startButton) {
          startButton.disabled = false;
        }
      }
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
      this.background3d?.dispose();
      this.background3d = null;
      this.backgroundLoadPromise = null;
    }, 500);
  }

  dispose(): void {
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
  }
}
