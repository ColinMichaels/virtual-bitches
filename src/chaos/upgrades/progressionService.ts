import { logger } from "../../utils/logger.js";
import { CAMERA_ABILITY_UPGRADE_TREES } from "./definitions.js";
import type {
  AbilityProgressState,
  AbilityUnlockPreview,
  CameraAbilityId,
  CameraAbilityLevelDefinition,
  CameraAbilityUpgradeTree,
  UnlockContext,
  UnlockValidationResult,
  UpgradeProgressionState,
} from "./types.js";
import { CAMERA_ABILITY_IDS } from "./types.js";

const log = logger.create("UpgradeProgression");

const STORAGE_KEY = "biscuits-chaos-upgrade-progression";
const STATE_VERSION = 1;
const XP_PER_ABILITY_USE = 10;
const XP_PER_SUCCESSFUL_DISRUPTION = 25;

type ProgressionEvent = "changed" | "tokensChanged" | "xpEarned" | "levelUnlocked";

interface ProgressionEventPayloadByEvent {
  changed: UpgradeProgressionState;
  tokensChanged: { balance: number; delta: number };
  xpEarned: { abilityId: CameraAbilityId; amount: number; total: number };
  levelUnlocked: { abilityId: CameraAbilityId; level: number };
}

interface UpgradeProgressionServiceOptions {
  storage?: Storage;
  initialTokens?: number;
  upgradeTrees?: CameraAbilityUpgradeTree[];
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number): string | null {
      const keys = Array.from(store.keys());
      return keys[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

let fallbackStorage: Storage | null = null;

function resolveStorage(storage?: Storage): Storage {
  if (storage) return storage;

  const globalScope = globalThis as typeof globalThis & { localStorage?: Storage };
  if (globalScope.localStorage) {
    return globalScope.localStorage;
  }

  if (!fallbackStorage) {
    fallbackStorage = createMemoryStorage();
    log.warn("localStorage unavailable, using in-memory upgrade progression storage");
  }

  return fallbackStorage;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function now(): number {
  return Date.now();
}

export class UpgradeProgressionService {
  private readonly storage: Storage;
  private readonly upgradeTreesByAbility: Record<CameraAbilityId, CameraAbilityUpgradeTree>;
  private readonly listeners = new Map<ProgressionEvent, Set<(payload: unknown) => void>>();
  private state: UpgradeProgressionState;

  constructor(options: UpgradeProgressionServiceOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.upgradeTreesByAbility = this.normalizeUpgradeTrees(
      options.upgradeTrees ?? CAMERA_ABILITY_UPGRADE_TREES
    );
    this.state = this.loadState(options.initialTokens ?? 0);
  }

  getState(): UpgradeProgressionState {
    return JSON.parse(JSON.stringify(this.state)) as UpgradeProgressionState;
  }

  getTokenBalance(): number {
    return this.state.chaosTokens;
  }

  awardTokens(amount: number): number {
    const safeAmount = Math.max(0, Math.floor(amount));
    if (safeAmount <= 0) return this.state.chaosTokens;

    this.state.chaosTokens += safeAmount;
    this.state.updatedAt = now();
    this.saveState();
    this.emit("tokensChanged", { balance: this.state.chaosTokens, delta: safeAmount });
    this.emitChanged();

    return this.state.chaosTokens;
  }

  spendTokens(amount: number): boolean {
    const safeAmount = Math.max(0, Math.floor(amount));
    if (safeAmount <= 0) return true;
    if (this.state.chaosTokens < safeAmount) return false;

    this.state.chaosTokens -= safeAmount;
    this.state.updatedAt = now();
    this.saveState();
    this.emit("tokensChanged", { balance: this.state.chaosTokens, delta: -safeAmount });
    this.emitChanged();
    return true;
  }

  onAbilityUsed(abilityId: CameraAbilityId): number {
    const progress = this.getProgressRef(abilityId);
    progress.timesUsed += 1;
    progress.updatedAt = now();
    this.saveState();
    return this.earnAbilityXP(abilityId, XP_PER_ABILITY_USE);
  }

  onSuccessfulDisruption(abilityId: CameraAbilityId): number {
    const progress = this.getProgressRef(abilityId);
    progress.successfulDisruptions += 1;
    progress.updatedAt = now();
    this.saveState();
    return this.earnAbilityXP(abilityId, XP_PER_SUCCESSFUL_DISRUPTION);
  }

  earnAbilityXP(abilityId: CameraAbilityId, amount: number): number {
    const safeAmount = Math.max(0, Math.floor(amount));
    const progress = this.getProgressRef(abilityId);
    if (safeAmount <= 0) return progress.xp;

    progress.xp += safeAmount;
    progress.updatedAt = now();
    this.state.updatedAt = progress.updatedAt;
    this.saveState();
    this.emit("xpEarned", { abilityId, amount: safeAmount, total: progress.xp });
    this.emitChanged();
    return progress.xp;
  }

  getAbilityProgress(abilityId: CameraAbilityId): AbilityProgressState {
    return { ...this.getProgressRef(abilityId) };
  }

  getCurrentLevel(abilityId: CameraAbilityId): number {
    return this.getProgressRef(abilityId).unlockedLevel;
  }

  getUpgradeTree(abilityId: CameraAbilityId): CameraAbilityUpgradeTree {
    return this.upgradeTreesByAbility[abilityId];
  }

  getLevelDefinition(
    abilityId: CameraAbilityId,
    level: number = this.getCurrentLevel(abilityId)
  ): CameraAbilityLevelDefinition | null {
    const tree = this.upgradeTreesByAbility[abilityId];
    return tree.levels.find((entry) => entry.level === level) ?? null;
  }

  getNextUnlock(
    abilityId: CameraAbilityId,
    context: UnlockContext = {}
  ): AbilityUnlockPreview | null {
    const currentLevel = this.getCurrentLevel(abilityId);
    const nextLevel = currentLevel + 1;
    const definition = this.getLevelDefinition(abilityId, nextLevel);
    if (!definition) return null;

    return {
      abilityId,
      level: nextLevel,
      definition,
      validation: this.canUnlockLevel(abilityId, nextLevel, context),
    };
  }

  getAllNextUnlocks(context: UnlockContext = {}): AbilityUnlockPreview[] {
    return CAMERA_ABILITY_IDS
      .map((abilityId) => this.getNextUnlock(abilityId, context))
      .filter((entry): entry is AbilityUnlockPreview => entry !== null);
  }

  canUnlockLevel(
    abilityId: CameraAbilityId,
    level: number,
    context: UnlockContext = {}
  ): UnlockValidationResult {
    const tree = this.upgradeTreesByAbility[abilityId];
    const progress = this.getProgressRef(abilityId);
    const maxLevel = tree.levels.length;

    if (level < 1 || level > maxLevel) {
      return { allowed: false, reason: "invalid_level" };
    }
    if (level <= progress.unlockedLevel) {
      return { allowed: false, reason: "already_unlocked" };
    }
    if (level !== progress.unlockedLevel + 1) {
      return { allowed: false, reason: "previous_level_locked" };
    }

    const definition = this.getLevelDefinition(abilityId, level);
    if (!definition) {
      return { allowed: false, reason: "invalid_level" };
    }

    const requirement = definition.unlockRequirement;
    switch (requirement.type) {
      case "default":
        return { allowed: true, requirement };
      case "xp":
        return progress.xp >= requirement.amount
          ? { allowed: true, requirement }
          : { allowed: false, reason: "insufficient_xp", requirement };
      case "currency":
        return this.state.chaosTokens >= requirement.amount
          ? { allowed: true, requirement }
          : { allowed: false, reason: "insufficient_tokens", requirement };
      case "achievement": {
        const achievements = new Set<string>([
          ...this.state.achievements,
          ...(context.achievements ?? []),
        ]);
        return achievements.has(requirement.achievementId)
          ? { allowed: true, requirement }
          : { allowed: false, reason: "missing_achievement", requirement };
      }
      default:
        return { allowed: false, reason: "invalid_level" };
    }
  }

  unlockLevel(
    abilityId: CameraAbilityId,
    level: number,
    context: UnlockContext = {}
  ): UnlockValidationResult {
    const validation = this.canUnlockLevel(abilityId, level, context);
    if (!validation.allowed) {
      return validation;
    }

    const definition = this.getLevelDefinition(abilityId, level);
    if (!definition) {
      return { allowed: false, reason: "invalid_level" };
    }

    if (definition.unlockRequirement.type === "currency") {
      const didSpend = this.spendTokens(definition.unlockRequirement.amount);
      if (!didSpend) {
        return {
          allowed: false,
          reason: "insufficient_tokens",
          requirement: definition.unlockRequirement,
        };
      }
    }

    const progress = this.getProgressRef(abilityId);
    progress.unlockedLevel = level;
    progress.updatedAt = now();
    this.state.updatedAt = progress.updatedAt;
    this.saveState();
    this.emit("levelUnlocked", { abilityId, level });
    this.emitChanged();

    return { allowed: true, requirement: definition.unlockRequirement };
  }

  grantAchievement(achievementId: string): void {
    const normalized = achievementId.trim();
    if (!normalized) return;
    if (this.state.achievements.includes(normalized)) return;

    this.state.achievements.push(normalized);
    this.state.updatedAt = now();
    this.saveState();
    this.emitChanged();
  }

  revokeAchievement(achievementId: string): void {
    const next = this.state.achievements.filter((id) => id !== achievementId);
    if (next.length === this.state.achievements.length) return;

    this.state.achievements = next;
    this.state.updatedAt = now();
    this.saveState();
    this.emitChanged();
  }

  hasAchievement(achievementId: string): boolean {
    return this.state.achievements.includes(achievementId);
  }

  resetProgress(initialTokens: number = 0): void {
    this.state = this.createDefaultState(initialTokens);
    this.saveState();
    this.emitChanged();
  }

  on<K extends ProgressionEvent>(
    event: K,
    callback: (payload: ProgressionEventPayloadByEvent[K]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as (payload: unknown) => void);

    return () => {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.delete(callback as (payload: unknown) => void);
      }
    };
  }

  off<K extends ProgressionEvent>(
    event: K,
    callback: (payload: ProgressionEventPayloadByEvent[K]) => void
  ): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback as (payload: unknown) => void);
    }
  }

  private loadState(initialTokens: number): UpgradeProgressionState {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) {
        return this.createDefaultState(initialTokens);
      }

      const parsed = JSON.parse(raw) as Partial<UpgradeProgressionState>;
      if (parsed.version !== STATE_VERSION) {
        log.warn("Upgrade progression version mismatch, resetting state");
        return this.createDefaultState(initialTokens);
      }

      const base = this.createDefaultState(initialTokens);
      base.chaosTokens = Math.max(0, Math.floor(parsed.chaosTokens ?? base.chaosTokens));
      base.achievements = Array.from(
        new Set((parsed.achievements ?? []).filter((entry) => typeof entry === "string"))
      );
      base.updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : base.updatedAt;

      for (const abilityId of CAMERA_ABILITY_IDS) {
        const parsedProgress = parsed.abilities?.[abilityId];
        if (!parsedProgress) continue;

        const maxLevel = this.upgradeTreesByAbility[abilityId].levels.length;
        base.abilities[abilityId] = {
          abilityId,
          xp: Math.max(0, Math.floor(parsedProgress.xp ?? 0)),
          unlockedLevel: clampInt(parsedProgress.unlockedLevel ?? 1, 1, maxLevel),
          timesUsed: Math.max(0, Math.floor(parsedProgress.timesUsed ?? 0)),
          successfulDisruptions: Math.max(
            0,
            Math.floor(parsedProgress.successfulDisruptions ?? 0)
          ),
          updatedAt: typeof parsedProgress.updatedAt === "number"
            ? parsedProgress.updatedAt
            : base.abilities[abilityId].updatedAt,
        };
      }

      return base;
    } catch (error) {
      log.warn("Failed to load upgrade progression state, resetting:", error);
      return this.createDefaultState(initialTokens);
    }
  }

  private createDefaultState(initialTokens: number): UpgradeProgressionState {
    const createdAt = now();
    const abilities = CAMERA_ABILITY_IDS.reduce((acc, abilityId) => {
      acc[abilityId] = this.createDefaultAbilityProgress(abilityId, createdAt);
      return acc;
    }, {} as Record<CameraAbilityId, AbilityProgressState>);

    return {
      version: STATE_VERSION,
      chaosTokens: Math.max(0, Math.floor(initialTokens)),
      achievements: [],
      abilities,
      updatedAt: createdAt,
    };
  }

  private createDefaultAbilityProgress(
    abilityId: CameraAbilityId,
    timestamp: number
  ): AbilityProgressState {
    return {
      abilityId,
      xp: 0,
      unlockedLevel: 1,
      timesUsed: 0,
      successfulDisruptions: 0,
      updatedAt: timestamp,
    };
  }

  private getProgressRef(abilityId: CameraAbilityId): AbilityProgressState {
    return this.state.abilities[abilityId];
  }

  private saveState(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      log.error("Failed to save upgrade progression state:", error);
    }
  }

  private emitChanged(): void {
    this.emit("changed", this.getState());
  }

  private emit<K extends ProgressionEvent>(
    event: K,
    payload: ProgressionEventPayloadByEvent[K]
  ): void {
    const eventListeners = this.listeners.get(event);
    if (!eventListeners) return;

    eventListeners.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        log.error(`Error in ${event} listener:`, error);
      }
    });
  }

  private normalizeUpgradeTrees(
    trees: CameraAbilityUpgradeTree[]
  ): Record<CameraAbilityId, CameraAbilityUpgradeTree> {
    const byId = {} as Record<CameraAbilityId, CameraAbilityUpgradeTree>;
    trees.forEach((tree) => {
      byId[tree.abilityId] = tree;
    });

    for (const abilityId of CAMERA_ABILITY_IDS) {
      if (!byId[abilityId]) {
        throw new Error(`Missing upgrade tree definition for ability: ${abilityId}`);
      }
    }

    return byId;
  }
}

export const upgradeProgressionService = new UpgradeProgressionService();
