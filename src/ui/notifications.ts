/**
 * Notification System
 * Displays game-style floating text notifications with queueing and debouncing
 */

export type NotificationType = "info" | "success" | "warning" | "error";

export interface NotificationShowOptions {
  detail?: string;
}

interface QueuedNotification {
  message: string;
  detail?: string;
  dedupeKey: string;
  type: NotificationType;
  duration: number;
  timestamp: number;
  priority: number;
}

export class NotificationService {
  private container: HTMLElement;
  private queue: QueuedNotification[] = [];
  private activeNotifications: Map<
    HTMLElement,
    { removeTimer: number; dedupeKey: string; height: number }
  > = new Map();
  private maxVisible = 3; // Maximum notifications visible at once
  private debounceMs = 500; // Ignore duplicate messages within this window
  private stackGapPx = 12;
  private isProcessing = false;

  // Priority levels (higher = more important)
  private readonly priorities = {
    error: 4,
    warning: 3,
    success: 2,
    info: 1,
  };

  constructor() {
    // Create notification container
    this.container = document.createElement("div");
    this.container.id = "notification-container";
    document.body.appendChild(this.container);
  }

  /**
   * Show a notification with floating animation
   * @param message The message to display
   * @param type The notification type (info, success, warning, error)
   * @param duration Duration in milliseconds (default: 2000ms to match animation)
   * @param options Optional detail line (smaller text) shown under the main message
   */
  show(
    message: string,
    type: NotificationType = "info",
    duration: number = 2000,
    options?: NotificationShowOptions
  ): void {
    const normalized = this.normalizeMessage(message, options?.detail);
    if (!normalized) {
      return;
    }
    const now = Date.now();

    // Check for duplicate in active notifications or recent queue (debouncing)
    if (this.isDuplicate(normalized.dedupeKey, now)) {
      return;
    }

    const notification: QueuedNotification = {
      message: normalized.message,
      detail: normalized.detail,
      dedupeKey: normalized.dedupeKey,
      type,
      duration,
      timestamp: now,
      priority: this.priorities[type],
    };

    // Add to queue (sorted by priority)
    this.queue.push(notification);
    this.queue.sort((a, b) => b.priority - a.priority);

    // Process queue
    this.processQueue();
  }

  /**
   * Check if message is duplicate within debounce window
   */
  private isDuplicate(dedupeKey: string, now: number): boolean {
    // Check active notifications
    for (const [, notificationState] of this.activeNotifications) {
      if (notificationState.dedupeKey === dedupeKey) {
        return true;
      }
    }

    // Check recent queue items
    return this.queue.some(
      (n) => n.dedupeKey === dedupeKey && now - n.timestamp < this.debounceMs
    );
  }

  private normalizeMessage(
    message: string,
    detail?: string
  ): { message: string; detail?: string; dedupeKey: string } | null {
    const trimmedMessage = message.trim();
    let primary = trimmedMessage;
    let secondary = detail?.trim() ?? "";

    if (!secondary && trimmedMessage.includes("\n")) {
      const lines = trimmedMessage
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      primary = lines.shift() ?? "";
      secondary = lines.join(" ");
    }

    if (!primary && secondary) {
      primary = secondary;
      secondary = "";
    }
    if (!primary) {
      return null;
    }

    const dedupeKey = secondary ? `${primary}\n${secondary}` : primary;
    return {
      message: primary,
      detail: secondary || undefined,
      dedupeKey,
    };
  }

  private calculateNextOffset(): number {
    let offset = 0;
    for (const [, notificationState] of this.activeNotifications) {
      offset += notificationState.height + this.stackGapPx;
    }
    return offset;
  }

  private measureNotificationHeight(el: HTMLElement): number {
    return Math.max(40, Math.ceil(el.getBoundingClientRect().height));
  }

  /**
   * Process queued notifications
   */
  private processQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Show notifications up to maxVisible limit
    while (this.queue.length > 0 && this.activeNotifications.size < this.maxVisible) {
      const notification = this.queue.shift();
      if (notification) {
        this.displayNotification(notification);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Display a single notification
   */
  private displayNotification(notification: QueuedNotification): void {
    const { message, detail, type, duration, dedupeKey } = notification;

    // Create notification element
    const el = document.createElement("div");
    el.className = `notification notification-${type}`;
    el.setAttribute("role", "status");

    const primaryLine = document.createElement("p");
    primaryLine.className = "notification-message";
    primaryLine.textContent = message;
    el.appendChild(primaryLine);

    if (detail) {
      const detailLine = document.createElement("p");
      detailLine.className = "notification-detail";
      detailLine.textContent = detail;
      el.appendChild(detailLine);
    }

    // Calculate vertical offset based on active notifications
    const offset = this.calculateNextOffset();
    el.style.top = `${offset}px`;

    // Add to container
    this.container.appendChild(el);

    // Track active notification
    const removeTimer = window.setTimeout(() => {
      this.removeNotification(el);
    }, duration);

    this.activeNotifications.set(el, {
      removeTimer,
      dedupeKey,
      height: this.measureNotificationHeight(el),
    });
    this.restackNotifications();
  }

  /**
   * Remove a notification and restack remaining ones
   */
  private removeNotification(el: HTMLElement): void {
    const notificationData = this.activeNotifications.get(el);
    if (!notificationData) return;

    // Clear timeout
    clearTimeout(notificationData.removeTimer);

    // Remove from tracking
    this.activeNotifications.delete(el);

    // Remove from DOM
    el.remove();

    // Restack remaining notifications
    this.restackNotifications();

    // Process queue to show next notification
    this.processQueue();
  }

  /**
   * Restack all active notifications after removal
   */
  private restackNotifications(): void {
    let offset = 0;
    for (const [el, notificationState] of this.activeNotifications) {
      notificationState.height = this.measureNotificationHeight(el);
      el.style.top = `${offset}px`;
      offset += notificationState.height + this.stackGapPx;
    }
  }

  /**
   * Clear all notifications immediately
   */
  clear(): void {
    // Clear all timers
    for (const [, data] of this.activeNotifications) {
      clearTimeout(data.removeTimer);
    }

    // Clear tracking
    this.activeNotifications.clear();
    this.queue = [];

    // Clear DOM
    this.container.innerHTML = "";
  }
}

// Singleton instance
export const notificationService = new NotificationService();
