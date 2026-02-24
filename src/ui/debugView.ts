/**
 * Debug View for testing dice rotations and texture mappings
 * Shows one die type at a time with all face values
 */

import { DiceRenderer } from "../render/dice.js";
import { GameScene } from "../render/scene.js";
import { DieKind } from "../engine/types.js";
import { themeManager } from "../services/themeManager.js";

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

        <div class="debug-texture-controls">
          <h3>Texture Mapping Controls</h3>

          <div class="debug-control-group">
            <label>Theme</label>
            <select id="debug-theme-select" class="debug-theme-select">
              <!-- Will be populated dynamically -->
            </select>
          </div>

          <div class="debug-control-group">
            <label>Scale U: <span id="scale-u-value">1.9</span></label>
            <input type="range" id="scale-u-slider" min="0.5" max="3.0" step="0.01" value="1.9">
          </div>

          <div class="debug-control-group">
            <label>Scale V: <span id="scale-v-value">1.9</span></label>
            <input type="range" id="scale-v-slider" min="0.5" max="3.0" step="0.01" value="1.9">
          </div>

          <div class="debug-control-group">
            <label>Offset U: <span id="offset-u-value">0.05</span></label>
            <input type="range" id="offset-u-slider" min="-0.5" max="0.5" step="0.01" value="0.05">
          </div>

          <div class="debug-control-group">
            <label>Offset V: <span id="offset-v-value">0.05</span></label>
            <input type="range" id="offset-v-slider" min="-0.5" max="0.5" step="0.01" value="0.05">
          </div>

          <button id="debug-save-btn" class="debug-save-btn">Save to Console</button>
        </div>

        <div class="debug-instructions">
          <p><strong>Instructions:</strong></p>
          <ul>
            <li>Look at each die in the 3D scene</li>
            <li>Verify the top face matches the label</li>
            <li>Use ← → buttons to switch dice types</li>
            <li>Adjust texture sliders to fix mapping</li>
            <li>Click "Save to Console" to log values</li>
          </ul>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    // Setup event listeners
    document.getElementById("debug-close-btn")?.addEventListener("click", () => this.hide());
    document.getElementById("debug-prev-btn")?.addEventListener("click", () => this.previousDie());
    document.getElementById("debug-next-btn")?.addEventListener("click", () => this.nextDie());
    document.getElementById("debug-save-btn")?.addEventListener("click", () => this.saveTextureSettings());

    // Theme selector
    document.getElementById("debug-theme-select")?.addEventListener("change", (e) => {
      const themeName = (e.target as HTMLSelectElement).value;
      themeManager.setTheme(themeName);
      // Load theme's texture settings into sliders
      this.loadThemeTextureSettings();
      // Re-render dice after theme change
      setTimeout(() => this.renderCurrentDie(), 500);
    });

    // Populate theme dropdown
    this.populateThemeDropdown();

    // Texture control sliders
    document.getElementById("scale-u-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById("scale-u-value")!.textContent = value.toFixed(2);
      this.updateTextureMapping();
    });

    document.getElementById("scale-v-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById("scale-v-value")!.textContent = value.toFixed(2);
      this.updateTextureMapping();
    });

    document.getElementById("offset-u-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById("offset-u-value")!.textContent = value.toFixed(2);
      this.updateTextureMapping();
    });

    document.getElementById("offset-v-slider")?.addEventListener("input", (e) => {
      const value = parseFloat((e.target as HTMLInputElement).value);
      document.getElementById("offset-v-value")!.textContent = value.toFixed(2);
      this.updateTextureMapping();
    });

    // ESC key to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isVisible) {
        this.hide();
      }
    });
  }

  private updateTextureMapping(): void {
    const scaleU = parseFloat((document.getElementById("scale-u-slider") as HTMLInputElement).value);
    const scaleV = parseFloat((document.getElementById("scale-v-slider") as HTMLInputElement).value);
    const offsetU = parseFloat((document.getElementById("offset-u-slider") as HTMLInputElement).value);
    const offsetV = parseFloat((document.getElementById("offset-v-slider") as HTMLInputElement).value);

    // Update the dice renderer's texture mapping
    this.diceRenderer.updateTextureMapping(scaleU, scaleV, offsetU, offsetV);
  }

  private saveTextureSettings(): void {
    const scaleU = parseFloat((document.getElementById("scale-u-slider") as HTMLInputElement).value);
    const scaleV = parseFloat((document.getElementById("scale-v-slider") as HTMLInputElement).value);
    const offsetU = parseFloat((document.getElementById("offset-u-slider") as HTMLInputElement).value);
    const offsetV = parseFloat((document.getElementById("offset-v-slider") as HTMLInputElement).value);
    const currentTheme = themeManager.getCurrentTheme();

    console.log(`=== Texture Mapping Settings for ${currentTheme} ===`);
    console.log(`"textureScale": {`);
    console.log(`  "u": ${scaleU},`);
    console.log(`  "v": ${scaleV}`);
    console.log(`},`);
    console.log(`"textureOffset": {`);
    console.log(`  "u": ${offsetU},`);
    console.log(`  "v": ${offsetV}`);
    console.log(`}`);
    console.log("================================");
  }

  private populateThemeDropdown(): void {
    const select = document.getElementById("debug-theme-select") as HTMLSelectElement;
    if (!select) return;

    const themes = themeManager.getAvailableThemes();
    const currentTheme = themeManager.getCurrentTheme();

    select.innerHTML = themes.map(({ name, config }) =>
      `<option value="${name}" ${name === currentTheme ? 'selected' : ''}>${config.name}</option>`
    ).join('');
  }

  private loadThemeTextureSettings(): void {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) return;

    // Get texture scale and offset from theme config (or use defaults)
    const textureScale = (themeConfig.material as any).textureScale || { u: 1.0, v: 1.0 };
    const textureOffset = (themeConfig.material as any).textureOffset || { u: 0.0, v: 0.0 };

    // Update slider values
    const scaleUSlider = document.getElementById("scale-u-slider") as HTMLInputElement;
    const scaleVSlider = document.getElementById("scale-v-slider") as HTMLInputElement;
    const offsetUSlider = document.getElementById("offset-u-slider") as HTMLInputElement;
    const offsetVSlider = document.getElementById("offset-v-slider") as HTMLInputElement;

    if (scaleUSlider) {
      scaleUSlider.value = textureScale.u.toString();
      document.getElementById("scale-u-value")!.textContent = textureScale.u.toFixed(2);
    }
    if (scaleVSlider) {
      scaleVSlider.value = textureScale.v.toString();
      document.getElementById("scale-v-value")!.textContent = textureScale.v.toFixed(2);
    }
    if (offsetUSlider) {
      offsetUSlider.value = textureOffset.u.toString();
      document.getElementById("offset-u-value")!.textContent = textureOffset.u.toFixed(2);
    }
    if (offsetVSlider) {
      offsetVSlider.value = textureOffset.v.toString();
      document.getElementById("offset-v-value")!.textContent = textureOffset.v.toFixed(2);
    }

    // Apply the settings to the renderer
    this.updateTextureMapping();

    console.log(`📐 Loaded texture settings for ${themeConfig.name}:`, textureScale, textureOffset);
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = "block";
    this.onToggle(true);

    // Set debug camera view
    this.scene.setCameraView("debug");

    // Load current theme's texture settings
    this.loadThemeTextureSettings();

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
