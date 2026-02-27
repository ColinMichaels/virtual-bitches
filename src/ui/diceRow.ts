import { GameState, DieState, DieKind } from "../engine/types.js";
import { scoreDie } from "../engine/rules.js";
import { DiceRenderer } from "../render/dice.js";
import { themeManager } from "../services/themeManager.js";

export class DiceRow {
  private container: HTMLElement;
  private onDieClick: (dieId: string) => void;
  private diceRenderer: DiceRenderer;
  private hintMode: boolean = false;
  private highlightTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
      this.clearHighlightTimers();
      this.container.innerHTML = "";
      this.container.style.display = "none";
      return;
    }

    // Calculate hint data if enabled
    let hintData: Map<string, 'perfect' | 'best' | 'good' | 'normal'> | null = null;
    if (this.hintMode) {
      hintData = this.calculateHints(activeDice);
    }

    // Sort dice by type for visual grouping
    const diceOrder: DieKind[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
    const sortedDice = activeDice.sort((a, b) => {
      return diceOrder.indexOf(a.def.kind) - diceOrder.indexOf(b.def.kind);
    });

    this.container.style.display = "flex";
    this.clearHighlightTimers();
    this.container.innerHTML = "";
    const dieElements: HTMLElement[] = [];

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
      dieElements.push(el);
      lastKind = die.def.kind;
    });

    this.applyMobilePerimeterSlots(dieElements);
  }

  private createDivider(): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'die-type-divider';
    return divider;
  }

  private calculateHints(dice: DieState[]): Map<string, 'perfect' | 'best' | 'good' | 'normal'> {
    const hints = new Map<string, 'perfect' | 'best' | 'good' | 'normal'>();

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
      if (points === 0) {
        hints.set(id, 'perfect'); // Zero points = perfect roll (green)
      } else if (points === maxPoints) {
        hints.set(id, 'best'); // Highest points = best choice (gold)
      } else if (points >= threshold) {
        hints.set(id, 'good'); // Close to max = good choice (blue)
      } else {
        hints.set(id, 'normal'); // Below threshold = normal (white)
      }
    });

    return hints;
  }

  private createDieElement(die: DieState, selected: boolean, hintLevel: 'perfect' | 'best' | 'good' | 'normal' = 'normal'): HTMLElement {
    // Create wrapper to hold both die and badge
    const wrapper = document.createElement("div");
    wrapper.className = "die-wrapper";
    wrapper.dataset.dieId = die.id;

    // Create the die element
    const el = document.createElement("div");
    el.className = `die-2d ${die.def.kind} ${selected ? "selected" : ""}`;
    const shape = document.createElement("div");
    shape.className = "die-shape";

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
      shape.style.backgroundImage = `url(${textureUrl})`;
      shape.style.backgroundSize = '6000%';
      shape.style.backgroundPosition = 'center';

      // Add color tint overlay using background-blend-mode
      if (dieColor) {
        shape.style.backgroundColor = dieColor;
        shape.style.backgroundBlendMode = 'multiply';
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

    el.appendChild(shape);
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

  highlightDice(dieIds: string[], durationMs: number = 820): void {
    if (!Array.isArray(dieIds) || dieIds.length === 0) {
      return;
    }

    const wrappers = Array.from(this.container.querySelectorAll<HTMLElement>(".die-wrapper"));
    dieIds.forEach((dieId) => {
      const wrapper = wrappers.find((candidate) => candidate.dataset.dieId === dieId);
      if (!wrapper) {
        return;
      }

      wrapper.classList.remove("tutorial-undo-highlight");
      void wrapper.offsetWidth;
      wrapper.classList.add("tutorial-undo-highlight");

      const existingTimer = this.highlightTimers.get(dieId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = window.setTimeout(() => {
        wrapper.classList.remove("tutorial-undo-highlight");
        this.highlightTimers.delete(dieId);
      }, durationMs);
      this.highlightTimers.set(dieId, timer);
    });
  }

  private clearHighlightTimers(): void {
    this.highlightTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.highlightTimers.clear();
  }

  private applyMobilePerimeterSlots(dieElements: HTMLElement[]): void {
    if (!dieElements.length) {
      return;
    }

    const total = dieElements.length;
    const topCount = Math.min(
      total,
      total <= 6 ? total : Math.max(4, Math.min(8, Math.ceil(total * 0.55)))
    );
    const overflow = total - topCount;
    const topDice = dieElements.slice(0, topCount);
    const sideDice = dieElements.slice(topCount);
    const leftDice: HTMLElement[] = [];
    const rightDice: HTMLElement[] = [];

    sideDice.forEach((dieEl, index) => {
      if (index % 2 === 0) {
        leftDice.push(dieEl);
      } else {
        rightDice.push(dieEl);
      }
    });

    topDice.forEach((dieEl, index) => {
      this.setPerimeterSlot(dieEl, "top", index, topDice.length);
    });
    leftDice.forEach((dieEl, index) => {
      this.setPerimeterSlot(dieEl, "left", index, leftDice.length);
    });
    rightDice.forEach((dieEl, index) => {
      this.setPerimeterSlot(dieEl, "right", index, rightDice.length);
    });

    this.container.dataset.perimeterOverflow = String(Math.max(0, overflow));
  }

  private setPerimeterSlot(
    dieElement: HTMLElement,
    zone: "top" | "left" | "right",
    index: number,
    count: number
  ): void {
    let x = 50;
    let y = 12;

    if (zone === "top") {
      x = this.distribute(index, count, 16, 84);
      y = 10;
    } else if (zone === "left") {
      x = 8;
      y = this.distribute(index, count, 28, 80);
    } else {
      x = 92;
      y = this.distribute(index, count, 28, 80);
    }

    dieElement.dataset.perimeterZone = zone;
    dieElement.style.setProperty("--mobile-perimeter-x", `${x}%`);
    dieElement.style.setProperty("--mobile-perimeter-y", `${y}%`);
  }

  private distribute(index: number, count: number, min: number, max: number): number {
    if (count <= 1) {
      return (min + max) / 2;
    }
    const step = (max - min) / (count - 1);
    return min + step * index;
  }
}
