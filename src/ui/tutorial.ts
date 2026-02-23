/**
 * Tutorial Modal
 * First-time user guide overlay
 */

import { audioService } from "../services/audio.js";
import { settingsService } from "../services/settings.js";

export class TutorialModal {
  private container: HTMLElement;
  private currentStep = 0;
  private steps = [
    {
      title: "Welcome to BISCUITS!",
      content: "A push-your-luck dice game where <strong>lower scores win</strong>. Let's learn how to play in 3 quick steps!",
      image: "🎲"
    },
    {
      title: "Roll & Select",
      content: "Roll all dice, then <strong>select at least one die</strong> to score. Scoring = (max value - rolled value).<br><br>Example: A d6 showing 6 = <strong>0 points</strong> (perfect!)<br>A d6 showing 1 = <strong>5 points</strong> (bad!)",
      image: "🎯"
    },
    {
      title: "Controls",
      content: `
        <strong>Mouse:</strong> Click dice to select them<br>
        <strong>Keyboard:</strong> ← → to navigate, Enter to select<br>
        <strong>Space:</strong> Roll / Score selected dice<br>
        <strong>ESC:</strong> Settings & pause<br>
        <strong>D:</strong> Deselect all
      `,
      image: "⌨️"
    },
    {
      title: "Ready to Play!",
      content: "Remember: Select carefully! Once you score dice, they're gone. Try to finish with the <strong>lowest total score</strong> possible.<br><br>Good luck! 🍀",
      image: "🏁"
    }
  ];

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "tutorial-modal";
    this.container.className = "modal";
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

    // Update button text on last step
    nextBtn.textContent = this.currentStep === this.steps.length - 1 ? "Start Playing!" : "Next";
  }

  private complete(): void {
    // Mark tutorial as shown
    settingsService.updateGame({ showTutorial: false });
    this.hide();
  }

  show(): void {
    this.container.style.display = "flex";
  }

  hide(): void {
    this.container.style.display = "none";
  }

  shouldShow(): boolean {
    const settings = settingsService.getSettings();
    return settings.game.showTutorial;
  }
}
