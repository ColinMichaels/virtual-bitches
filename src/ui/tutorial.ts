/**
 * Tutorial Modal
 * Interactive first-time user guide with practice mode
 */

import { audioService } from "../services/audio.js";
import { settingsService } from "../services/settings.js";
import { logger } from "../utils/logger.js";
import { confirmAction } from "./confirmModal.js";

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
  private previousStepSettingsFocus = false;
  private highlightedTargets: HTMLElement[] = [];
  private tutorialMusicPreviewStarted = false;
  private tutorialMusicChoiceCommitted = false;
  private tutorialMusicSnapshot: { musicEnabled: boolean; musicVolume: number } | null = null;

  private steps: TutorialStep[] = [
    {
      title: "Welcome to BISCUITS!",
      content: "A push-your-luck dice game where <strong>lower scores win</strong>. Let's learn by playing!",
      image: "🎲"
    },
    {
      title: "Understanding Scoring",
      content: "Each die scores: <strong>(max value - rolled value)</strong><br><br>🎯 d6 showing 6 = <strong>0 points</strong> (perfect!)<br>😬 d6 showing 1 = <strong>5 points</strong> (bad!)<br><br>Lower is better!",
      image: "📊"
    },
    {
      title: "Let's Roll!",
      content: "Click the <strong>Roll Dice</strong> button to roll all your dice. You get 3 rolls per game.",
      image: "🎲",
      spotlight: "#action-btn",
      waitForAction: true,
      actionType: 'roll'
    },
    {
      title: "Select Dice",
      content: "Great! Now <strong>click on dice</strong> to select them. Green highlights = 0 points (best). Try selecting dice with green highlights!",
      image: "👆",
      spotlight: "#dice-row",
      waitForAction: true,
      actionType: 'select'
    },
    {
      title: "Score Selected",
      content: "Perfect! Now click <strong>Score</strong> to lock in those dice. They'll be removed from play.",
      image: "✅",
      spotlight: "#action-btn",
      waitForAction: true,
      actionType: 'score'
    },
    {
      title: "Audio And Settings",
      content: "Open <strong>Settings</strong> now (<strong>Esc</strong> or the gear button). We'll open Audio controls and preview music.",
      image: "⚙️",
      spotlight: "#settings-gear-btn, #mobile-settings-btn",
      waitForAction: true,
      actionType: "openSettings"
    },
    {
      title: "Music Only",
      content: "This step controls <strong>music only</strong>. Sound effects are configured separately in the next step.",
      image: "🎵",
      spotlight: "#audio-music-toggle-row, #music-enabled, #audio-music-volume-row, #music-volume",
      waitForAction: true,
      actionType: "musicChoice"
    },
    {
      title: "Sound Effects Separate",
      content: "Use these controls if you want quieter clicks/rolls. Music mute does not mute sound effects.",
      image: "🔔",
      spotlight: "#audio-sfx-toggle-row, #sfx-enabled, #audio-sfx-volume-row, #sfx-volume",
      actionType: "sfxInfo"
    },
    {
      title: "Dice Theme",
      content: "You can change your dice look in <strong>Settings → Graphics</strong>. Use the highlighted Dice Theme dropdown.",
      image: "🎨",
      spotlight: "#theme-switcher-container, #theme-dropdown",
      actionType: "themeInfo"
    },
    {
      title: "Keep Going!",
      content: "You've got the basics! Continue playing this practice game. Remember:<br>• Lower scores win<br>• You have 3 rolls total<br>• Once scored, dice are gone",
      image: "🎯"
    },
    {
      title: "Try Easy Mode?",
      content: "Want help while you learn? <strong>Easy Mode</strong> shows hints and lets you undo mistakes.<br><br>You can change modes anytime in Settings.",
      image: "✨"
    }
  ];

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
          <h2 class="tutorial-title">Welcome!</h2>
          <div class="tutorial-body"></div>
          <div class="tutorial-nav">
            <button id="tutorial-skip" class="btn btn-secondary secondary">Skip Tutorial</button>
            <div class="tutorial-dots"></div>
            <button id="tutorial-next" class="btn btn-primary primary">Next</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
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
    if (!settingsFocusStep && this.previousStepSettingsFocus) {
      this.onRequestCloseAuxiliaryModals?.();
    }
    this.previousStepSettingsFocus = settingsFocusStep;

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
      nextBtn.textContent = this.currentStep === this.steps.length - 1 ? "Finish Tutorial" : "Next";
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
    const isMobile = window.innerWidth <= 768;

    // For dice-row, always position below on mobile, otherwise position based on location
    if (selector === '#dice-row') {
      // Dice row is at top - position modal below it
      this.container.style.alignItems = 'flex-start';
      this.container.style.paddingTop = `${rect.bottom + 10}px`;
      this.container.style.paddingBottom = '10px';
    } else if (selector === '#action-btn') {
      // Action button is at bottom - position modal at top to avoid covering it
      this.container.style.alignItems = 'flex-start';
      this.container.style.paddingTop = '10px';
      this.container.style.paddingBottom = `${viewportHeight - rect.top + 100}px`;
    } else {
      // Default: position based on target location
      const targetMiddle = rect.top + rect.height / 2;

      if (targetMiddle < viewportHeight / 2) {
        // Target is in upper half - position modal below
        this.container.style.alignItems = 'flex-start';
        this.container.style.paddingTop = `${rect.bottom + 10}px`;
        this.container.style.paddingBottom = '10px';
      } else {
        // Target is in lower half - position modal at top
        this.container.style.alignItems = 'flex-start';
        this.container.style.paddingTop = '10px';
        this.container.style.paddingBottom = `${viewportHeight - rect.top + 100}px`;
      }
    }
  }

  private resetModalPosition(): void {
    // Reset to default centered position
    this.container.style.alignItems = 'flex-start';
    this.container.style.paddingTop = '40px';
    this.container.style.paddingBottom = '40px';
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
        return "Waiting for you to roll...";
      case "select":
        return "Waiting for you to select dice...";
      case "score":
        return "Waiting for you to score selected dice...";
      case "openSettings":
        return "Waiting for you to open Settings...";
      case "musicChoice":
        return "Choose mute or keep music to continue...";
      default:
        return "Waiting for your action...";
    }
  }

  private getSettingsFocusMessage(actionType?: TutorialActionType): string {
    if (actionType === "openSettings") {
      return "Opening <strong>Settings → Audio</strong> so you can preview and configure music.";
    }
    if (actionType === "musicChoice") {
      return "Music setup only: use the highlighted <strong>Music</strong> controls, then choose below.";
    }
    if (actionType === "sfxInfo") {
      return "Sound effects are separate: use the highlighted <strong>Sound Effects</strong> controls if needed.";
    }
    if (actionType === "themeInfo") {
      return "Theme setup: switch to <strong>Graphics</strong> and use the highlighted <strong>Dice Theme</strong> dropdown.";
    }
    return "Adjust audio settings.";
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
      <button type="button" class="btn btn-danger danger" data-music-choice="mute">Mute Music</button>
      <button type="button" class="btn btn-primary primary" data-music-choice="keep">Keep Music On</button>
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
      title: "Tutorial Complete",
      message:
        "Would you like to enable Easy Mode?\n\n" +
        "Easy Mode includes:\n" +
        "- Color-coded hints for best moves\n" +
        "- Undo button to fix mistakes\n\n" +
        "You can change this anytime in Settings.",
      confirmLabel: "Enable Easy Mode",
      cancelLabel: "Not Now",
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
    this.container.style.display = "flex";
    this.container.classList.remove("tutorial-modal--settings-focus");
    this.currentStep = 0;
    this.autoOpenSettingsRequested = false;
    this.previousStepSettingsFocus = false;
    this.tutorialMusicPreviewStarted = false;
    this.tutorialMusicChoiceCommitted = false;
    this.tutorialMusicSnapshot = null;
    this.renderStep();
  }

  hide(): void {
    this.container.style.display = "none";
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
}
