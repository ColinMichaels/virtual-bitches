/**
 * Notification System
 * Displays game-style floating text notifications with queueing and debouncing
 */

export type NotificationType = "info" | "success" | "warning" | "error";

interface QueuedNotification {
  message: string;
  type: NotificationType;
  duration: number;
  timestamp: number;
  priority: number;
}

export class NotificationService {
  private container: HTMLElement;
  private queue: QueuedNotification[] = [];
  private activeNotifications: Map<HTMLElement, { removeTimer: number }> = new Map();
  private maxVisible = 3; // Maximum notifications visible at once
  private debounceMs = 500; // Ignore duplicate messages within this window
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
   */
  show(message: string, type: NotificationType = "info", duration: number = 2000): void {
    const now = Date.now();

    // Check for duplicate in active notifications or recent queue (debouncing)
    if (this.isDuplicate(message, now)) {
      return;
    }

    const notification: QueuedNotification = {
      message,
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
  private isDuplicate(message: string, now: number): boolean {
    // Check active notifications
    for (const [el] of this.activeNotifications) {
      if (el.textContent === message) {
        return true;
      }
    }

    // Check recent queue items
    return this.queue.some(
      (n) => n.message === message && now - n.timestamp < this.debounceMs
    );
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
    const { message, type, duration } = notification;

    // Create notification element
    const el = document.createElement("div");
    el.className = `notification notification-${type}`;
    el.textContent = message;

    // Calculate vertical offset based on active notifications
    const offset = this.activeNotifications.size * 80; // 80px per notification
    el.style.top = `${offset}px`;

    // Add to container
    this.container.appendChild(el);

    // Track active notification
    const removeTimer = window.setTimeout(() => {
      this.removeNotification(el);
    }, duration);

    this.activeNotifications.set(el, { removeTimer });
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
    let index = 0;
    for (const [el] of this.activeNotifications) {
      el.style.top = `${index * 80}px`;
      index++;
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
