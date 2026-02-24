/**
 * Tutorial Modal
 * Interactive first-time user guide with practice mode
 */

import { audioService } from "../services/audio.js";
import { settingsService } from "../services/settings.js";
import { GameDifficulty } from "../engine/types.js";

type TutorialStep = {
  title: string;
  content: string;
  image: string;
  spotlight?: string; // CSS selector for element to highlight
  waitForAction?: boolean; // Wait for player to perform action
  actionType?: 'roll' | 'select' | 'score'; // Type of action to wait for
};

export class TutorialModal {
  private container: HTMLElement;
  private spotlightOverlay: HTMLElement;
  private currentStep = 0;
  private isWaitingForAction = false;
  private onComplete: (() => void) | null = null;

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
            <button id="tutorial-skip" class="secondary">Skip Tutorial</button>
            <div class="tutorial-dots"></div>
            <button id="tutorial-next" class="primary">Next</button>
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
      this.complete();
    });

    nextBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      if (this.currentStep < this.steps.length - 1) {
        this.currentStep++;
        this.renderStep();
      } else {
        this.complete();
      }
    });

    // Close on backdrop click
    this.container.querySelector(".tutorial-backdrop")!.addEventListener("click", () => {
      this.complete();
    });
  }

  private renderStep(): void {
    const step = this.steps[this.currentStep];
    const icon = this.container.querySelector(".tutorial-icon")!;
    const title = this.container.querySelector(".tutorial-title")!;
    const body = this.container.querySelector(".tutorial-body")!;
    const dots = this.container.querySelector(".tutorial-dots")!;
    const nextBtn = document.getElementById("tutorial-next")!;

    icon.textContent = step.image;
    title.textContent = step.title;
    body.innerHTML = step.content;

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
      this.showSpotlight(step.spotlight);
    } else {
      this.hideSpotlight();
    }

    if (step.waitForAction) {
      // Hide next button, wait for action
      nextBtn.style.display = "none";
      this.isWaitingForAction = true;

      // Add waiting indicator to body
      const waitingText = document.createElement('div');
      waitingText.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255, 215, 0, 0.15); border-radius: 8px; color: #FFD700; font-size: 14px; text-align: center;';
      waitingText.innerHTML = `⏳ <strong>Waiting for you to ${step.actionType}...</strong>`;
      body.appendChild(waitingText);
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

  /**
   * Called by main game when player performs an action during tutorial
   */
  onPlayerAction(actionType: 'roll' | 'select' | 'score'): void {
    console.log(`[Tutorial] Action detected: ${actionType}, waiting: ${this.isWaitingForAction}, current step: ${this.currentStep}`);

    if (!this.isWaitingForAction) return;

    const step = this.steps[this.currentStep];
    console.log(`[Tutorial] Step action type: ${step.actionType}, matches: ${step.actionType === actionType}`);

    if (step.waitForAction && step.actionType === actionType) {
      // Player performed the correct action, advance to next step
      console.log(`[Tutorial] Advancing to next step`);
      audioService.playSfx("click");
      this.isWaitingForAction = false;
      this.currentStep++;
      this.renderStep();
    }
  }

  private complete(): void {
    // Mark tutorial as shown
    settingsService.updateGame({ showTutorial: false });

    // Offer Easy Mode
    this.offerEasyMode();

    this.hide();
    this.hideSpotlight();

    if (this.onComplete) {
      this.onComplete();
    }
  }

  private offerEasyMode(): void {
    const wantsEasyMode = confirm(
      "🎓 Tutorial Complete!\n\n" +
      "Would you like to enable Easy Mode?\n\n" +
      "✨ Easy Mode includes:\n" +
      "• Color-coded hints for best moves\n" +
      "• Undo button to fix mistakes\n\n" +
      "You can change this anytime in Settings."
    );

    if (wantsEasyMode) {
      settingsService.updateGame({ difficulty: 'easy' });
    }
  }

  setOnComplete(callback: () => void): void {
    this.onComplete = callback;
  }

  show(): void {
    this.container.style.display = "flex";
    this.currentStep = 0;
    this.renderStep();
  }

  hide(): void {
    this.container.style.display = "none";
    this.hideSpotlight();
  }

  shouldShow(): boolean {
    const settings = settingsService.getSettings();
    return settings.game.showTutorial;
  }

  isActive(): boolean {
    return this.container.style.display !== "none";
  }
}
