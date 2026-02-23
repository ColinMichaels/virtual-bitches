import { GameState, DieState } from "../engine/types.js";
import { scoreDie } from "../engine/rules.js";
import { DiceRenderer } from "../render/dice.js";

export class DiceRow {
  private container: HTMLElement;
  private onDieClick: (dieId: string) => void;
  private diceRenderer: DiceRenderer;

  constructor(onDieClick: (dieId: string) => void, diceRenderer: DiceRenderer) {
    this.container = document.getElementById("dice-row")!;
    this.onDieClick = onDieClick;
    this.diceRenderer = diceRenderer;
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

    this.container.style.display = "flex";
    this.container.innerHTML = "";

    activeDice.forEach((die) => {
      const el = this.createDieElement(die, state.selected.has(die.id));
      this.container.appendChild(el);
    });
  }

  private createDieElement(die: DieState, selected: boolean): HTMLElement {
    // Create wrapper to hold both die and badge
    const wrapper = document.createElement("div");
    wrapper.className = "die-wrapper";
    wrapper.dataset.dieId = die.id;

    // Create the die element
    const el = document.createElement("div");
    el.className = `die-2d ${die.def.kind} ${selected ? "selected" : ""}`;

    // Get the color from the 3D renderer to match
    const dieColor = this.diceRenderer.getDieColor(die.id);
    if (dieColor) {
      el.style.background = dieColor;
    }

    // Rolled value (centered)
    const topValue = document.createElement("div");
    topValue.className = "top-value";
    topValue.textContent = `${die.value}`;

    // Points preview (centered below)
    const points = document.createElement("div");
    points.className = "points";
    const score = scoreDie(die);
    points.textContent = `+${score}`;

    el.appendChild(topValue);
    el.appendChild(points);

    // Create badge outside of clipped die
    const kind = document.createElement("div");
    kind.className = "kind";
    kind.textContent = die.def.sides.toString(); // Just the number (6, 8, 10, etc.)

    wrapper.appendChild(el);
    wrapper.appendChild(kind);

    wrapper.addEventListener("click", () => {
      this.onDieClick(die.id);
    });

    return wrapper;
  }
}
