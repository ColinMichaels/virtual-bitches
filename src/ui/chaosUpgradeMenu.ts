import { audioService } from "../services/audio.js";
import { notificationService } from "./notifications.js";
import { logger } from "../utils/logger.js";
import { upgradeProgressionService } from "../chaos/upgrades/progressionService.js";
import { buildCameraAttackMessageFromProgression } from "../chaos/upgrades/executionProfile.js";
import { CAMERA_ABILITY_IDS } from "../chaos/upgrades/types.js";
import type { CameraAbilityId, CameraAbilityLevelDefinition, UnlockValidationResult } from "../chaos/upgrades/types.js";

const log = logger.create("ChaosUpgradeMenu");

const TRAINING_XP_REWARD = 25;

export class ChaosUpgradeMenu {
  private readonly container: HTMLElement;
  private readonly contentEl: HTMLElement;
  private isVisibleState = false;
  private unsubscribeProgression?: () => void;

  constructor() {
    this.container = this.createModal();
    this.contentEl = this.container.querySelector("#chaos-upgrade-content") as HTMLElement;
    document.body.appendChild(this.container);
    this.setupEventHandlers();

    this.unsubscribeProgression = upgradeProgressionService.on("changed", () => {
      if (this.isVisibleState) {
        this.render();
      }
    });
  }

  show(): void {
    if (this.isVisibleState) return;
    this.container.style.display = "flex";
    this.isVisibleState = true;
    this.render();
    log.debug("Chaos upgrade menu shown");
  }

  hide(): void {
    if (!this.isVisibleState) return;
    this.container.style.display = "none";
    this.isVisibleState = false;
    log.debug("Chaos upgrade menu hidden");
  }

  toggle(): void {
    if (this.isVisibleState) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.isVisibleState;
  }

  dispose(): void {
    if (this.unsubscribeProgression) {
      this.unsubscribeProgression();
      this.unsubscribeProgression = undefined;
    }
    this.container.remove();
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "chaos-upgrade-modal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content chaos-upgrade-modal-content">
        <div class="modal-header">
          <h2>Chaos Upgrades</h2>
          <button class="modal-close" id="chaos-upgrade-close-btn" title="Close (ESC)">&times;</button>
        </div>
        <div id="chaos-upgrade-content" class="chaos-upgrade-content"></div>
      </div>
    `;
    return modal;
  }

  private setupEventHandlers(): void {
    const closeBtn = this.container.querySelector("#chaos-upgrade-close-btn");
    closeBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
    });

    const backdrop = this.container.querySelector(".modal-backdrop");
    backdrop?.addEventListener("click", () => {
      this.hide();
    });

    this.container.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const actionBtn = target.closest<HTMLButtonElement>("[data-chaos-action]");
      if (!actionBtn) return;

      const action = actionBtn.dataset.chaosAction;
      if (!action) return;

      audioService.playSfx("click");
      switch (action) {
        case "add-tokens":
          this.handleAddTokens(actionBtn);
          break;
        case "train":
          this.handleTrainingXp(actionBtn);
          break;
        case "unlock":
          this.handleUnlock(actionBtn);
          break;
        case "grant-achievement":
          this.handleGrantAchievement(actionBtn);
          break;
        case "cast-local":
          this.handleCastLocal(actionBtn);
          break;
      }
    });
  }

  private render(): void {
    const tokenBalance = upgradeProgressionService.getTokenBalance();
    const abilityCards = CAMERA_ABILITY_IDS
      .map((abilityId) => this.renderAbilityCard(abilityId))
      .join("");

    this.contentEl.innerHTML = `
      <section class="chaos-upgrade-toolbar">
        <div class="chaos-token-box">
          <span class="chaos-token-label">Chaos Tokens</span>
          <span class="chaos-token-value">${tokenBalance}</span>
        </div>
        <div class="chaos-toolbar-actions">
          <button class="chaos-mini-btn" data-chaos-action="add-tokens" data-amount="25">+25 Tokens</button>
          <button class="chaos-mini-btn" data-chaos-action="add-tokens" data-amount="100">+100 Tokens</button>
        </div>
      </section>
      <section class="chaos-upgrade-grid">
        ${abilityCards}
      </section>
    `;
  }

  private renderAbilityCard(abilityId: CameraAbilityId): string {
    const tree = upgradeProgressionService.getUpgradeTree(abilityId);
    const progress = upgradeProgressionService.getAbilityProgress(abilityId);
    const nextUnlock = upgradeProgressionService.getNextUnlock(abilityId);

    const xpRequirement = nextUnlock?.definition.unlockRequirement.type === "xp"
      ? nextUnlock.definition.unlockRequirement.amount
      : null;
    const xpProgressPercent = xpRequirement
      ? Math.max(0, Math.min(100, Math.round((progress.xp / xpRequirement) * 100)))
      : 100;

    const levelsHtml = tree.levels
      .map((levelDef) => this.renderLevelRow(abilityId, levelDef, progress.unlockedLevel))
      .join("");

    const nextUnlockHtml = nextUnlock
      ? this.renderNextUnlockPanel(abilityId, nextUnlock.definition, nextUnlock.validation)
      : `<div class="chaos-upgrade-next complete">Max level unlocked</div>`;

    return `
      <article class="chaos-upgrade-card chaos-upgrade-card--${abilityId}">
        <header class="chaos-upgrade-card-header">
          <h3>${tree.displayName}</h3>
          <span class="chaos-upgrade-current-level">Lv ${progress.unlockedLevel}</span>
        </header>
        <div class="chaos-upgrade-stats">
          <span>XP: ${progress.xp}</span>
          <span>Used: ${progress.timesUsed}</span>
          <span>Success: ${progress.successfulDisruptions}</span>
        </div>
        <div class="chaos-upgrade-xp-track">
          <div class="chaos-upgrade-xp-fill" style="width:${xpProgressPercent}%"></div>
        </div>
        ${xpRequirement ? `<div class="chaos-upgrade-xp-meta">${progress.xp}/${xpRequirement} XP to next unlock</div>` : ""}
        <div class="chaos-upgrade-actions">
          <button class="chaos-mini-btn" data-chaos-action="train" data-ability-id="${abilityId}">
            Practice +${TRAINING_XP_REWARD} XP
          </button>
          <button class="chaos-mini-btn ghost" data-chaos-action="cast-local" data-ability-id="${abilityId}">
            Cast Lv ${progress.unlockedLevel}
          </button>
        </div>
        ${nextUnlockHtml}
        <div class="chaos-upgrade-level-list">
          ${levelsHtml}
        </div>
      </article>
    `;
  }

  private renderLevelRow(
    abilityId: CameraAbilityId,
    levelDef: CameraAbilityLevelDefinition,
    unlockedLevel: number
  ): string {
    const isUnlocked = levelDef.level <= unlockedLevel;
    const isNext = levelDef.level === unlockedLevel + 1;
    const validation = isNext
      ? upgradeProgressionService.canUnlockLevel(abilityId, levelDef.level)
      : null;

    const statusText = isUnlocked
      ? "Unlocked"
      : isNext
        ? this.getValidationLabel(validation)
        : "Locked";

    return `
      <div class="chaos-upgrade-level-row ${isUnlocked ? "unlocked" : ""}">
        <div class="chaos-upgrade-level-main">
          <strong>Lv ${levelDef.level} ${levelDef.name}</strong>
          <span>${levelDef.description}</span>
        </div>
        <div class="chaos-upgrade-level-status">${statusText}</div>
      </div>
    `;
  }

  private renderNextUnlockPanel(
    abilityId: CameraAbilityId,
    nextDef: CameraAbilityLevelDefinition,
    validation: UnlockValidationResult
  ): string {
    const requirement = this.formatRequirementText(nextDef);
    const unlockDisabled = validation.allowed ? "" : "disabled";
    const validationLabel = this.getValidationLabel(validation);
    const achievementRequirement = nextDef.unlockRequirement.type === "achievement"
      ? nextDef.unlockRequirement
      : null;
    const canGrantAchievement =
      achievementRequirement !== null &&
      validation.reason === "missing_achievement";

    const grantAchievementButton = canGrantAchievement
      ? `
          <button
            class="chaos-mini-btn ghost"
            data-chaos-action="grant-achievement"
            data-achievement-id="${achievementRequirement.achievementId}"
          >
            Grant ${achievementRequirement.achievementId}
          </button>
        `
      : "";

    return `
      <div class="chaos-upgrade-next">
        <div class="chaos-upgrade-next-info">
          <strong>Next: Lv ${nextDef.level} ${nextDef.name}</strong>
          <span>${requirement}</span>
          <span class="chaos-upgrade-next-status">${validationLabel}</span>
        </div>
        <div class="chaos-upgrade-next-actions">
          <button
            class="chaos-mini-btn ${validation.allowed ? "" : "locked"}"
            data-chaos-action="unlock"
            data-ability-id="${abilityId}"
            data-level="${nextDef.level}"
            ${unlockDisabled}
          >
            Unlock Lv ${nextDef.level}
          </button>
          ${grantAchievementButton}
        </div>
      </div>
    `;
  }

  private formatRequirementText(levelDef: CameraAbilityLevelDefinition): string {
    const req = levelDef.unlockRequirement;
    switch (req.type) {
      case "default":
        return "Default unlock";
      case "xp":
        return `Requirement: ${req.amount} XP`;
      case "currency":
        return `Requirement: ${req.amount} Chaos Tokens`;
      case "achievement":
        return `Requirement: achievement ${req.achievementId}`;
      default:
        return "Requirement: unknown";
    }
  }

  private getValidationLabel(validation: UnlockValidationResult | null): string {
    if (!validation) return "Locked";
    if (validation.allowed) return "Ready to unlock";

    switch (validation.reason) {
      case "insufficient_xp":
        return "Need more XP";
      case "insufficient_tokens":
        return "Need more Chaos Tokens";
      case "missing_achievement":
        return "Missing achievement";
      case "previous_level_locked":
        return "Unlock prior level first";
      case "already_unlocked":
        return "Already unlocked";
      default:
        return "Locked";
    }
  }

  private handleAddTokens(button: HTMLButtonElement): void {
    const amount = Number(button.dataset.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const balance = upgradeProgressionService.awardTokens(amount);
    notificationService.show(`+${amount} Chaos Tokens (Balance: ${balance})`, "success");
  }

  private handleTrainingXp(button: HTMLButtonElement): void {
    const abilityId = button.dataset.abilityId as CameraAbilityId | undefined;
    if (!abilityId) return;

    const total = upgradeProgressionService.earnAbilityXP(abilityId, TRAINING_XP_REWARD);
    notificationService.show(`+${TRAINING_XP_REWARD} XP for ${abilityId} (Total: ${total})`, "info");
  }

  private handleUnlock(button: HTMLButtonElement): void {
    const abilityId = button.dataset.abilityId as CameraAbilityId | undefined;
    const level = Number(button.dataset.level ?? 0);
    if (!abilityId || !Number.isFinite(level)) return;

    const result = upgradeProgressionService.unlockLevel(abilityId, level);
    if (result.allowed) {
      notificationService.show(`${abilityId} unlocked to level ${level}`, "success");
    } else {
      notificationService.show(`Cannot unlock: ${this.getValidationLabel(result)}`, "warning");
    }
  }

  private handleGrantAchievement(button: HTMLButtonElement): void {
    const achievementId = button.dataset.achievementId;
    if (!achievementId) return;

    upgradeProgressionService.grantAchievement(achievementId);
    notificationService.show(`Achievement granted: ${achievementId}`, "success");
  }

  private handleCastLocal(button: HTMLButtonElement): void {
    const abilityId = button.dataset.abilityId as CameraAbilityId | undefined;
    if (!abilityId) return;

    const message = buildCameraAttackMessageFromProgression(abilityId, {
      gameId: "local-game",
      attackerId: "local-player",
      targetId: "local-player",
    });

    upgradeProgressionService.onAbilityUsed(abilityId);
    document.dispatchEvent(
      new CustomEvent("chaos:cameraAttack", {
        detail: message,
      })
    );
    notificationService.show(
      `Cast ${abilityId} Lv ${message.level} (${message.duration}ms)`,
      "info"
    );
  }
}
