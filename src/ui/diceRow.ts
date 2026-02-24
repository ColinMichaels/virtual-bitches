import { GameState, DieState, DieKind } from "../engine/types.js";
import { scoreDie } from "../engine/rules.js";
import { DiceRenderer } from "../render/dice.js";
import { themeManager } from "../services/themeManager.js";

export class DiceRow {
  private container: HTMLElement;
  private onDieClick: (dieId: string) => void;
  private diceRenderer: DiceRenderer;
  private hintMode: boolean = false;

  constructor(onDieClick: (dieId: string) => void, diceRenderer: DiceRenderer) {
    this.container = document.getElementById("dice-row")!;
    this.onDieClick = onDieClick;
    this.diceRenderer = diceRenderer;

    // Load hint mode from settings
    this.hintMode = localStorage.getItem('hintMode') === 'true';
  }

  update(state: GameState) {
    // Only show dice after they've been rolled and are in play
    const activeDice = state.dice.filter(
      (d) => d.inPlay && !d.scored && d.value > 0
    );

    if (activeDice.length === 0) {
      this.container.innerHTML = "";
      this.container.style.display = "none";
      return;
    }

    // Calculate hint data if enabled
    let hintData: Map<string, 'best' | 'good' | 'normal'> | null = null;
    if (this.hintMode) {
      hintData = this.calculateHints(activeDice);
    }

    // Sort dice by type for visual grouping
    const diceOrder: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const sortedDice = activeDice.sort((a, b) => {
      return diceOrder.indexOf(a.def.kind) - diceOrder.indexOf(b.def.kind);
    });

    this.container.style.display = "flex";
    this.container.innerHTML = "";

    let lastKind: DieKind | null = null;

    sortedDice.forEach((die) => {
      // Add divider before new die type (except first)
      if (lastKind && lastKind !== die.def.kind) {
        const divider = this.createDivider();
        this.container.appendChild(divider);
      }

      const hintLevel = hintData?.get(die.id) || 'normal';
      const el = this.createDieElement(die, state.selected.has(die.id), hintLevel);
      this.container.appendChild(el);
      lastKind = die.def.kind;
    });
  }

  private createDivider(): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'die-type-divider';
    return divider;
  }

  private calculateHints(dice: DieState[]): Map<string, 'best' | 'good' | 'normal'> {
    const hints = new Map<string, 'best' | 'good' | 'normal'>();

    // Calculate all point values
    const pointValues = dice.map(d => ({
      id: d.id,
      points: scoreDie(d)
    }));

    // Find max points
    const maxPoints = Math.max(...pointValues.map(pv => pv.points));
    const threshold = maxPoints * 0.8;

    // Assign hint levels
    pointValues.forEach(({ id, points }) => {
      if (points === maxPoints) {
        hints.set(id, 'best');
      } else if (points >= threshold) {
        hints.set(id, 'good');
      } else {
        hints.set(id, 'normal');
      }
    });

    return hints;
  }

  private createDieElement(die: DieState, selected: boolean, hintLevel: 'best' | 'good' | 'normal' = 'normal'): HTMLElement {
    // Create wrapper to hold both die and badge
    const wrapper = document.createElement("div");
    wrapper.className = "die-wrapper";
    wrapper.dataset.dieId = die.id;

    // Create the die element
    const el = document.createElement("div");
    el.className = `die-2d ${die.def.kind} ${selected ? "selected" : ""}`;

    // Get the die's color from the 3D renderer
    const dieColor = this.diceRenderer.getDieColor(die.id);

    // Get theme texture for background
    const themePath = themeManager.getCurrentThemePath();
    const themeConfig = themeManager.getCurrentThemeConfig();

    if (themeConfig) {
      let textureUrl = '';

      if (themeConfig.material.type === 'standard') {
        // Use the main diffuse texture for standard materials
        textureUrl = `${themePath}/${themeConfig.material.diffuseTexture}`;
      } else {
        // Use the light texture for color materials
        const diffuseConfig = themeConfig.material.diffuseTexture as { light: string; dark: string };
        textureUrl = `${themePath}/${diffuseConfig.light}`;
      }

      // Set background image with stretched texture
      el.style.backgroundImage = `url(${textureUrl})`;
      el.style.backgroundSize = '6000%';
      el.style.backgroundPosition = 'center';

      // Add color tint overlay using background-blend-mode
      if (dieColor) {
        el.style.backgroundColor = dieColor;
        el.style.backgroundBlendMode = 'multiply';
      }
    }

    // Rolled value (centered)
    const topValue = document.createElement("div");
    topValue.className = "top-value";
    topValue.textContent = `${die.value}`;

    // Points preview with hint coloring
    const points = document.createElement("div");
    points.className = `points hint-${hintLevel}`;
    const score = scoreDie(die);
    points.textContent = `+${score}`;

    el.appendChild(topValue);
    el.appendChild(points);

    // Create badge outside of clipped die
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = die.def.sides.toString();

    wrapper.appendChild(el);
    wrapper.appendChild(kind);

    wrapper.addEventListener("click", () => {
      this.onDieClick(die.id);
    });

    return wrapper;
  }

  // Public method to toggle hints (called from settings)
  setHintMode(enabled: boolean) {
    this.hintMode = enabled;
    localStorage.setItem('hintMode', String(enabled));
  }
}
