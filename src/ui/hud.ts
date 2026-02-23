import { GameState } from "../engine/types.js";
import { getDiceCounts } from "../engine/rules.js";
import { calculateSelectionPoints } from "../engine/rules.js";

export class HUD {
  private rollCountEl: HTMLElement;
  private scoreEl: HTMLElement;
  private poolListEl: HTMLElement;
  private selectedInfoEl: HTMLElement;
  private selectedCountEl: HTMLElement;
  private selectedPointsEl: HTMLElement;

  constructor() {
    this.rollCountEl = document.getElementById("roll-count")!;
    this.scoreEl = document.getElementById("score")!;
    this.poolListEl = document.getElementById("pool-list")!;
    this.selectedInfoEl = document.getElementById("selected-info")!;
    this.selectedCountEl = document.getElementById("selected-count")!;
    this.selectedPointsEl = document.getElementById("selected-points")!;
  }

  update(state: GameState) {
    // Update basic stats
    this.rollCountEl.textContent = state.rollIndex.toString();
    this.scoreEl.textContent = state.score.toString();

    // Update dice pool
    const counts = getDiceCounts(state.dice);
    this.poolListEl.innerHTML = "";

    if (counts.size === 0) {
      this.poolListEl.innerHTML = '<div style="opacity:0.5">All scored</div>';
    } else {
      counts.forEach((count, kind) => {
        const div = document.createElement("div");
        div.className = "die-count";

        const sides = parseInt(kind.substring(1)); // Extract number from "d6", "d12", etc.
        const shape = this.getDieShape(sides);

        div.innerHTML = `<span>${shape} ${kind}</span><span>×${count}</span>`;
        this.poolListEl.appendChild(div);
      });
    }

    // Update selection info
    if (state.selected.size > 0) {
      this.selectedInfoEl.style.display = "block";
      this.selectedCountEl.textContent = state.selected.size.toString();
      const points = calculateSelectionPoints(state.dice, state.selected);
      this.selectedPointsEl.textContent = points.toString();
    } else {
      this.selectedInfoEl.style.display = "none";
    }
  }

  private getDieShape(sides: number): string {
    // Unicode/emoji representations of die shapes
    const shapes: Record<number, string> = {
      4: "▲",   // Tetrahedron (triangle)
      6: "■",   // Cube (square)
      8: "◆",   // Octahedron (diamond)
      10: "⬟",  // Decahedron (kite/crystal)
      12: "⬢",  // Dodecahedron (hexagon)
      20: "⭓",  // Icosahedron (circle with dot)
    };
    return shapes[sides] || "●";
  }
}
