/**
 * Dice-box integration for BISCUITS
 * Uses @3d-dice/dice-box npm package for professional dice rendering
 */

import DiceBox from "@3d-dice/dice-box";
import { DieState, DieKind } from "../engine/types.js";

// Map our die colors to hex strings for dice-box
const DIE_COLORS = [
  "#2a2a2a", // Dark gray
  "#3d5a4a", // Muted green
  "#4a5c7a", // Muted blue
  "#b8a062", // Muted gold
  "#8f6f7e", // Muted pink
  "#7a3d3d", // Muted red
  "#8a4a4a", // Muted red #2
  "#c4b399", // Muted cream
  "#c8c8c8", // Light gray
  "#2a2a2a", // Dark gray #2
  "#6b5139", // Muted brown
  "#2a2a2a", // Dark gray #3
  "#5a6470", // Muted blue-gray
  "#7a3d3d", // Muted red
  "#6b5688", // Muted purple
];

export class DiceBoxRenderer {
  private diceBox: DiceBox | null = null;
  private colorIndex = 0;
  private dieColors = new Map<string, string>();
  private diceMap = new Map<string, { id: string; type: string; color: string }>();
  private initialized = false;

  async initialize(container: string): Promise<void> {
    console.log("🎲 Starting dice-box initialization...", container);
    try {
      // Create dice-box instance using v1.1.0 API
      this.diceBox = new DiceBox({
        id: container,
        assetPath: "/assets/dice-box/",
        theme: "default",
        themeColor: "#ffffff", // Will override per die
        scale: 6, // Size of dice
        gravity: 1,
        mass: 1,
        friction: 0.8,
        restitution: 0.5,
        linearDamping: 0.5,
        angularDamping: 0.4,
        spinForce: 6,
        throwForce: 5,
        startingHeight: 8,
        settleTimeout: 5000,
        offscreen: false, // Use main thread (simpler for our case)
        delay: 10,
      });

      console.log("🎲 Dice-box instance created, calling init()...");
      // Initialize dice-box
      await this.diceBox.init();

      this.initialized = true;
      console.log("✅ Dice-box initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize dice-box:", error);
      throw error;
    }
  }

  /**
   * Create/update dice in the scene
   */
  createDice(dice: DieState[]): void {
    if (!this.initialized || !this.diceBox) {
      console.warn("⚠️ Dice-box not initialized");
      return;
    }

    // Clear existing dice
    this.diceBox.clear();
    this.diceMap.clear();

    // Add each die with custom color
    dice.forEach((die) => {
      if (!die.inPlay || die.scored) return;

      const color = this.getColorForDie(die.id);
      this.diceMap.set(die.id, {
        id: die.id,
        type: die.def.kind,
        color: color,
      });
    });
  }

  /**
   * Roll dice with animation
   */
  async rollDice(dice: DieState[]): Promise<void> {
    if (!this.initialized || !this.diceBox) {
      console.warn("⚠️ Dice-box not initialized");
      return;
    }

    // Clear previous roll
    this.diceBox.clear();

    // Build roll notation for active dice
    const activeDice = dice.filter((d) => d.inPlay && !d.scored);
    if (activeDice.length === 0) return;

    console.log(`🎲 Rolling ${activeDice.length} dice`);

    // Build dice notation array
    const diceNotation = activeDice.map((die) => {
      const color = this.getColorForDie(die.id);
      return {
        qty: 1,
        sides: parseInt(die.def.kind.substring(1)), // "d6" -> 6
        themeColor: color,
      };
    });

    // Roll all dice at once
    try {
      await this.diceBox.roll(diceNotation);
    } catch (error) {
      console.error("Failed to roll dice:", error);
    }
  }

  /**
   * Get roll results from dice-box
   */
  getRollResults(): number[] {
    if (!this.initialized || !this.diceBox) {
      return [];
    }

    const results = this.diceBox.getRollResults();
    if (!results || !results.rolls || results.rolls.length === 0) {
      return [];
    }

    // Extract values from dice-box result format
    return results.rolls.flatMap((roll: any) =>
      roll.dice.map((die: any) => die.value)
    );
  }

  /**
   * Clear all dice from scene
   */
  clear(): void {
    if (this.diceBox) {
      this.diceBox.clear();
    }
    this.diceMap.clear();
  }

  /**
   * Hide dice-box canvas
   */
  hide(): void {
    if (this.diceBox) {
      this.diceBox.hide();
    }
  }

  /**
   * Show dice-box canvas
   */
  show(): void {
    if (this.diceBox) {
      this.diceBox.show();
    }
  }

  /**
   * Get color for a die (consistent across rolls)
   */
  private getColorForDie(dieId: string): string {
    if (!this.dieColors.has(dieId)) {
      const color = DIE_COLORS[this.colorIndex % DIE_COLORS.length];
      this.dieColors.set(dieId, color);
      this.colorIndex++;
    }
    return this.dieColors.get(dieId)!;
  }

  /**
   * Get die color (for HUD)
   */
  getDieColor(dieId: string): string | undefined {
    return this.dieColors.get(dieId);
  }

  /**
   * Animate dice roll - compatible with existing game interface
   */
  animateRoll(dice: DieState[], callback: () => void): void {
    if (!this.initialized) {
      callback();
      return;
    }

    // Roll the dice
    this.rollDice(dice).then(() => {
      // Wait for dice to settle
      setTimeout(() => {
        callback();
      }, 3000); // Match settleTimeout from config
    });
  }

  /**
   * Animate scoring dice - compatible with existing game interface
   */
  animateScore(dice: DieState[], selectedIds: Set<string>, callback: () => void): void {
    if (!this.initialized) {
      callback();
      return;
    }

    // Remove scored dice from scene
    selectedIds.forEach((id) => {
      this.dieColors.delete(id);
      this.diceMap.delete(id);
    });

    // Callback immediately since we don't have a scoring animation yet
    callback();
  }

  /**
   * Set die selection state - compatible with existing game interface
   */
  setSelected(dieId: string, selected: boolean): void {
    // Dice-box doesn't have built-in selection highlighting
    // Could be implemented with custom overlays if needed
    console.log(`Die ${dieId} selection: ${selected}`);
  }

  /**
   * Clear all dice - compatible with existing game interface
   */
  clearDice(): void {
    this.clear();
  }

  /**
   * Dispose of dice-box
   */
  dispose(): void {
    // Dice-box doesn't have explicit dispose, but we can clear
    if (this.diceBox) {
      this.diceBox.clear();
      this.diceBox.hide();
    }
    this.diceMap.clear();
    this.dieColors.clear();
  }
}
