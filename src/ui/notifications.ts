/**
 * Notification System
 * Displays game-style floating text notifications
 */

export type NotificationType = "info" | "success" | "warning" | "error";

export class NotificationService {
  private container: HTMLElement;

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
    // Create notification element
    const el = document.createElement("div");
    el.className = `notification notification-${type}`;
    el.textContent = message;

    // Add to container (CSS handles stacking and animations)
    this.container.appendChild(el);

    // Remove after animation completes
    setTimeout(() => {
      el.remove();
    }, duration);
  }

  /**
   * Clear all notifications immediately
   */
  clear(): void {
    this.container.innerHTML = "";
  }
}

// Singleton instance
export const notificationService = new NotificationService();
