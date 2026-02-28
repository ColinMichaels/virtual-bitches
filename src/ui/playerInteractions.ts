export interface PlayerInteractionParticipant {
  playerId: string;
  label: string;
  avatarUrl?: string;
  isBot: boolean;
  isSeated: boolean;
  isReady: boolean;
  queuedForNextGame: boolean;
  isComplete: boolean;
  score: number;
}

export interface PlayerInteractionRecentRun {
  score: number;
  difficulty: "easy" | "normal" | "hard";
  durationMs: number;
}

export interface PlayerInteractionProfileData {
  playerId: string;
  totalGames: number;
  bestScore: number | null;
  averageScore: number | null;
  totalPlayTimeMs: number;
  recentRuns: PlayerInteractionRecentRun[];
  profileUpdatedAt?: number;
}

export interface PlayerInteractionsPanelOptions {
  mountRoot: HTMLElement | null;
  localPlayerId: string;
  comingSoonTooltip?: string;
  onInfo?: (message: string) => void;
  onWhisper: (playerId: string) => void;
  onCauseChaos: (playerId: string) => void;
  onNudge: (playerId: string) => void;
  loadProfile: (playerId: string) => Promise<PlayerInteractionProfileData | null>;
  resolveWhisperDisabledReason?: (participant: PlayerInteractionParticipant) => string;
  resolveChaosDisabledReason?: (participant: PlayerInteractionParticipant) => string;
  resolveNudgeDisabledReason?: (
    participant: PlayerInteractionParticipant,
    activeTurnPlayerId: string | null
  ) => string;
}

const DEFAULT_COMING_SOON_TOOLTIP = "Coming soon";

export class PlayerInteractionsPanel {
  private readonly options: PlayerInteractionsPanelOptions;
  private readonly comingSoonTooltip: string;
  private readonly participantsById = new Map<string, PlayerInteractionParticipant>();
  private participantOrder: string[] = [];
  private activeTurnPlayerId: string | null = null;
  private selectedPlayerId: string | null = null;
  private profileRequestToken = 0;

  private chipRailEl: HTMLElement | null = null;
  private modalEl: HTMLElement | null = null;
  private targetEl: HTMLElement | null = null;
  private actionsEl: HTMLElement | null = null;
  private profileBodyEl: HTMLElement | null = null;

  constructor(options: PlayerInteractionsPanelOptions) {
    this.options = options;
    this.comingSoonTooltip = (options.comingSoonTooltip ?? DEFAULT_COMING_SOON_TOOLTIP).trim();
    this.ensureChipRail();
    this.ensureModal();
  }

  updateParticipants(
    participants: PlayerInteractionParticipant[],
    activeTurnPlayerId: string | null
  ): void {
    this.activeTurnPlayerId = activeTurnPlayerId;
    this.participantsById.clear();
    this.participantOrder = [];

    participants.forEach((participant) => {
      if (!participant || typeof participant.playerId !== "string") {
        return;
      }
      const normalizedId = participant.playerId.trim();
      if (!normalizedId || normalizedId === this.options.localPlayerId) {
        return;
      }
      this.participantsById.set(normalizedId, {
        ...participant,
        playerId: normalizedId,
      });
      this.participantOrder.push(normalizedId);
    });

    this.renderChipRail();

    if (!this.selectedPlayerId) {
      return;
    }
    const participant = this.participantsById.get(this.selectedPlayerId);
    if (!participant) {
      this.close();
      this.options.onInfo?.("That player left the table.");
      return;
    }
    if (this.isOpen()) {
      this.renderModalForParticipant(participant);
    }
  }

  setActiveTurnPlayer(activeTurnPlayerId: string | null): void {
    this.activeTurnPlayerId = activeTurnPlayerId;
    this.syncChipSelectionState();
    if (!this.selectedPlayerId || !this.isOpen()) {
      return;
    }
    const participant = this.participantsById.get(this.selectedPlayerId);
    if (!participant) {
      return;
    }
    this.renderModalForParticipant(participant);
  }

  open(playerId: string): void {
    const normalizedId = typeof playerId === "string" ? playerId.trim() : "";
    if (!normalizedId || normalizedId === this.options.localPlayerId) {
      return;
    }
    const participant = this.participantsById.get(normalizedId);
    if (!participant) {
      this.options.onInfo?.("Player interaction unavailable right now.");
      return;
    }

    const modal = this.ensureModal();
    if (!modal) {
      return;
    }

    this.selectedPlayerId = normalizedId;
    modal.style.display = "flex";
    this.renderModalForParticipant(participant);
    this.syncChipSelectionState();
    this.renderProfileLoading();
    void this.loadProfile(normalizedId);
  }

  close(): void {
    if (!this.modalEl) {
      return;
    }
    this.modalEl.style.display = "none";
    this.selectedPlayerId = null;
    this.profileRequestToken += 1;
    this.syncChipSelectionState();
  }

  clear(): void {
    this.close();
    this.participantsById.clear();
    this.participantOrder = [];
    this.activeTurnPlayerId = null;
    if (this.chipRailEl) {
      this.chipRailEl.innerHTML = "";
      this.chipRailEl.style.display = "none";
      this.chipRailEl.classList.remove("has-targets");
    }
  }

  isOpen(): boolean {
    return this.modalEl?.style.display === "flex";
  }

  private ensureChipRail(): HTMLElement | null {
    if (this.chipRailEl) {
      return this.chipRailEl;
    }

    const existing = document.getElementById("multiplayer-player-chip-rail");
    if (existing) {
      this.chipRailEl = existing;
      return existing;
    }

    if (!this.options.mountRoot) {
      return null;
    }

    const rail = document.createElement("div");
    rail.id = "multiplayer-player-chip-rail";
    rail.className = "multiplayer-player-chip-rail";
    rail.setAttribute("aria-label", "Multiplayer player interactions");
    rail.style.display = "none";

    const diceRowEl = document.getElementById("dice-row");
    if (diceRowEl?.nextSibling) {
      this.options.mountRoot.insertBefore(rail, diceRowEl.nextSibling);
    } else if (diceRowEl) {
      this.options.mountRoot.appendChild(rail);
    } else {
      this.options.mountRoot.appendChild(rail);
    }

    this.chipRailEl = rail;
    return rail;
  }

  private ensureModal(): HTMLElement | null {
    if (this.modalEl) {
      return this.modalEl;
    }

    const existing = document.getElementById("player-interaction-modal");
    if (existing) {
      this.modalEl = existing;
      this.targetEl = existing.querySelector(".player-interaction-target");
      this.actionsEl = existing.querySelector(".player-interaction-actions");
      this.profileBodyEl = existing.querySelector(".player-interaction-profile-body");
      return existing;
    }

    const modal = document.createElement("div");
    modal.id = "player-interaction-modal";
    modal.className = "modal player-interaction-modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content player-interaction-modal-content">
        <div class="modal-header">
          <h2>Player Interactions</h2>
          <button class="modal-close player-interaction-close" title="Close (ESC)">&times;</button>
        </div>
        <section class="player-interaction-target"></section>
        <section class="player-interaction-actions"></section>
        <section class="player-interaction-profile">
          <div class="player-interaction-profile-header">
            <h3>Profile &amp; Stats</h3>
            <button type="button" class="player-interaction-refresh-btn splash-multiplayer-icon-btn" title="Refresh profile and stats" aria-label="Refresh profile and stats">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true">
                <path d="M20 11a8 8 0 1 0 2.3 5.7"/>
                <path d="M20 4v7h-7"/>
              </svg>
            </button>
          </div>
          <div class="player-interaction-profile-body"></div>
        </section>
      </div>
    `;

    modal.querySelector(".player-interaction-close")?.addEventListener("click", () => {
      this.close();
    });
    modal.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      this.close();
    });
    const refreshBtn = modal.querySelector<HTMLButtonElement>(".player-interaction-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        const targetPlayerId = this.selectedPlayerId;
        if (!targetPlayerId) {
          return;
        }
        this.renderProfileLoading();
        void this.loadProfile(targetPlayerId);
      });
    }

    document.body.appendChild(modal);
    this.modalEl = modal;
    this.targetEl = modal.querySelector(".player-interaction-target");
    this.actionsEl = modal.querySelector(".player-interaction-actions");
    this.profileBodyEl = modal.querySelector(".player-interaction-profile-body");
    return modal;
  }

  private renderChipRail(): void {
    const rail = this.chipRailEl ?? this.ensureChipRail();
    if (!rail) {
      return;
    }
    rail.innerHTML = "";
    rail.classList.toggle("has-targets", this.participantOrder.length > 0);
    rail.style.display = "flex";

    if (this.participantOrder.length === 0) {
      const empty = document.createElement("div");
      empty.className = "multiplayer-player-chip-empty";
      empty.textContent = "No seated rivals yet. Share the room code and bring chaos.";
      rail.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    this.participantOrder.forEach((playerId) => {
      const participant = this.participantsById.get(playerId);
      if (!participant) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "multiplayer-player-chip";
      button.dataset.playerId = participant.playerId;
      button.classList.toggle("is-active-turn", this.activeTurnPlayerId === participant.playerId);
      button.classList.toggle(
        "is-selected",
        this.selectedPlayerId === participant.playerId && this.isOpen()
      );

      const avatar = this.createAvatarElement(participant, "multiplayer-player-chip-avatar");
      button.appendChild(avatar);

      const details = document.createElement("span");
      details.className = "multiplayer-player-chip-details";
      const nameEl = document.createElement("span");
      nameEl.className = "multiplayer-player-chip-name";
      nameEl.textContent = participant.label;
      const statusEl = document.createElement("span");
      statusEl.className = "multiplayer-player-chip-status";
      statusEl.textContent = this.resolveParticipantStatus(participant);
      details.appendChild(nameEl);
      details.appendChild(statusEl);
      button.appendChild(details);

      button.addEventListener("click", () => {
        this.open(participant.playerId);
      });

      fragment.appendChild(button);
    });

    rail.appendChild(fragment);
  }

  private syncChipSelectionState(): void {
    const rail = this.chipRailEl;
    if (!rail) {
      return;
    }
    const buttons = rail.querySelectorAll<HTMLButtonElement>(".multiplayer-player-chip");
    buttons.forEach((button) => {
      const playerId = button.dataset.playerId ?? "";
      button.classList.toggle("is-active-turn", playerId === this.activeTurnPlayerId);
      button.classList.toggle("is-selected", playerId === this.selectedPlayerId && this.isOpen());
    });
  }

  private renderModalForParticipant(participant: PlayerInteractionParticipant): void {
    this.renderTargetHeader(participant);
    this.renderActionButtons(participant);
  }

  private renderTargetHeader(participant: PlayerInteractionParticipant): void {
    const targetEl = this.targetEl;
    if (!targetEl) {
      return;
    }
    targetEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "player-interaction-target-card";

    const avatar = this.createAvatarElement(participant, "player-interaction-target-avatar");
    header.appendChild(avatar);

    const details = document.createElement("div");
    details.className = "player-interaction-target-details";
    const nameEl = document.createElement("strong");
    nameEl.textContent = participant.label;
    const statusEl = document.createElement("span");
    statusEl.textContent = this.resolveParticipantStatus(participant);
    const scoreEl = document.createElement("span");
    scoreEl.textContent = `Score: ${participant.score}`;
    details.appendChild(nameEl);
    details.appendChild(statusEl);
    details.appendChild(scoreEl);
    header.appendChild(details);
    targetEl.appendChild(header);
  }

  private renderActionButtons(participant: PlayerInteractionParticipant): void {
    const actionsEl = this.actionsEl;
    if (!actionsEl) {
      return;
    }
    actionsEl.innerHTML = "";

    const whisperDisabledReason = (
      this.options.resolveWhisperDisabledReason?.(participant) ??
      (participant.isBot ? "Bots cannot receive whispers yet." : !participant.isSeated ? "Player is currently standing." : "")
    ).trim();
    actionsEl.appendChild(
      this.createActionButton({
        label: "Whisper",
        description: "Send a private room message.",
        disabledReason: whisperDisabledReason,
        onClick: () => this.options.onWhisper(participant.playerId),
      })
    );

    actionsEl.appendChild(
      this.createActionButton({
        label: "View Profile/Stats",
        description: "Refresh and show player performance details.",
        onClick: () => {
          this.renderProfileLoading();
          void this.loadProfile(participant.playerId);
        },
      })
    );

    const chaosDisabledReason = (
      this.options.resolveChaosDisabledReason?.(participant) ??
      (!participant.isSeated ? "Player must be seated to target chaos." : "")
    ).trim();
    actionsEl.appendChild(
      this.createActionButton({
        label: "Cause Chaos",
        description: "Pick a camera attack and send it instantly.",
        tone: "chaos",
        disabledReason: chaosDisabledReason,
        onClick: () => this.options.onCauseChaos(participant.playerId),
      })
    );

    const nudgeDisabledReason = (
      this.options.resolveNudgeDisabledReason?.(participant, this.activeTurnPlayerId) ??
      (this.activeTurnPlayerId === participant.playerId
        ? ""
        : "Nudge unlocks when this player is active.")
    ).trim();
    actionsEl.appendChild(
      this.createActionButton({
        label: "Nudge Turn",
        description: "Ping them when it is their turn.",
        disabledReason: nudgeDisabledReason,
        onClick: () => this.options.onNudge(participant.playerId),
      })
    );

    actionsEl.appendChild(
      this.createActionButton({
        label: "Send Gift",
        description: "Economy hooks are scaffolded but disabled.",
        disabledReason: this.comingSoonTooltip,
        comingSoon: true,
      })
    );
    actionsEl.appendChild(
      this.createActionButton({
        label: "Add Friend",
        description: "Friends service plumbing is not live yet.",
        disabledReason: this.comingSoonTooltip,
        comingSoon: true,
      })
    );
  }

  private createActionButton(options: {
    label: string;
    description: string;
    tone?: "default" | "chaos";
    disabledReason?: string;
    comingSoon?: boolean;
    onClick?: () => void;
  }): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-interaction-action";
    if (options.tone === "chaos") {
      button.classList.add("is-chaos");
    }

    const title = document.createElement("span");
    title.className = "player-interaction-action-title";
    title.textContent = options.label;

    const desc = document.createElement("span");
    desc.className = "player-interaction-action-desc";
    desc.textContent = options.description;

    button.appendChild(title);
    button.appendChild(desc);

    const disabledReason = (options.disabledReason ?? "").trim();
    if (disabledReason) {
      button.classList.add("is-disabled");
      button.setAttribute("aria-disabled", "true");
      button.dataset.tooltip = disabledReason;
    }

    if (options.comingSoon) {
      button.dataset.comingSoon = "true";
    }

    button.addEventListener("click", () => {
      if (button.classList.contains("is-disabled")) {
        if (disabledReason) {
          this.options.onInfo?.(disabledReason);
        }
        return;
      }
      options.onClick?.();
    });

    return button;
  }

  private createAvatarElement(
    participant: PlayerInteractionParticipant,
    className: string
  ): HTMLElement {
    const avatarWrap = document.createElement("span");
    avatarWrap.className = className;

    const avatarUrl =
      typeof participant.avatarUrl === "string" ? participant.avatarUrl.trim() : "";
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      avatarWrap.appendChild(image);
      return avatarWrap;
    }

    const initial = document.createElement("span");
    initial.className = `${className}-initial`;
    initial.textContent = this.getPlayerInitial(participant.label);
    avatarWrap.appendChild(initial);
    return avatarWrap;
  }

  private resolveParticipantStatus(participant: PlayerInteractionParticipant): string {
    if (participant.playerId === this.activeTurnPlayerId) {
      return "Taking Turn";
    }
    if (participant.queuedForNextGame) {
      return "Queued";
    }
    if (!participant.isSeated) {
      return "Standing";
    }
    if (participant.isComplete) {
      return "Round Complete";
    }
    if (participant.isBot) {
      return "Bot Ready";
    }
    return participant.isReady ? "Ready" : "Not Ready";
  }

  private renderProfileLoading(): void {
    if (!this.profileBodyEl) {
      return;
    }
    this.profileBodyEl.innerHTML = "";
    const loading = document.createElement("p");
    loading.className = "player-interaction-profile-note";
    loading.textContent = "Loading profile and stats...";
    this.profileBodyEl.appendChild(loading);
  }

  private renderProfileError(message: string): void {
    if (!this.profileBodyEl) {
      return;
    }
    this.profileBodyEl.innerHTML = "";
    const error = document.createElement("p");
    error.className = "player-interaction-profile-note is-error";
    error.textContent = message;
    this.profileBodyEl.appendChild(error);
  }

  private async loadProfile(playerId: string): Promise<void> {
    const requestToken = ++this.profileRequestToken;
    try {
      const profileData = await this.options.loadProfile(playerId);
      if (
        requestToken !== this.profileRequestToken ||
        this.selectedPlayerId !== playerId ||
        !this.isOpen()
      ) {
        return;
      }
      if (!profileData) {
        this.renderProfileError("No profile data available yet.");
        return;
      }
      this.renderProfileData(profileData);
    } catch {
      if (
        requestToken !== this.profileRequestToken ||
        this.selectedPlayerId !== playerId ||
        !this.isOpen()
      ) {
        return;
      }
      this.renderProfileError("Unable to load profile right now.");
    }
  }

  private renderProfileData(profileData: PlayerInteractionProfileData): void {
    if (!this.profileBodyEl) {
      return;
    }
    this.profileBodyEl.innerHTML = "";

    const statGrid = document.createElement("div");
    statGrid.className = "player-interaction-stats-grid";
    const entries: Array<{ label: string; value: string }> = [
      { label: "Player ID", value: profileData.playerId },
      { label: "Games", value: String(profileData.totalGames) },
      {
        label: "Best",
        value:
          profileData.totalGames > 0 && typeof profileData.bestScore === "number"
            ? String(profileData.bestScore)
            : "-",
      },
      {
        label: "Average",
        value:
          profileData.totalGames > 0 && typeof profileData.averageScore === "number"
            ? String(profileData.averageScore)
            : "-",
      },
      {
        label: "Play Time",
        value:
          profileData.totalGames > 0
            ? this.formatDurationShort(profileData.totalPlayTimeMs)
            : "-",
      },
    ];

    entries.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "player-interaction-stat";
      const label = document.createElement("span");
      label.className = "player-interaction-stat-label";
      label.textContent = entry.label;
      const value = document.createElement("span");
      value.className = "player-interaction-stat-value";
      value.textContent = entry.value;
      row.appendChild(label);
      row.appendChild(value);
      statGrid.appendChild(row);
    });
    this.profileBodyEl.appendChild(statGrid);

    if (profileData.recentRuns.length > 0) {
      const recent = document.createElement("div");
      recent.className = "player-interaction-recent";
      const title = document.createElement("p");
      title.className = "player-interaction-profile-note";
      title.textContent = "Recent Runs";
      recent.appendChild(title);

      profileData.recentRuns.slice(0, 3).forEach((entry, index) => {
        const line = document.createElement("p");
        line.className = "player-interaction-profile-line";
        line.textContent = `#${index + 1} ${entry.score} pts • ${entry.difficulty} • ${this.formatDurationShort(entry.durationMs)}`;
        recent.appendChild(line);
      });
      this.profileBodyEl.appendChild(recent);
    }

    if (typeof profileData.profileUpdatedAt === "number") {
      const updated = document.createElement("p");
      updated.className = "player-interaction-profile-note";
      updated.textContent = `Profile updated ${this.formatTimestampShort(profileData.profileUpdatedAt)}`;
      this.profileBodyEl.appendChild(updated);
    }
  }

  private formatDurationShort(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
      return "0s";
    }
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes <= 0) {
      return `${seconds}s`;
    }
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }

  private formatTimestampShort(value: number): string {
    try {
      return new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "recently";
    }
  }

  private getPlayerInitial(label: string): string {
    const normalized = label.trim();
    if (!normalized) {
      return "P";
    }
    return normalized.charAt(0).toUpperCase();
  }
}
