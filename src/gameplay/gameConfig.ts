export type UnifiedGameMode = "solo" | "multiplayer" | "demo";
export type UnifiedGameDifficulty = "easy" | "normal" | "hard";
export type UnifiedGameTimingProfile = "standard" | "demo_fast" | "test_fast";
export type UnifiedGameAutomationSpeedMode = "normal" | "fast";

export interface UnifiedGameCapabilities {
  chaos: boolean;
  gifting: boolean;
  moderation: boolean;
  banning: boolean;
  hostControls: boolean;
  privateChat: boolean;
}

export interface UnifiedGameAutomationConfig {
  enabled: boolean;
  autoRun: boolean;
  botCount: number;
  speedMode: UnifiedGameAutomationSpeedMode;
}

export interface UnifiedGameCreateConfig {
  mode: UnifiedGameMode;
  difficulty: UnifiedGameDifficulty;
  timingProfile: UnifiedGameTimingProfile;
  capabilities: UnifiedGameCapabilities;
  automation: UnifiedGameAutomationConfig;
}

export interface BuildUnifiedGameConfigOptions {
  mode: UnifiedGameMode;
  difficulty?: UnifiedGameDifficulty;
  botCount?: number;
  demoSpeedMode?: boolean;
  autoRun?: boolean;
  timingProfile?: UnifiedGameTimingProfile;
  capabilities?: Partial<UnifiedGameCapabilities>;
}

function normalizeMode(value: unknown): UnifiedGameMode {
  if (value === "solo" || value === "multiplayer" || value === "demo") {
    return value;
  }
  return "multiplayer";
}

function normalizeDifficulty(value: unknown): UnifiedGameDifficulty {
  if (value === "easy" || value === "normal" || value === "hard") {
    return value;
  }
  return "normal";
}

function normalizeBotCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(4, Math.floor(parsed)));
}

function resolveDefaultCapabilities(mode: UnifiedGameMode): UnifiedGameCapabilities {
  if (mode === "solo") {
    return {
      chaos: false,
      gifting: false,
      moderation: false,
      banning: false,
      hostControls: true,
      privateChat: false,
    };
  }
  if (mode === "demo") {
    return {
      chaos: false,
      gifting: false,
      moderation: true,
      banning: true,
      hostControls: true,
      privateChat: true,
    };
  }
  return {
    chaos: false,
    gifting: false,
    moderation: true,
    banning: true,
    hostControls: true,
    privateChat: true,
  };
}

export function buildUnifiedGameConfig(
  options: BuildUnifiedGameConfigOptions
): UnifiedGameCreateConfig {
  const mode = normalizeMode(options.mode);
  const difficulty = normalizeDifficulty(options.difficulty);
  const botCount = normalizeBotCount(options.botCount);
  const fastModeRequested = options.demoSpeedMode === true;
  const speedMode: UnifiedGameAutomationSpeedMode = fastModeRequested ? "fast" : "normal";
  const resolvedTimingProfile =
    options.timingProfile ??
    (fastModeRequested || mode === "demo" ? "demo_fast" : "standard");
  const defaults = resolveDefaultCapabilities(mode);

  return {
    mode,
    difficulty,
    timingProfile: resolvedTimingProfile,
    capabilities: {
      ...defaults,
      ...options.capabilities,
    },
    automation: {
      enabled: mode === "demo" || botCount > 0,
      autoRun: options.autoRun === true || mode === "demo",
      botCount,
      speedMode,
    },
  };
}
