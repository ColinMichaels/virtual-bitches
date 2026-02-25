import { GameState, GameDifficulty } from "../engine/types.js";
import { getDiceCounts } from "../engine/rules.js";
import { calculateSelectionPoints } from "../engine/rules.js";
import { getDifficultyName } from "../engine/modes.js";

export class HUD {
  private rollCountEl: HTMLElement;
  private scoreEl: HTMLElement;
  private poolListEl: HTMLElement;
  private modeDisplayEl: HTMLElement;
  private modeDropdownEl: HTMLElement;
  private isDropdownOpen: boolean = false;
  private onModeChange: ((difficulty: GameDifficulty) => void) | null = null;

  constructor() {
    this.rollCountEl = document.getElementById("roll-count")!;
    this.scoreEl = document.getElementById("score")!;
    this.poolListEl = document.getElementById("pool-list")!;
    this.modeDisplayEl = document.getElementById("mode-display")!;
    this.modeDropdownEl = document.getElementById("mode-dropdown")!;

    // Setup mode switcher
    this.setupModeSwitcher();
  }

  private setupModeSwitcher() {
    // Toggle dropdown on click
    this.modeDisplayEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Handle mode selection
    this.modeDropdownEl.querySelectorAll('.mode-option').forEach((option) => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const difficulty = (option as HTMLElement).dataset.mode as GameDifficulty;
        if (this.onModeChange) {
          this.onModeChange(difficulty);
        }
        this.closeDropdown();
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.closeDropdown();
    });
  }

  private toggleDropdown() {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.modeDropdownEl.style.display = this.isDropdownOpen ? 'block' : 'none';
  }

  private closeDropdown() {
    this.isDropdownOpen = false;
    this.modeDropdownEl.style.display = 'none';
  }

  setOnModeChange(callback: (difficulty: GameDifficulty) => void) {
    this.onModeChange = callback;
  }

  update(state: GameState) {
    // Update basic stats
    this.rollCountEl.textContent = state.rollIndex.toString();
    this.scoreEl.textContent = state.score.toString();

    // Update mode display
    const difficultyName = getDifficultyName(state.mode.difficulty);
    // Update button text (keep the first child text node, preserve SVG)
    const textNode = this.modeDisplayEl.childNodes[0];
    if (textNode) {
      textNode.textContent = difficultyName + ' ';
    }

    // Add color classes for different modes
    this.modeDisplayEl.className = "stat-value-compact mode-switcher";
    if (state.mode.difficulty === "easy") {
      this.modeDisplayEl.classList.add("mode-easy");
    } else if (state.mode.difficulty === "hard") {
      this.modeDisplayEl.classList.add("mode-hard");
    }

    // Update dropdown active state
    this.modeDropdownEl.querySelectorAll('.mode-option').forEach((option) => {
      const optionMode = (option as HTMLElement).dataset.mode;
      if (optionMode === state.mode.difficulty) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });

    // Update dice pool (inline display in stats bar)
    const counts = getDiceCounts(state.dice);
    this.poolListEl.innerHTML = "";

    if (counts.size === 0) {
      this.poolListEl.innerHTML = '<div style="opacity:0.5;font-size:11px;">All scored</div>';
    } else {
      counts.forEach((count, kind) => {
        const div = document.createElement("div");
        div.className = "die-count";

        const sides = parseInt(kind.substring(1)); // Extract number from "d6", "d12", etc.
        const shape = this.getDieShape(sides);

        div.innerHTML = `<span>${shape} ${kind} ×${count}</span>`;
        this.poolListEl.appendChild(div);
      });
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
