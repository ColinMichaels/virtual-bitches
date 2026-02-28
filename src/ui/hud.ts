import { GameState, GameDifficulty } from "../engine/types.js";
import { getDiceCounts } from "../engine/rules.js";
import { t } from "../i18n/index.js";

const TIME_ATTACK_DURATION_MS = 5 * 60 * 1000;

interface MultiplayerHudStandingEntry {
  playerId: string;
  label: string;
  score: number;
  placement: number;
  isBot: boolean;
  isComplete: boolean;
  isCurrentPlayer: boolean;
}

export class HUD {
  private rollCountEl: HTMLElement;
  private scoreEl: HTMLElement;
  private elapsedTimeEl: HTMLElement;
  private turnTimerEl: HTMLElement;
  private turnSyncIndicatorEl: HTMLElement | null;
  private localWaitStatusEl: HTMLElement | null;
  private poolListEl: HTMLElement;
  private modeDisplayEl: HTMLElement;
  private modeDropdownEl: HTMLElement;
  private multiplayerStandingsEl: HTMLElement | null;
  private isDropdownOpen: boolean = false;
  private onModeChange: ((difficulty: GameDifficulty) => void) | null = null;
  private onMultiplayerPlayerSelect: ((playerId: string) => void) | null = null;
  private gameStartAtMs = Date.now();
  private roundCountdownDeadlineAtMs: number | null = null;
  private turnDeadlineAtMs: number | null = null;
  private currentVariant: GameState["mode"]["variant"] = "classic";
  private multiplayerStandings: MultiplayerHudStandingEntry[] = [];
  private multiplayerActivePlayerId: string | null = null;
  private multiplayerSelectedPlayerId: string | null = null;

  constructor() {
    this.rollCountEl = document.getElementById("roll-count")!;
    this.scoreEl = document.getElementById("score")!;
    this.elapsedTimeEl = document.getElementById("elapsed-time")!;
    this.turnTimerEl = document.getElementById("turn-timer")!;
    this.turnSyncIndicatorEl = document.getElementById("turn-sync-indicator");
    this.localWaitStatusEl = document.getElementById("local-wait-status");
    this.poolListEl = document.getElementById("pool-list")!;
    this.modeDisplayEl = document.getElementById("mode-display")!;
    this.modeDropdownEl = document.getElementById("mode-dropdown")!;
    this.multiplayerStandingsEl = document.getElementById("multiplayer-scoreboard");

    // Setup mode switcher
    this.setupModeSwitcher();
  }

  private setupModeSwitcher() {
    // Toggle dropdown on click
    this.modeDisplayEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Handle mode selection
    this.modeDropdownEl.querySelectorAll('.mode-option').forEach((option) => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const difficulty = (option as HTMLElement).dataset.mode as GameDifficulty;
        if (this.onModeChange) {
          this.onModeChange(difficulty);
        }
        this.closeDropdown();
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.closeDropdown();
    });
  }

  private toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.modeDropdownEl.style.display = this.isDropdownOpen ? 'block' : 'none';
  }

  private closeDropdown() {
    this.isDropdownOpen = false;
    this.modeDropdownEl.style.display = 'none';
  }

  setOnModeChange(callback: (difficulty: GameDifficulty) => void) {
    this.onModeChange = callback;
  }

  setOnMultiplayerPlayerSelect(callback: ((playerId: string) => void) | null): void {
    this.onMultiplayerPlayerSelect = callback;
    this.renderMultiplayerStandings();
  }

  setMultiplayerSelectedPlayer(playerId: string | null): void {
    this.multiplayerSelectedPlayerId =
      typeof playerId === "string" && playerId.trim().length > 0 ? playerId.trim() : null;
    this.renderMultiplayerStandings();
  }

  setMultiplayerStandings(
    entries: Array<{
      playerId: string;
      label: string;
      score: number;
      placement: number;
      isBot: boolean;
      isComplete: boolean;
      isCurrentPlayer: boolean;
    }>,
    activePlayerId: string | null
  ): void {
    this.multiplayerStandings = Array.isArray(entries)
      ? entries
          .filter((entry) => entry && typeof entry.playerId === "string")
          .map((entry, index) => ({
            playerId: entry.playerId,
            label:
              typeof entry.label === "string" && entry.label.trim().length > 0
                ? entry.label.trim().slice(0, 20)
                : t("shell.multiplayer.playerFallback", {
                    id: entry.playerId.slice(0, 4),
                  }),
            score:
              typeof entry.score === "number" && Number.isFinite(entry.score)
                ? Math.max(0, Math.floor(entry.score))
                : 0,
            placement:
              typeof entry.placement === "number" && Number.isFinite(entry.placement)
                ? Math.max(1, Math.floor(entry.placement))
                : index + 1,
            isBot: entry.isBot === true,
            isComplete: entry.isComplete === true,
            isCurrentPlayer: entry.isCurrentPlayer === true,
          }))
      : [];
    this.multiplayerActivePlayerId =
      typeof activePlayerId === "string" && activePlayerId.trim().length > 0
        ? activePlayerId
        : null;
    if (
      this.multiplayerSelectedPlayerId &&
      !this.multiplayerStandings.some((entry) => entry.playerId === this.multiplayerSelectedPlayerId)
    ) {
      this.multiplayerSelectedPlayerId = null;
    }
    this.renderMultiplayerStandings();
  }

  setMultiplayerActiveTurn(activePlayerId: string | null): void {
    this.multiplayerActivePlayerId =
      typeof activePlayerId === "string" && activePlayerId.trim().length > 0
        ? activePlayerId
        : null;
    this.renderMultiplayerStandings();
  }

  setGameClockStart(startAtMs: number): void {
    this.gameStartAtMs = Number.isFinite(startAtMs) ? startAtMs : Date.now();
    this.tick();
  }

  setRoundCountdownDeadline(deadlineAtMs: number | null): void {
    this.roundCountdownDeadlineAtMs =
      typeof deadlineAtMs === "number" && Number.isFinite(deadlineAtMs) && deadlineAtMs > 0
        ? Math.floor(deadlineAtMs)
        : null;
    this.tick();
  }

  setTurnDeadline(deadlineAtMs: number | null): void {
    this.turnDeadlineAtMs =
      typeof deadlineAtMs === "number" && Number.isFinite(deadlineAtMs) && deadlineAtMs > 0
        ? deadlineAtMs
        : null;
    this.tick();
  }

  setTurnSyncStatus(
    status: "ok" | "syncing" | "stale" | "error" | null,
    message?: string
  ): void {
    if (!this.turnSyncIndicatorEl) {
      return;
    }

    if (!status) {
      this.turnSyncIndicatorEl.style.display = "none";
      this.turnSyncIndicatorEl.textContent = "";
      this.turnSyncIndicatorEl.classList.remove(
        "is-sync-ok",
        "is-sync-syncing",
        "is-sync-stale",
        "is-sync-error"
      );
      return;
    }

    const defaultLabels = {
      ok: t("shell.turnSync.ok"),
      syncing: t("shell.turnSync.syncing"),
      stale: t("shell.turnSync.stale"),
      error: t("shell.turnSync.error"),
    };

    this.turnSyncIndicatorEl.style.display = "inline";
    this.turnSyncIndicatorEl.classList.remove(
      "is-sync-ok",
      "is-sync-syncing",
      "is-sync-stale",
      "is-sync-error"
    );
    this.turnSyncIndicatorEl.classList.add(`is-sync-${status}`);
    this.turnSyncIndicatorEl.textContent =
      typeof message === "string" && message.trim().length > 0
        ? message.trim().slice(0, 40)
        : defaultLabels[status];
  }

  setLocalWaitStatus(label: string | null): void {
    if (!this.localWaitStatusEl) {
      return;
    }
    const normalized = typeof label === "string" ? label.trim() : "";
    if (!normalized) {
      this.localWaitStatusEl.style.display = "none";
      this.localWaitStatusEl.textContent = "";
      return;
    }

    this.localWaitStatusEl.style.display = "inline";
    this.localWaitStatusEl.textContent = normalized.slice(0, 20);
  }

  update(state: GameState) {
    this.currentVariant = state.mode.variant;

    // Update basic stats
    this.rollCountEl.textContent = state.rollIndex.toString();
    this.scoreEl.textContent = state.score.toString();

    // Update mode display
    const difficultyName = this.getDifficultyLabel(state.mode.difficulty);
    const labelNode = this.modeDisplayEl.querySelector<HTMLElement>("#mode-display-label");
    if (labelNode) {
      labelNode.textContent = difficultyName;
    }

    // Add color classes for different modes
    this.modeDisplayEl.className = "stat-value-compact mode-switcher";
    if (state.mode.difficulty === "easy") {
      this.modeDisplayEl.classList.add("mode-easy");
    } else if (state.mode.difficulty === "hard") {
      this.modeDisplayEl.classList.add("mode-hard");
    }

    // Update dropdown active state
    this.modeDropdownEl.querySelectorAll('.mode-option').forEach((option) => {
      const optionMode = (option as HTMLElement).dataset.mode;
      if (optionMode === state.mode.difficulty) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });

    // Update dice pool (inline display in stats bar)
    const counts = getDiceCounts(state.dice);
    this.poolListEl.innerHTML = "";

    if (counts.size === 0) {
      this.poolListEl.innerHTML = `<div style="opacity:0.5;font-size:11px;">${t("shell.hud.allScored")}</div>`;
    } else {
      counts.forEach((count, kind) => {
        const div = document.createElement("div");
        div.className = "die-count";

        const sides = parseInt(kind.substring(1)); // Extract number from "d6", "d12", etc.
        const shape = this.getDieShape(sides);

        div.innerHTML = `<span>${shape} ${kind} ×${count}</span>`;
        this.poolListEl.appendChild(div);
      });
    }

    this.tick();
  }

  tick(nowMs: number = Date.now()): void {
    const elapsedMs = Math.max(0, nowMs - this.gameStartAtMs);
    const roundCountdownDeadlineAtMs = this.roundCountdownDeadlineAtMs;
    const hasRoundCountdown =
      typeof roundCountdownDeadlineAtMs === "number" &&
      Number.isFinite(roundCountdownDeadlineAtMs) &&
      roundCountdownDeadlineAtMs > 0;
    if (hasRoundCountdown) {
      const remainingMs = Math.max(0, roundCountdownDeadlineAtMs - nowMs);
      this.elapsedTimeEl.textContent = this.formatClock(remainingMs);
      this.elapsedTimeEl.classList.remove("is-time-attack");
      this.elapsedTimeEl.classList.add("is-round-countdown");
      this.elapsedTimeEl.classList.toggle(
        "is-round-countdown-warning",
        remainingMs <= 15000 && remainingMs > 5000
      );
      this.elapsedTimeEl.classList.toggle("is-round-countdown-critical", remainingMs <= 5000);
    } else if (this.currentVariant === "timeAttack") {
      const remainingMs = Math.max(0, TIME_ATTACK_DURATION_MS - elapsedMs);
      this.elapsedTimeEl.textContent = this.formatClock(remainingMs);
      this.elapsedTimeEl.classList.add("is-time-attack");
      this.elapsedTimeEl.classList.remove(
        "is-round-countdown",
        "is-round-countdown-warning",
        "is-round-countdown-critical"
      );
    } else {
      this.elapsedTimeEl.textContent = this.formatClock(elapsedMs);
      this.elapsedTimeEl.classList.remove("is-time-attack");
      this.elapsedTimeEl.classList.remove(
        "is-round-countdown",
        "is-round-countdown-warning",
        "is-round-countdown-critical"
      );
    }

    if (!this.turnDeadlineAtMs) {
      this.turnTimerEl.style.display = "none";
      this.turnTimerEl.classList.remove("is-warning", "is-critical", "is-self-turn");
      return;
    }

    const remainingMs = Math.max(0, this.turnDeadlineAtMs - nowMs);
    const activeTurnEntry = this.multiplayerStandings.find(
      (entry) => entry.playerId === this.multiplayerActivePlayerId
    );
    const turnLabel = activeTurnEntry
      ? activeTurnEntry.isCurrentPlayer
        ? t("shell.turnLabel.yourTurn")
        : t("shell.turnLabel.playerTurn", { player: activeTurnEntry.label })
      : t("shell.turnLabel.default");
    this.turnTimerEl.style.display = "inline";
    this.turnTimerEl.textContent = `${turnLabel} ${this.formatClock(remainingMs)}`;
    this.turnTimerEl.classList.toggle("is-self-turn", activeTurnEntry?.isCurrentPlayer === true);
    this.turnTimerEl.classList.toggle("is-warning", remainingMs <= 15000 && remainingMs > 5000);
    this.turnTimerEl.classList.toggle("is-critical", remainingMs <= 5000);
  }

  private formatClock(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    const displayMinutes = minutes % 60;

    if (hours > 0) {
      return `${hours}:${displayMinutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    }

    return `${displayMinutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  private getDieShape(sides: number): string {
    // Unicode/emoji representations of die shapes
    const shapes: Record<number, string> = {
      4: "▲",   // Tetrahedron (triangle)
      6: "■",   // Cube (square)
      8: "◆",   // Octahedron (diamond)
      10: "⬟",  // Decahedron (kite/crystal)
      12: "⬢",  // Dodecahedron (hexagon)
      20: "⭓",  // Icosahedron (circle with dot)
    };
    return shapes[sides] || "●";
  }

  private getDifficultyLabel(difficulty: GameDifficulty): string {
    switch (difficulty) {
      case "easy":
        return t("difficulty.easy");
      case "hard":
        return t("difficulty.hard");
      case "normal":
      default:
        return t("difficulty.normal");
    }
  }

  private renderMultiplayerStandings(): void {
    if (!this.multiplayerStandingsEl) {
      return;
    }

    if (this.multiplayerStandings.length <= 1) {
      this.multiplayerStandingsEl.style.display = "none";
      this.multiplayerStandingsEl.innerHTML = "";
      return;
    }

    this.multiplayerStandingsEl.style.display = "flex";
    this.multiplayerStandingsEl.innerHTML = "";

    this.multiplayerStandings.forEach((entry) => {
      const selectable = Boolean(this.onMultiplayerPlayerSelect) && !entry.isCurrentPlayer;
      const row = document.createElement(selectable ? "button" : "div");
      row.className = "multiplayer-scoreboard__row";
      if (selectable) {
        row.classList.add("is-clickable");
        row.setAttribute("data-player-id", entry.playerId);
        row.setAttribute("title", `Open interactions for ${entry.label}`);
      }
      if (entry.isCurrentPlayer) {
        row.classList.add("is-self");
      }
      if (entry.isComplete) {
        row.classList.add("is-complete");
      }
      if (this.multiplayerActivePlayerId === entry.playerId) {
        row.classList.add("is-active-turn");
      }
      if (this.multiplayerSelectedPlayerId === entry.playerId) {
        row.classList.add("is-selected");
      }
      if (selectable) {
        const rowButton = row as HTMLButtonElement;
        rowButton.type = "button";
        rowButton.addEventListener("click", () => {
          this.onMultiplayerPlayerSelect?.(entry.playerId);
        });
      }

      const rank = document.createElement("span");
      rank.className = "multiplayer-scoreboard__rank";
      rank.textContent = `#${entry.placement}`;

      const name = document.createElement("span");
      name.className = "multiplayer-scoreboard__name";
      name.textContent = entry.label;

      const meta = document.createElement("span");
      meta.className = "multiplayer-scoreboard__meta";
      meta.textContent = entry.isComplete
        ? t("shell.multiplayer.meta.done")
        : entry.isBot
          ? t("shell.multiplayer.meta.bot")
          : t("shell.multiplayer.meta.live");

      const score = document.createElement("span");
      score.className = "multiplayer-scoreboard__score";
      score.textContent = `${entry.score}`;

      row.append(rank, name, meta, score);
      this.multiplayerStandingsEl?.appendChild(row);
    });
  }
}
