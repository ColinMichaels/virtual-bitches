/**
 * Tutorial Modal
 * Interactive first-time user guide with practice mode
 */

import { audioService } from "../services/audio.js";
import { gameBrand } from "../config/brand.js";
import { t } from "../i18n/index.js";
import { settingsService } from "../services/settings.js";
import { logger } from "../utils/logger.js";
import { confirmAction } from "./confirmModal.js";
import { modalManager } from "./modalManager.js";

const log = logger.create("Tutorial");

type TutorialStep = {
  title: string;
  content: string;
  image: string;
  spotlight?: string; // CSS selector for element to highlight
  waitForAction?: boolean; // Wait for player to perform action
  actionType?: TutorialActionType; // Type of action to wait for
};

type TutorialActionType = 'roll' | 'select' | 'score' | 'openSettings' | 'musicChoice' | 'sfxInfo' | 'themeInfo';

export class TutorialModal {
  private container: HTMLElement;
  private spotlightOverlay: HTMLElement;
  private currentStep = 0;
  private isWaitingForAction = false;
  private completing = false;
  private onComplete: (() => void) | null = null;
  private onRequestOpenAudioSettings: (() => void) | null = null;
  private onRequestOpenGraphicsSettings: (() => void) | null = null;
  private onRequestCloseAuxiliaryModals: (() => void) | null = null;
  private autoOpenSettingsRequested = false;
  private highlightedTargets: HTMLElement[] = [];
  private tutorialMusicPreviewStarted = false;
  private tutorialMusicChoiceCommitted = false;
  private tutorialMusicSnapshot: { musicEnabled: boolean; musicVolume: number } | null = null;

  private steps: TutorialStep[] = [];

  constructor() {
    // Create spotlight overlay
    this.spotlightOverlay = document.createElement("div");
    this.spotlightOverlay.id = "tutorial-spotlight";
    this.spotlightOverlay.className = "tutorial-spotlight";
    this.spotlightOverlay.style.display = "none";
    document.body.appendChild(this.spotlightOverlay);

    // Create main tutorial container
    this.container = document.createElement("div");
    this.container.id = "tutorial-modal";
    this.container.className = "modal tutorial-modal";
    this.container.innerHTML = `
      <div class="modal-backdrop tutorial-backdrop"></div>
      <div class="modal-content tutorial-content">
        <div class="tutorial-step">
          <div class="tutorial-icon">🎲</div>
          <h2 class="tutorial-title">${t("tutorial.modal.title")}</h2>
          <div class="tutorial-body"></div>
          <div class="tutorial-nav">
            <button id="tutorial-skip" class="btn btn-secondary secondary">${t("tutorial.button.skip")}</button>
            <div class="tutorial-dots"></div>
            <button id="tutorial-next" class="btn btn-primary primary">${t("tutorial.button.next")}</button>
          </div>
        </div>
      </div>
    `;

    this.steps = this.buildSteps();

    document.body.appendChild(this.container);
    modalManager.register({
      id: "tutorial-modal",
      close: () => this.hide(),
      canStackWith: ["settings-modal"],
      allowStackOnMobile: true,
    });
    this.setupEventListeners();
    this.renderStep();
  }

  private setupEventListeners(): void {
    const skipBtn = document.getElementById("tutorial-skip")!;
    const nextBtn = document.getElementById("tutorial-next")!;

    skipBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      void this.complete();
    });

    nextBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      if (this.currentStep < this.steps.length - 1) {
        this.currentStep++;
        this.renderStep();
      } else {
        void this.complete();
      }
    });

    // Close on backdrop click
    this.container.querySelector(".tutorial-backdrop")!.addEventListener("click", () => {
      void this.complete();
    });
  }

  private renderStep(): void {
    const step = this.steps[this.currentStep];
    const icon = this.container.querySelector(".tutorial-icon")!;
    const title = this.container.querySelector(".tutorial-title")!;
    const body = this.container.querySelector(".tutorial-body")!;
    const dots = this.container.querySelector(".tutorial-dots")!;
    const nextBtn = document.getElementById("tutorial-next")!;
    const settingsFocusStep = this.isSettingsFocusStep(step);
    if (!settingsFocusStep) {
      this.onRequestCloseAuxiliaryModals?.();
    }

    icon.textContent = step.image;
    title.textContent = step.title;
    body.innerHTML = settingsFocusStep
      ? this.getSettingsFocusMessage(step.actionType)
      : step.content;
    this.container.classList.toggle("tutorial-modal--settings-focus", settingsFocusStep);
    this.clearTargetHighlights();

    // Update dots
    dots.innerHTML = this.steps.map((_, i) =>
      `<span class="tutorial-dot ${i === this.currentStep ? 'active' : ''}"></span>`
    ).join('');

    // Add click handlers to dots
    dots.querySelectorAll('.tutorial-dot').forEach((dot, index) => {
      dot.addEventListener('click', () => {
        // Allow going back to any previous step, or forward to non-action steps only
        const targetStep = this.steps[index];
        if (index < this.currentStep || !targetStep.waitForAction) {
          audioService.playSfx("click");
          this.currentStep = index;
          this.renderStep();
        }
      });
    });

    // Handle spotlight and action waiting
    if (step.spotlight) {
      this.applyTargetHighlights(step.spotlight);
      if (!settingsFocusStep) {
        this.showSpotlight(step.spotlight);
        this.positionModalAwayFrom(step.spotlight);
      } else {
        this.hideSpotlight();
        this.resetModalPosition();
      }
    } else {
      this.hideSpotlight();
      this.resetModalPosition();
    }

    if (step.actionType === "openSettings" || step.actionType === "musicChoice") {
      void this.startTutorialMusicPreview();
    }
    if (settingsFocusStep && step.actionType !== "openSettings") {
      this.requestSettingsTabForStep(step.actionType);
    }

    if (step.waitForAction) {
      // Hide next button, wait for action
      nextBtn.style.display = "none";
      this.isWaitingForAction = true;

      if (!settingsFocusStep) {
        // Add waiting indicator to body
        const waitingText = document.createElement('div');
        waitingText.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255, 215, 0, 0.15); border-radius: 8px; color: #FFD700; font-size: 14px; text-align: center;';
        waitingText.innerHTML = `⏳ <strong>${this.getWaitingActionText(step.actionType)}</strong>`;
        body.appendChild(waitingText);
      }

      if (step.actionType === "musicChoice") {
        this.renderMusicChoiceControls(body);
      }

      if (step.actionType === "openSettings") {
        this.autoOpenSettingsAndAdvance();
      }
    } else {
      // Show next button
      nextBtn.style.display = "inline-block";
      this.isWaitingForAction = false;
      nextBtn.textContent = this.currentStep === this.steps.length - 1
        ? t("tutorial.button.finish")
        : t("tutorial.button.next");
    }
  }

  private showSpotlight(selector: string): void {
    const targetEl = document.querySelector(selector);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();

    // Create cutout effect using box-shadow
    this.spotlightOverlay.style.display = "block";
    this.spotlightOverlay.style.boxShadow = `
      0 0 0 9999px rgba(0, 0, 0, 0.75),
      inset 0 0 20px rgba(255, 255, 255, 0.3)
    `;
    this.spotlightOverlay.style.left = `${rect.left}px`;
    this.spotlightOverlay.style.top = `${rect.top}px`;
    this.spotlightOverlay.style.width = `${rect.width}px`;
    this.spotlightOverlay.style.height = `${rect.height}px`;
    this.spotlightOverlay.style.borderRadius = window.getComputedStyle(targetEl).borderRadius;
  }

  private hideSpotlight(): void {
    this.spotlightOverlay.style.display = "none";
  }

  private positionModalAwayFrom(selector: string): void {
    const targetEl = document.querySelector(selector);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const modalContent = this.container.querySelector('.tutorial-content') as HTMLElement;
    if (!modalContent) return;

    const viewportHeight = window.innerHeight;
    const safeTopPadding = Math.max(10, this.getSafeAreaInset("top") + 10);
    const safeBottomPadding = Math.max(10, this.getSafeAreaInset("bottom") + 10);
    const modalHeight = Math.max(
      200,
      Math.min(modalContent.getBoundingClientRect().height || 320, viewportHeight - safeTopPadding - safeBottomPadding)
    );
    const maxTopPadding = Math.max(
      safeTopPadding,
      viewportHeight - safeBottomPadding - modalHeight - 8
    );
    const maxBottomPadding = Math.max(
      safeBottomPadding,
      viewportHeight - safeTopPadding - modalHeight - 8
    );

    const setVerticalPadding = (topPadding: number, bottomPadding: number): void => {
      this.container.style.alignItems = "flex-start";
      this.container.style.paddingTop = `${this.clamp(topPadding, safeTopPadding, maxTopPadding)}px`;
      this.container.style.paddingBottom = `${this.clamp(
        bottomPadding,
        safeBottomPadding,
        maxBottomPadding
      )}px`;
    };

    // Position the card away from highlighted controls while staying in the safe viewport area.
    if (selector === '#dice-row') {
      // Dice row is at top - position modal below it
      setVerticalPadding(rect.bottom + 10, safeBottomPadding);
    } else if (selector === '#action-btn') {
      // Action button is at bottom - position modal at top to avoid covering it
      setVerticalPadding(safeTopPadding, viewportHeight - rect.top + 84);
    } else {
      // Default: position based on target location
      const targetMiddle = rect.top + rect.height / 2;

      if (targetMiddle < viewportHeight / 2) {
        // Target is in upper half - position modal below
        setVerticalPadding(rect.bottom + 10, safeBottomPadding);
      } else {
        // Target is in lower half - position modal at top
        setVerticalPadding(safeTopPadding, viewportHeight - rect.top + 84);
      }
    }
  }

  private resetModalPosition(): void {
    // Reset to default centered position
    const safeTopPadding = Math.max(12, this.getSafeAreaInset("top") + 12);
    const safeBottomPadding = Math.max(12, this.getSafeAreaInset("bottom") + 12);
    this.container.style.alignItems = 'flex-start';
    this.container.style.paddingTop = `${safeTopPadding}px`;
    this.container.style.paddingBottom = `${safeBottomPadding}px`;
  }

  private getSafeAreaInset(edge: "top" | "right" | "bottom" | "left"): number {
    if (typeof window === "undefined") {
      return 0;
    }
    const rootStyles = window.getComputedStyle(document.documentElement);
    const value = rootStyles.getPropertyValue(`--safe-area-${edge}`).trim();
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private isSettingsFocusStep(step: TutorialStep): boolean {
    return (
      step.actionType === "openSettings" ||
      step.actionType === "musicChoice" ||
      step.actionType === "sfxInfo" ||
      step.actionType === "themeInfo"
    );
  }

  /**
   * Called by main game when player performs an action during tutorial
   */
  onPlayerAction(actionType: TutorialActionType): void {
    log.debug(`Action detected: ${actionType}, waiting: ${this.isWaitingForAction}, current step: ${this.currentStep}`);

    if (!this.isWaitingForAction) return;

    const step = this.steps[this.currentStep];
    log.debug(`Step action type: ${step.actionType}, matches: ${step.actionType === actionType}`);

    if (step.waitForAction && step.actionType === actionType) {
      // Player performed the correct action, advance to next step
      log.debug("Advancing to next step");
      audioService.playSfx("click");
      this.isWaitingForAction = false;
      this.currentStep++;
      this.renderStep();
    }
  }

  private getWaitingActionText(actionType?: TutorialActionType): string {
    switch (actionType) {
      case "roll":
        return t("tutorial.waiting.roll");
      case "select":
        return t("tutorial.waiting.select");
      case "score":
        return t("tutorial.waiting.score");
      case "openSettings":
        return t("tutorial.waiting.openSettings");
      case "musicChoice":
        return t("tutorial.waiting.musicChoice");
      default:
        return t("tutorial.waiting.default");
    }
  }

  private getSettingsFocusMessage(actionType?: TutorialActionType): string {
    if (actionType === "openSettings") {
      return t("tutorial.settingsFocus.openSettings");
    }
    if (actionType === "musicChoice") {
      return t("tutorial.settingsFocus.musicChoice");
    }
    if (actionType === "sfxInfo") {
      return t("tutorial.settingsFocus.sfxInfo");
    }
    if (actionType === "themeInfo") {
      return t("tutorial.settingsFocus.themeInfo");
    }
    return t("tutorial.settingsFocus.default");
  }

  private requestSettingsTabForStep(actionType?: TutorialActionType): void {
    if (!actionType) {
      return;
    }

    if (actionType === "themeInfo") {
      this.onRequestOpenGraphicsSettings?.();
      return;
    }

    if (actionType === "openSettings" || actionType === "musicChoice" || actionType === "sfxInfo") {
      this.onRequestOpenAudioSettings?.();
    }
  }

  private autoOpenSettingsAndAdvance(): void {
    if (this.autoOpenSettingsRequested || !this.onRequestOpenAudioSettings) {
      return;
    }

    this.autoOpenSettingsRequested = true;
    window.setTimeout(() => {
      this.onRequestOpenAudioSettings?.();
      this.onPlayerAction("openSettings");
    }, 140);
  }

  private renderMusicChoiceControls(body: Element): void {
    const controls = document.createElement("div");
    controls.className = "tutorial-music-choice";
    controls.innerHTML = `
      <button type="button" class="btn btn-danger danger" data-music-choice="mute">${t("tutorial.musicChoice.mute")}</button>
      <button type="button" class="btn btn-primary primary" data-music-choice="keep">${t("tutorial.musicChoice.keep")}</button>
    `;

    controls.querySelector<HTMLButtonElement>('[data-music-choice="mute"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.applyMusicChoice("mute");
    });

    controls.querySelector<HTMLButtonElement>('[data-music-choice="keep"]')?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.applyMusicChoice("keep");
    });

    body.appendChild(controls);
  }

  private applyTargetHighlights(selector: string): void {
    const targets = document.querySelectorAll<HTMLElement>(selector);
    targets.forEach((target) => {
      target.classList.add("tutorial-target-highlight");
      this.highlightedTargets.push(target);
    });
  }

  private clearTargetHighlights(): void {
    this.highlightedTargets.forEach((target) => {
      target.classList.remove("tutorial-target-highlight");
    });
    this.highlightedTargets = [];
  }

  private applyMusicChoice(choice: "mute" | "keep"): void {
    const snapshot = this.tutorialMusicSnapshot ?? settingsService.getSettings().audio;
    if (choice === "mute") {
      settingsService.updateAudio({ musicEnabled: false });
      audioService.stopMusic();
    } else {
      const keepVolume = snapshot.musicVolume > 0 ? snapshot.musicVolume : 0.35;
      settingsService.updateAudio({ musicEnabled: true, musicVolume: keepVolume });
      if (!audioService.isInitialized()) {
        void audioService.initialize().then(() => audioService.playMusic());
      } else {
        void audioService.playMusic();
      }
    }

    this.tutorialMusicChoiceCommitted = true;
    this.onPlayerAction("musicChoice");
  }

  private async startTutorialMusicPreview(): Promise<void> {
    if (this.tutorialMusicPreviewStarted) {
      return;
    }

    this.tutorialMusicPreviewStarted = true;

    try {
      const settings = settingsService.getSettings();
      this.tutorialMusicSnapshot = {
        musicEnabled: settings.audio.musicEnabled,
        musicVolume: settings.audio.musicVolume,
      };

      const previewVolume = settings.audio.musicVolume > 0 ? settings.audio.musicVolume : 0.35;
      settingsService.updateAudio({
        musicEnabled: true,
        musicVolume: previewVolume,
      });

      if (!audioService.isInitialized()) {
        await audioService.initialize();
      }
      await audioService.playMusic();
    } catch (error) {
      log.warn("Unable to start tutorial music preview", error);
    }
  }

  private restoreMusicPreviewIfUncommitted(): void {
    if (!this.tutorialMusicSnapshot || this.tutorialMusicChoiceCommitted) {
      return;
    }

    settingsService.updateAudio({
      musicEnabled: this.tutorialMusicSnapshot.musicEnabled,
      musicVolume: this.tutorialMusicSnapshot.musicVolume,
    });

    if (!this.tutorialMusicSnapshot.musicEnabled) {
      audioService.stopMusic();
    } else if (audioService.isInitialized()) {
      void audioService.playMusic();
    }
  }

  private async complete(): Promise<void> {
    if (this.completing) {
      return;
    }
    this.completing = true;
    try {
      this.onRequestCloseAuxiliaryModals?.();
      this.restoreMusicPreviewIfUncommitted();

      // Mark tutorial as shown
      settingsService.updateGame({ showTutorial: false });

      this.hide();
      this.hideSpotlight();

      // Offer Easy Mode after closing tutorial so the confirmation modal is unobstructed.
      await this.offerEasyMode();

      if (this.onComplete) {
        this.onComplete();
      }
    } finally {
      this.completing = false;
    }
  }

  private async offerEasyMode(): Promise<void> {
    const wantsEasyMode = await confirmAction({
      title: t("tutorial.easyModePrompt.title"),
      message: t("tutorial.easyModePrompt.message"),
      confirmLabel: t("tutorial.easyModePrompt.confirm"),
      cancelLabel: t("tutorial.easyModePrompt.cancel"),
      tone: "primary",
    });

    if (wantsEasyMode) {
      settingsService.updateGame({ difficulty: 'easy' });
    }
  }

  setOnComplete(callback: () => void): void {
    this.onComplete = callback;
  }

  setOnRequestOpenAudioSettings(callback: (() => void) | null): void {
    this.onRequestOpenAudioSettings = callback;
  }

  setOnRequestOpenGraphicsSettings(callback: (() => void) | null): void {
    this.onRequestOpenGraphicsSettings = callback;
  }

  setOnRequestCloseAuxiliaryModals(callback: (() => void) | null): void {
    this.onRequestCloseAuxiliaryModals = callback;
  }

  show(): void {
    this.onRequestCloseAuxiliaryModals?.();
    modalManager.requestOpen("tutorial-modal");
    this.container.style.display = "flex";
    this.container.classList.remove("tutorial-modal--settings-focus");
    const skipBtn = document.getElementById("tutorial-skip");
    if (skipBtn) {
      skipBtn.textContent = t("tutorial.button.skip");
    }
    this.steps = this.buildSteps();
    this.currentStep = 0;
    this.autoOpenSettingsRequested = false;
    this.tutorialMusicPreviewStarted = false;
    this.tutorialMusicChoiceCommitted = false;
    this.tutorialMusicSnapshot = null;
    this.renderStep();
  }

  hide(): void {
    if (this.container.style.display === "none") {
      return;
    }
    this.container.style.display = "none";
    modalManager.notifyClosed("tutorial-modal");
    this.hideSpotlight();
    this.clearTargetHighlights();
  }

  shouldShow(): boolean {
    const settings = settingsService.getSettings();
    return settings.game.showTutorial;
  }

  isActive(): boolean {
    return this.container.style.display !== "none";
  }

  getPreferredSettingsTab(): "audio" | "graphics" | null {
    if (!this.isActive()) {
      return null;
    }

    const actionType = this.steps[this.currentStep]?.actionType;
    if (actionType === "openSettings" || actionType === "musicChoice" || actionType === "sfxInfo") {
      return "audio";
    }
    if (actionType === "themeInfo") {
      return "graphics";
    }
    return null;
  }

  private buildSteps(): TutorialStep[] {
    return [
      {
        title: t("tutorial.step.welcome.title", { productName: gameBrand.productName }),
        content: t("tutorial.step.welcome.content"),
        image: "🎲",
      },
      {
        title: t("tutorial.step.scoring.title"),
        content: t("tutorial.step.scoring.content"),
        image: "📊",
      },
      {
        title: t("tutorial.step.roll.title"),
        content: t("tutorial.step.roll.content"),
        image: "🎲",
        spotlight: "#action-btn",
        waitForAction: true,
        actionType: "roll",
      },
      {
        title: t("tutorial.step.select.title"),
        content: t("tutorial.step.select.content"),
        image: "👆",
        spotlight: "#dice-row",
        waitForAction: true,
        actionType: "select",
      },
      {
        title: t("tutorial.step.score.title"),
        content: t("tutorial.step.score.content"),
        image: "✅",
        spotlight: "#action-btn",
        waitForAction: true,
        actionType: "score",
      },
      {
        title: t("tutorial.step.audioSettings.title"),
        content: t("tutorial.step.audioSettings.content"),
        image: "⚙️",
        spotlight: "#settings-gear-btn, #mobile-settings-btn",
        waitForAction: true,
        actionType: "openSettings",
      },
      {
        title: t("tutorial.step.musicOnly.title"),
        content: t("tutorial.step.musicOnly.content"),
        image: "🎵",
        spotlight: "#audio-music-toggle-row, #music-enabled, #audio-music-volume-row, #music-volume",
        waitForAction: true,
        actionType: "musicChoice",
      },
      {
        title: t("tutorial.step.sfxSeparate.title"),
        content: t("tutorial.step.sfxSeparate.content"),
        image: "🔔",
        spotlight: "#audio-sfx-toggle-row, #sfx-enabled, #audio-sfx-volume-row, #sfx-volume",
        actionType: "sfxInfo",
      },
      {
        title: t("tutorial.step.theme.title"),
        content: t("tutorial.step.theme.content"),
        image: "🎨",
        spotlight: "#theme-switcher-container, #theme-dropdown",
        actionType: "themeInfo",
      },
      {
        title: t("tutorial.step.keepGoing.title"),
        content: t("tutorial.step.keepGoing.content"),
        image: "🎯",
      },
      {
        title: t("tutorial.step.easyMode.title"),
        content: t("tutorial.step.easyMode.content"),
        image: "✨",
      },
    ];
  }
}
