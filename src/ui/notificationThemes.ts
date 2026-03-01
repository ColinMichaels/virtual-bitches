import {
  notificationService,
  type NotificationChannel,
  type NotificationParticlePreset,
  type NotificationShowOptions,
  type NotificationType,
} from "./notifications.js";

export type GameplayNotificationThemeId =
  | "host_control_forbidden"
  | "host_control_update_failed"
  | "host_control_paused"
  | "host_control_resumed"
  | "host_control_speed_fast"
  | "host_control_speed_normal"
  | "round_winner";

interface NotificationThemeConfig {
  type: NotificationType;
  duration: number;
  channel: NotificationChannel;
  icon?: string;
  particlePreset?: NotificationParticlePreset;
  imageUrl?: string;
}

const gameplayNotificationThemes: Record<GameplayNotificationThemeId, NotificationThemeConfig> = {
  host_control_forbidden: {
    type: "warning",
    duration: 2200,
    channel: "gameplay",
    icon: "🛡️",
    particlePreset: "none",
  },
  host_control_update_failed: {
    type: "error",
    duration: 2600,
    channel: "gameplay",
    icon: "⛔",
    particlePreset: "burst",
  },
  host_control_paused: {
    type: "info",
    duration: 1800,
    channel: "gameplay",
    icon: "⏸️",
    particlePreset: "none",
  },
  host_control_resumed: {
    type: "success",
    duration: 1800,
    channel: "gameplay",
    icon: "▶️",
    particlePreset: "spark",
  },
  host_control_speed_fast: {
    type: "info",
    duration: 1800,
    channel: "gameplay",
    icon: "⚡",
    particlePreset: "none",
  },
  host_control_speed_normal: {
    type: "info",
    duration: 1800,
    channel: "gameplay",
    icon: "🎯",
    particlePreset: "none",
  },
  round_winner: {
    type: "success",
    duration: 2800,
    channel: "gameplay",
    icon: "🏆",
    particlePreset: "confetti",
  },
};

interface ThemedNotificationOverrides {
  type?: NotificationType;
  duration?: number;
  channel?: NotificationChannel;
  detail?: string;
  icon?: string;
  imageUrl?: string;
  particlePreset?: NotificationParticlePreset;
}

export function showGameplayThemedNotification(
  themeId: GameplayNotificationThemeId,
  message: string,
  overrides?: ThemedNotificationOverrides
): void {
  const theme = gameplayNotificationThemes[themeId];
  if (!theme) {
    notificationService.show(message, "info", 2200);
    return;
  }

  const options: NotificationShowOptions = {
    channel: overrides?.channel ?? theme.channel,
    detail: overrides?.detail,
    icon: overrides?.icon ?? theme.icon,
    imageUrl: overrides?.imageUrl ?? theme.imageUrl,
    particlePreset: overrides?.particlePreset ?? theme.particlePreset,
  };

  notificationService.show(
    message,
    overrides?.type ?? theme.type,
    overrides?.duration ?? theme.duration,
    options
  );
}

interface DebugAuditOptions {
  detail?: string;
  duration?: number;
  type?: NotificationType;
  icon?: string;
}

export function showDebugAuditNotification(
  message: string,
  options?: DebugAuditOptions
): void {
  notificationService.show(
    message,
    options?.type ?? "info",
    options?.duration ?? 2800,
    {
      channel: "debug",
      detail: options?.detail,
      icon: options?.icon,
      particlePreset: "none",
    }
  );
}

