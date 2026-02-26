import { logger } from "../utils/logger.js";
import type { ControlInversionMode } from "../chaos/types.js";

const log = logger.create("ControlInversion");

const MIN_DURATION_MS = 100;
const MAX_DURATION_MS = 60000;
const DEFAULT_RANDOM_CHANCE = 0.3;

const INVERTED_KEY_CODES: Record<string, string> = {
  ArrowLeft: "ArrowRight",
  ArrowRight: "ArrowLeft",
  ArrowUp: "ArrowDown",
  ArrowDown: "ArrowUp",
  KeyA: "KeyD",
  KeyD: "KeyA",
  KeyW: "KeyS",
  KeyS: "KeyW",
};

interface ActiveInversionState {
  id: string;
  mode: Exclude<ControlInversionMode, "none">;
  randomChance: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface ControlInversionOptions {
  isEnabled?: () => boolean;
}

export interface ActivateControlInversionOptions {
  randomChance?: number;
}

export interface IControlInversionService {
  activate(
    mode: Exclude<ControlInversionMode, "none">,
    durationMs: number,
    options?: ActivateControlInversionOptions
  ): string | null;
  remapKeyCode(code: string): string;
  clearAll(): void;
  isActive(): boolean;
  getMode(): ControlInversionMode;
}

export class ControlInversionService implements IControlInversionService {
  private readonly isEnabled: () => boolean;
  private readonly activeStates = new Map<string, ActiveInversionState>();

  constructor(options: ControlInversionOptions = {}) {
    this.isEnabled = options.isEnabled ?? (() => true);
  }

  activate(
    mode: Exclude<ControlInversionMode, "none">,
    durationMs: number,
    options: ActivateControlInversionOptions = {}
  ): string | null {
    if (!this.isEnabled()) {
      return null;
    }

    const safeDuration = clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS);
    const safeRandomChance = clamp(options.randomChance ?? DEFAULT_RANDOM_CHANCE, 0, 1);
    const id = this.generateId();

    const timeoutHandle = setTimeout(() => {
      this.clear(id);
    }, safeDuration);

    this.activeStates.set(id, {
      id,
      mode,
      randomChance: safeRandomChance,
      timeoutHandle,
    });
    log.debug(`Activated control inversion: ${mode} (${id})`);
    return id;
  }

  remapKeyCode(code: string): string {
    const mode = this.getMode();
    if (mode === "none") return code;

    const shouldInvert =
      mode === "full" ||
      Math.random() < this.getHighestRandomChance();
    if (!shouldInvert) return code;

    return INVERTED_KEY_CODES[code] ?? code;
  }

  clearAll(): void {
    Array.from(this.activeStates.keys()).forEach((id) => this.clear(id));
  }

  isActive(): boolean {
    return this.activeStates.size > 0;
  }

  getMode(): ControlInversionMode {
    if (this.activeStates.size === 0) return "none";

    for (const state of this.activeStates.values()) {
      if (state.mode === "full") return "full";
    }
    return "random";
  }

  private clear(id: string): void {
    const state = this.activeStates.get(id);
    if (!state) return;

    clearTimeout(state.timeoutHandle);
    this.activeStates.delete(id);
    log.debug(`Cleared control inversion (${id})`);
  }

  private getHighestRandomChance(): number {
    let maxChance = 0;
    for (const state of this.activeStates.values()) {
      if (state.mode === "random") {
        maxChance = Math.max(maxChance, state.randomChance);
      }
    }
    return maxChance;
  }

  private generateId(): string {
    return `control-inversion-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
