/**
 * Rules Modal
 * Displays game rules and instructions from markdown
 */

import { marked } from "marked";
import { audioService } from "../services/audio.js";
import { logger } from "../utils/logger.js";

const log = logger.create('RulesModal');

export class RulesModal {
  private container: HTMLElement;
  private rulesContent: string = "";
  private onReplayTutorial: (() => void) | null = null;

  constructor() {
    // Create modal
    this.container = document.createElement("div");
    this.container.className = "modal";
    this.container.id = "rules-modal";
    this.container.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content rules-modal-content">
        <div class="modal-header">
          <h2>How To Play</h2>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="rules-actions">
          <button class="btn-rules-replay" type="button">Replay Tutorial</button>
        </div>
        <div class="modal-body rules-body">
          <div class="loading">Loading rules...</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    this.setupEventListeners();
    this.loadRules();
  }

  private async loadRules(): Promise<void> {
    try {
      const basePath = import.meta.env.BASE_URL || './';
      const response = await fetch(`${basePath}rules.md`);
      const markdown = await response.text();
      this.rulesContent = await marked.parse(markdown);
      this.renderRules();
    } catch (error) {
      log.error("Failed to load rules:", error);
      this.rulesContent = "<p>Failed to load rules. Please try again.</p>";
      this.renderRules();
    }
  }

  private renderRules(): void {
    const bodyEl = this.container.querySelector(".rules-body");
    if (bodyEl) {
      bodyEl.innerHTML = this.rulesContent;
    }
  }

  private setupEventListeners(): void {
    // Close button
    const closeBtn = this.container.querySelector(".modal-close");
    closeBtn?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
    });

    // Close on backdrop click
    const backdrop = this.container.querySelector(".modal-backdrop");
    backdrop?.addEventListener("click", () => {
      this.hide();
    });

    const replayBtn = this.container.querySelector(".btn-rules-replay");
    replayBtn?.addEventListener("click", () => {
      if (!this.onReplayTutorial) {
        return;
      }
      audioService.playSfx("click");
      this.hide();
      this.onReplayTutorial();
    });

    this.updateReplayTutorialButton();
  }

  show(): void {
    this.container.style.display = "flex";
  }

  hide(): void {
    this.container.style.display = "none";
  }

  isVisible(): boolean {
    return this.container.style.display === "flex";
  }

  setOnReplayTutorial(callback: (() => void) | null): void {
    this.onReplayTutorial = callback;
    this.updateReplayTutorialButton();
  }

  private updateReplayTutorialButton(): void {
    const replayBtn = this.container.querySelector<HTMLButtonElement>(".btn-rules-replay");
    if (!replayBtn) {
      return;
    }
    replayBtn.style.display = this.onReplayTutorial ? "inline-flex" : "none";
  }
}
