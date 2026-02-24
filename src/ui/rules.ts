/**
 * Rules Modal
 * Displays game rules and instructions from markdown
 */

import { marked } from "marked";
import { audioService } from "../services/audio.js";

export class RulesModal {
  private container: HTMLElement;
  private rulesContent: string = "";

  constructor() {
    // Create modal
    this.container = document.createElement("div");
    this.container.className = "modal";
    this.container.id = "rules-modal";
    this.container.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content rules-modal-content">
        <div class="modal-header">
          <h2>Game Rules</h2>
          <button class="modal-close" aria-label="Close">&times;</button>
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
      const response = await fetch("/src/content/rules.md");
      const markdown = await response.text();
      this.rulesContent = await marked.parse(markdown);
      this.renderRules();
    } catch (error) {
      console.error("Failed to load rules:", error);
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
}
