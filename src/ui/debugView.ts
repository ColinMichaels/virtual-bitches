/**
 * Debug View for testing dice rotations and texture mappings
 * Shows one die type at a time with all face values
 */

import { DiceRenderer } from "../render/dice.js";
import { GameScene } from "../render/scene.js";
import { DieKind } from "../engine/types.js";

const DICE_CONFIG: Array<{ kind: DieKind; faces: number; label: string }> = [
  { kind: "d4", faces: 4, label: "D4 (4 faces)" },
  { kind: "d6", faces: 6, label: "D6 (6 faces)" },
  { kind: "d8", faces: 8, label: "D8 (8 faces)" },
  { kind: "d10", faces: 10, label: "D10 (10 faces)" },
  { kind: "d12", faces: 12, label: "D12 (12 faces)" },
  { kind: "d20", faces: 20, label: "D20 (20 faces)" },
];

export class DebugView {
  private container: HTMLElement;
  private isVisible = false;
  private diceRenderer: DiceRenderer;
  private scene: GameScene;
  private onToggle: (isDebugMode: boolean) => void;
  private currentDieIndex = 2; // Start with d8 (index 2)

  constructor(diceRenderer: DiceRenderer, scene: GameScene, onToggle: (isDebugMode: boolean) => void) {
    this.diceRenderer = diceRenderer;
    this.scene = scene;
    this.onToggle = onToggle;
    this.createUI();
  }

  private createUI(): void {
    // Create debug panel (side panel, not full overlay)
    this.container = document.createElement("div");
    this.container.id = "debug-view";
    this.container.className = "debug-view";
    this.container.style.display = "none";

    this.container.innerHTML = `
      <div class="debug-panel">
        <div class="debug-header">
          <h2>Debug View</h2>
          <button id="debug-close-btn" class="debug-close-btn">✕</button>
        </div>

        <div class="debug-die-selector">
          <button id="debug-prev-btn" class="debug-nav-btn">← Prev</button>
          <div class="debug-die-info">
            <h3 id="debug-die-label">D8 (8 faces)</h3>
            <p>Check each value shows correct face</p>
          </div>
          <button id="debug-next-btn" class="debug-nav-btn">Next →</button>
        </div>

        <div class="debug-values" id="debug-values">
          <!-- Values will be populated here -->
        </div>

        <div class="debug-instructions">
          <p><strong>Instructions:</strong></p>
          <ul>
            <li>Look at each die in the 3D scene</li>
            <li>Verify the top face matches the label</li>
            <li>Use ← → buttons to switch dice types</li>
            <li>Camera controls still work</li>
          </ul>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    // Setup event listeners
    document.getElementById("debug-close-btn")?.addEventListener("click", () => this.hide());
    document.getElementById("debug-prev-btn")?.addEventListener("click", () => this.previousDie());
    document.getElementById("debug-next-btn")?.addEventListener("click", () => this.nextDie());

    // ESC key to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isVisible) {
        this.hide();
      }
    });
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = "block";
    this.onToggle(true);

    // Set debug camera view
    this.scene.setCameraView("debug");

    // Render current die type
    this.renderCurrentDie();
  }

  hide(): void {
    this.isVisible = false;
    this.container.style.display = "none";
    this.onToggle(false);

    // Restore default camera view
    this.scene.setCameraView("default");

    this.diceRenderer.clearDebugDice();
  }

  private previousDie(): void {
    this.currentDieIndex = (this.currentDieIndex - 1 + DICE_CONFIG.length) % DICE_CONFIG.length;
    this.renderCurrentDie();
  }

  private nextDie(): void {
    this.currentDieIndex = (this.currentDieIndex + 1) % DICE_CONFIG.length;
    this.renderCurrentDie();
  }

  private renderCurrentDie(): void {
    // Clear previous dice
    this.diceRenderer.clearDebugDice();

    const config = DICE_CONFIG[this.currentDieIndex];

    // Update label
    const labelEl = document.getElementById("debug-die-label");
    if (labelEl) {
      labelEl.textContent = config.label;
    }

    // Create value labels
    const valuesContainer = document.getElementById("debug-values");
    if (valuesContainer) {
      valuesContainer.innerHTML = "";

      for (let value = 1; value <= config.faces; value++) {
        const displayValue = config.kind === "d10" ? (value === 10 ? 0 : value) : value;

        const valueLabel = document.createElement("div");
        valueLabel.className = "debug-value-label";
        valueLabel.textContent = String(displayValue);
        valuesContainer.appendChild(valueLabel);
      }
    }

    // Create 3D dice in scene
    this.diceRenderer.createDebugDice(config.kind, config.faces);
  }
}
