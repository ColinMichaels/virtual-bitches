/**
 * Notification System
 * Displays channel-specific notifications:
 * - gameplay: centered gameboard toasts
 * - private: side toasts for direct/private player messages
 * - debug: toggleable right-corner monitor
 */

export type NotificationType = "info" | "success" | "warning" | "error";
export type NotificationChannel = "gameplay" | "debug" | "private";
export type NotificationParticlePreset = "none" | "spark" | "burst" | "confetti";
type ToastChannel = "gameplay" | "private";

export interface NotificationShowOptions {
  detail?: string;
  channel?: NotificationChannel;
  icon?: string;
  imageUrl?: string;
  particlePreset?: NotificationParticlePreset;
}

interface QueuedNotification {
  message: string;
  detail?: string;
  dedupeKey: string;
  type: NotificationType;
  duration: number;
  timestamp: number;
  priority: number;
  channel: NotificationChannel;
  icon?: string;
  imageUrl?: string;
  particlePreset: NotificationParticlePreset;
}

interface ActiveNotificationState {
  removeTimer: number;
  dedupeKey: string;
  height: number;
}

interface NotificationVisibilityPrefs {
  gameplay: boolean;
  debug: boolean;
  private: boolean;
}

export class NotificationService {
  private toastContainers!: Record<ToastChannel, HTMLElement>;
  private queueByChannel: Record<ToastChannel, QueuedNotification[]> = {
    gameplay: [],
    private: [],
  };
  private activeNotificationsByChannel: Record<ToastChannel, Map<HTMLElement, ActiveNotificationState>> = {
    gameplay: new Map(),
    private: new Map(),
  };
  private maxVisibleByChannel: Record<ToastChannel, number> = {
    gameplay: 3,
    private: 4,
  };
  private isProcessingByChannel: Record<ToastChannel, boolean> = {
    gameplay: false,
    private: false,
  };
  private debugRecentByDedupeKey: Map<string, number> = new Map();

  private debounceMs = 500; // Ignore duplicate messages within this window
  private stackGapPx = 12;

  private readonly visibilityStorageKey = "vb.notification.channelVisibility.v1";
  private channelVisibility: NotificationVisibilityPrefs;

  private debugRoot: HTMLElement;
  private debugToggle: HTMLButtonElement;
  private debugPanel: HTMLElement;
  private debugUnreadBadge: HTMLElement;
  private debugEntryList: HTMLElement;
  private debugToggleGameplay: HTMLInputElement;
  private debugTogglePrivate: HTMLInputElement;
  private debugToggleDebug: HTMLInputElement;
  private debugUnreadCount = 0;
  private debugPanelOpen = false;

  // Priority levels (higher = more important)
  private readonly priorities = {
    error: 4,
    warning: 3,
    success: 2,
    info: 1,
  };

  constructor() {
    this.channelVisibility = this.loadVisibilityPrefs();

    const gameplayContainer = document.createElement("div");
    gameplayContainer.id = "notification-container";
    const privateContainer = document.createElement("div");
    privateContainer.id = "notification-private-container";
    document.body.appendChild(gameplayContainer);
    document.body.appendChild(privateContainer);
    this.toastContainers = {
      gameplay: gameplayContainer,
      private: privateContainer,
    };

    this.debugRoot = document.createElement("section");
    this.debugRoot.id = "notification-debug-root";

    this.debugToggle = document.createElement("button");
    this.debugToggle.type = "button";
    this.debugToggle.id = "notification-debug-toggle";
    this.debugToggle.className = "notification-debug-toggle";
    this.debugToggle.setAttribute("aria-expanded", "false");
    this.debugToggle.innerHTML = `
      <span class="notification-debug-toggle-label">Debug</span>
      <span id="notification-debug-unread" class="notification-debug-unread is-hidden" aria-live="polite"></span>
    `;
    this.debugUnreadBadge = this.debugToggle.querySelector("#notification-debug-unread") as HTMLElement;

    this.debugPanel = document.createElement("div");
    this.debugPanel.id = "notification-debug-panel";
    this.debugPanel.className = "notification-debug-panel";
    this.debugPanel.innerHTML = `
      <div class="notification-debug-header">
        <strong class="notification-debug-title">Debug Monitor</strong>
        <button type="button" class="notification-debug-clear">Clear</button>
      </div>
      <div class="notification-debug-filters">
        <label class="notification-debug-filter">
          <input id="notification-debug-filter-gameplay" type="checkbox" />
          <span>Gameplay</span>
        </label>
        <label class="notification-debug-filter">
          <input id="notification-debug-filter-private" type="checkbox" />
          <span>Private</span>
        </label>
        <label class="notification-debug-filter">
          <input id="notification-debug-filter-debug" type="checkbox" />
          <span>Debug</span>
        </label>
      </div>
      <div class="notification-debug-list-wrap">
        <ul id="notification-debug-list" class="notification-debug-list" aria-live="polite"></ul>
      </div>
    `;
    this.debugEntryList = this.debugPanel.querySelector("#notification-debug-list") as HTMLElement;
    this.debugToggleGameplay = this.debugPanel.querySelector(
      "#notification-debug-filter-gameplay"
    ) as HTMLInputElement;
    this.debugTogglePrivate = this.debugPanel.querySelector(
      "#notification-debug-filter-private"
    ) as HTMLInputElement;
    this.debugToggleDebug = this.debugPanel.querySelector(
      "#notification-debug-filter-debug"
    ) as HTMLInputElement;

    this.debugRoot.appendChild(this.debugToggle);
    this.debugRoot.appendChild(this.debugPanel);
    document.body.appendChild(this.debugRoot);

    this.debugToggle.addEventListener("click", () => {
      this.setDebugPanelOpen(!this.debugPanelOpen);
    });
    (this.debugPanel.querySelector(".notification-debug-clear") as HTMLButtonElement).addEventListener(
      "click",
      () => {
        this.debugEntryList.innerHTML = "";
      }
    );
    this.debugToggleGameplay.addEventListener("change", () => {
      this.setChannelVisibility("gameplay", this.debugToggleGameplay.checked);
    });
    this.debugTogglePrivate.addEventListener("change", () => {
      this.setChannelVisibility("private", this.debugTogglePrivate.checked);
    });
    this.debugToggleDebug.addEventListener("change", () => {
      this.setChannelVisibility("debug", this.debugToggleDebug.checked);
    });

    this.syncDebugFilterInputs();
    this.applyChannelVisibility();
    this.setDebugPanelOpen(false);
  }

  /**
   * Show a notification in gameplay, private, or debug channel.
   * @param message The message to display
   * @param type The notification type (info, success, warning, error)
   * @param duration Duration in milliseconds (default: 2000ms to match animation)
   * @param options Optional detail + channel routing
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
    const channel = options?.channel ?? "gameplay";
    if (!this.channelVisibility[channel]) {
      return;
    }
    const now = Date.now();
    const normalizedIcon = this.normalizeIcon(options?.icon);
    const normalizedImageUrl = this.normalizeImageUrl(options?.imageUrl);
    const particlePreset = this.normalizeParticlePreset(options?.particlePreset);
    const dedupeKey =
      `${normalized.dedupeKey}|${normalizedIcon ?? ""}|${normalizedImageUrl ?? ""}|${particlePreset}`;

    // Check for duplicate in active notifications or recent queue (debouncing)
    if (this.isDuplicate(channel, dedupeKey, now)) {
      return;
    }

    const notification: QueuedNotification = {
      message: normalized.message,
      detail: normalized.detail,
      dedupeKey,
      type,
      duration,
      timestamp: now,
      priority: this.priorities[type],
      channel,
      icon: normalizedIcon,
      imageUrl: normalizedImageUrl,
      particlePreset,
    };

    if (channel === "debug") {
      this.displayDebugNotification(notification);
      return;
    }

    // Add to queue (sorted by priority) per toast channel
    this.queueByChannel[channel].push(notification);
    this.queueByChannel[channel].sort((a, b) => b.priority - a.priority);

    // Process channel queue
    this.processQueue(channel);
  }

  /**
   * Check if message is duplicate within debounce window
   */
  private isDuplicate(channel: NotificationChannel, dedupeKey: string, now: number): boolean {
    if (channel === "debug") {
      const lastShown = this.debugRecentByDedupeKey.get(dedupeKey);
      if (typeof lastShown === "number" && now - lastShown < this.debounceMs) {
        return true;
      }
      return false;
    }

    // Check active toast notifications in channel
    for (const [, notificationState] of this.activeNotificationsByChannel[channel]) {
      if (notificationState.dedupeKey === dedupeKey) {
        return true;
      }
    }

    // Check recent queue items in channel
    return this.queueByChannel[channel].some(
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

  private normalizeIcon(icon: unknown): string | undefined {
    if (typeof icon !== "string") {
      return undefined;
    }
    const normalized = icon.trim();
    if (!normalized) {
      return undefined;
    }
    return normalized.slice(0, 12);
  }

  private normalizeImageUrl(imageUrl: unknown): string | undefined {
    if (typeof imageUrl !== "string") {
      return undefined;
    }
    const normalized = imageUrl.trim();
    if (!normalized) {
      return undefined;
    }
    if (/^(https?:\/\/|data:image\/|\/|\.{1,2}\/)/i.test(normalized)) {
      return normalized;
    }
    return undefined;
  }

  private normalizeParticlePreset(
    value: NotificationParticlePreset | undefined
  ): NotificationParticlePreset {
    return value === "spark" || value === "burst" || value === "confetti"
      ? value
      : "none";
  }

  private calculateNextOffset(channel: ToastChannel): number {
    let offset = 0;
    for (const [, notificationState] of this.activeNotificationsByChannel[channel]) {
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
  private processQueue(channel: ToastChannel): void {
    if (this.isProcessingByChannel[channel]) return;
    this.isProcessingByChannel[channel] = true;

    // Show notifications up to maxVisible limit for this channel
    while (
      this.queueByChannel[channel].length > 0 &&
      this.activeNotificationsByChannel[channel].size < this.maxVisibleByChannel[channel]
    ) {
      const notification = this.queueByChannel[channel].shift();
      if (notification) {
        this.displayToastNotification(channel, notification);
      }
    }

    this.isProcessingByChannel[channel] = false;
  }

  /**
   * Display a single toast notification
   */
  private displayToastNotification(channel: ToastChannel, notification: QueuedNotification): void {
    const { message, detail, type, duration, dedupeKey, icon, imageUrl, particlePreset } =
      notification;

    // Create notification element and route style by channel
    const el = document.createElement("div");
    el.className = `notification notification-${type} notification-channel-${channel}`;
    el.setAttribute("role", "status");
    const hasRichMedia = Boolean(icon || imageUrl);
    if (hasRichMedia) {
      el.classList.add("notification-rich");
    }

    const content = document.createElement("div");
    content.className = "notification-content";

    if (imageUrl) {
      const imageEl = document.createElement("img");
      imageEl.className = "notification-image";
      imageEl.alt = "";
      imageEl.decoding = "async";
      imageEl.loading = "eager";
      imageEl.src = imageUrl;
      imageEl.addEventListener("error", () => {
        imageEl.remove();
      });
      content.appendChild(imageEl);
    }

    if (icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "notification-icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.textContent = icon;
      content.appendChild(iconEl);
    }

    const textGroup = document.createElement("div");
    textGroup.className = "notification-text";

    const primaryLine = document.createElement("p");
    primaryLine.className = "notification-message";
    primaryLine.textContent = message;
    textGroup.appendChild(primaryLine);

    if (detail) {
      const detailLine = document.createElement("p");
      detailLine.className = "notification-detail";
      detailLine.textContent = detail;
      textGroup.appendChild(detailLine);
    }

    content.appendChild(textGroup);
    el.appendChild(content);

    // Calculate vertical offset based on active notifications in channel
    const offset = this.calculateNextOffset(channel);
    el.style.top = `${offset}px`;

    // Add to channel container
    this.toastContainers[channel].appendChild(el);
    this.emitToastParticles(el, type, particlePreset);

    // Track active notification
    const removeTimer = window.setTimeout(() => {
      this.removeToastNotification(channel, el);
    }, duration);

    this.activeNotificationsByChannel[channel].set(el, {
      removeTimer,
      dedupeKey,
      height: this.measureNotificationHeight(el),
    });
    this.restackNotifications(channel);
  }

  private emitToastParticles(
    anchor: HTMLElement,
    type: NotificationType,
    preset: NotificationParticlePreset
  ): void {
    if (preset === "none") {
      return;
    }

    const countByPreset: Record<Exclude<NotificationParticlePreset, "none">, number> = {
      spark: 8,
      burst: 12,
      confetti: 16,
    };
    const count = countByPreset[preset];
    const typeHue: Record<NotificationType, number> = {
      info: 206,
      success: 132,
      warning: 42,
      error: 2,
    };

    const layer = document.createElement("div");
    layer.className = `notification-particle-layer notification-particle-layer-${preset}`;
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("span");
      particle.className = "notification-particle";
      const normalizedProgress = (index / Math.max(1, count - 1)) * 360;
      const angle = normalizedProgress + Math.random() * 18 - 9;
      const distance =
        preset === "burst"
          ? 52 + Math.random() * 46
          : preset === "confetti"
            ? 44 + Math.random() * 56
            : 34 + Math.random() * 30;
      const size =
        preset === "confetti" ? 4 + Math.random() * 5 : 3 + Math.random() * 4;
      const delay = Math.random() * 120;
      const hueShift = preset === "confetti" ? index * 17 : Math.random() * 8 - 4;
      particle.style.setProperty("--particle-angle", `${angle}deg`);
      particle.style.setProperty("--particle-distance", `${distance}px`);
      particle.style.setProperty("--particle-size", `${size}px`);
      particle.style.setProperty("--particle-delay", `${delay}ms`);
      particle.style.setProperty("--particle-hue", `${typeHue[type] + hueShift}`);
      layer.appendChild(particle);
    }
    anchor.appendChild(layer);
    window.setTimeout(() => {
      layer.remove();
    }, 1300);
  }

  /**
   * Display debug monitor entry
   */
  private displayDebugNotification(notification: QueuedNotification): void {
    const { message, detail, type, timestamp, dedupeKey, icon } = notification;
    this.debugRecentByDedupeKey.set(dedupeKey, timestamp);

    const item = document.createElement("li");
    item.className = `notification-debug-entry notification-debug-entry-${type}`;
    const timeLabel = new Date(timestamp).toLocaleTimeString([], { hour12: false });

    const head = document.createElement("div");
    head.className = "notification-debug-entry-head";

    const timeEl = document.createElement("span");
    timeEl.className = "notification-debug-entry-time";
    timeEl.textContent = timeLabel;
    head.appendChild(timeEl);

    const levelEl = document.createElement("span");
    levelEl.className = "notification-debug-entry-level";
    levelEl.textContent = type.toUpperCase();
    head.appendChild(levelEl);

    const messageEl = document.createElement("p");
    messageEl.className = "notification-debug-entry-message";
    messageEl.textContent = icon ? `${icon} ${message}` : message;

    item.appendChild(head);
    item.appendChild(messageEl);

    if (detail) {
      const detailEl = document.createElement("p");
      detailEl.className = "notification-debug-entry-detail";
      detailEl.textContent = detail;
      item.appendChild(detailEl);
    }

    this.debugEntryList.prepend(item);

    while (this.debugEntryList.childElementCount > 100) {
      const last = this.debugEntryList.lastElementChild;
      if (!last) {
        break;
      }
      last.remove();
    }

    if (!this.debugPanelOpen) {
      this.debugUnreadCount += 1;
      this.updateDebugUnreadBadge();
    }
  }

  /**
   * Remove a toast notification and restack remaining ones
   */
  private removeToastNotification(channel: ToastChannel, el: HTMLElement): void {
    const notificationData = this.activeNotificationsByChannel[channel].get(el);
    if (!notificationData) return;

    clearTimeout(notificationData.removeTimer);
    this.activeNotificationsByChannel[channel].delete(el);
    el.remove();

    this.restackNotifications(channel);
    this.processQueue(channel);
  }

  /**
   * Restack all active toasts for a channel after removal
   */
  private restackNotifications(channel: ToastChannel): void {
    let offset = 0;
    for (const [el, notificationState] of this.activeNotificationsByChannel[channel]) {
      notificationState.height = this.measureNotificationHeight(el);
      el.style.top = `${offset}px`;
      offset += notificationState.height + this.stackGapPx;
    }
  }

  private setDebugPanelOpen(open: boolean): void {
    this.debugPanelOpen = open;
    this.debugRoot.classList.toggle("is-open", open);
    this.debugPanel.classList.toggle("is-open", open);
    this.debugToggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      this.debugUnreadCount = 0;
      this.updateDebugUnreadBadge();
    }
  }

  private setChannelVisibility(channel: NotificationChannel, visible: boolean): void {
    this.channelVisibility[channel] = visible;
    this.persistVisibilityPrefs();
    this.syncDebugFilterInputs();
    this.applyChannelVisibility();
    if (!visible && (channel === "gameplay" || channel === "private")) {
      this.clearToastChannel(channel);
    }
  }

  private clearToastChannel(channel: ToastChannel): void {
    for (const [, data] of this.activeNotificationsByChannel[channel]) {
      clearTimeout(data.removeTimer);
    }
    this.activeNotificationsByChannel[channel].clear();
    this.queueByChannel[channel] = [];
    this.toastContainers[channel].innerHTML = "";
  }

  private applyChannelVisibility(): void {
    this.toastContainers.gameplay.classList.toggle(
      "is-channel-disabled",
      !this.channelVisibility.gameplay
    );
    this.toastContainers.private.classList.toggle(
      "is-channel-disabled",
      !this.channelVisibility.private
    );
  }

  private loadVisibilityPrefs(): NotificationVisibilityPrefs {
    try {
      const rawValue = window.localStorage.getItem(this.visibilityStorageKey);
      if (!rawValue) {
        return { gameplay: true, debug: true, private: true };
      }
      const parsed = JSON.parse(rawValue) as Partial<NotificationVisibilityPrefs>;
      return {
        gameplay: parsed.gameplay !== false,
        debug: parsed.debug !== false,
        private: parsed.private !== false,
      };
    } catch {
      return { gameplay: true, debug: true, private: true };
    }
  }

  private persistVisibilityPrefs(): void {
    try {
      window.localStorage.setItem(this.visibilityStorageKey, JSON.stringify(this.channelVisibility));
    } catch {
      // Ignore persistence failures (private browsing, storage denied, etc.)
    }
  }

  private syncDebugFilterInputs(): void {
    this.debugToggleGameplay.checked = this.channelVisibility.gameplay;
    this.debugTogglePrivate.checked = this.channelVisibility.private;
    this.debugToggleDebug.checked = this.channelVisibility.debug;
  }

  private updateDebugUnreadBadge(): void {
    if (this.debugUnreadCount <= 0) {
      this.debugUnreadBadge.classList.add("is-hidden");
      this.debugUnreadBadge.textContent = "";
      return;
    }
    this.debugUnreadBadge.classList.remove("is-hidden");
    this.debugUnreadBadge.textContent = this.debugUnreadCount > 99 ? "99+" : `${this.debugUnreadCount}`;
  }

  /**
   * Clear all notifications immediately
   */
  clear(): void {
    this.clearToastChannel("gameplay");
    this.clearToastChannel("private");
    this.debugEntryList.innerHTML = "";
    this.debugRecentByDedupeKey.clear();
    this.debugUnreadCount = 0;
    this.updateDebugUnreadBadge();
  }
}

// Singleton instance
export const notificationService = new NotificationService();
