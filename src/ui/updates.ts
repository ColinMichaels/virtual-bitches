/**
 * Updates Panel
 * Small blog section for game updates and notifications
 */

import { audioService } from "../services/audio.js";
import { logger } from "../utils/logger.js";

const log = logger.create('UpdatesPanel');

const STORAGE_KEY = "biscuits-last-seen-update";

export interface GameUpdate {
  id: string;
  date: string;
  title: string;
  content: string;
  version?: string;
  type?: "feature" | "bugfix" | "announcement" | "alert";
}

export interface UpdatesFeed {
  updates: GameUpdate[];
}

export class UpdatesPanel {
  private container: HTMLElement;
  private badge: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private updates: GameUpdate[] = [];
  private lastSeenId: string | null = null;
  private isExpanded = false;

  constructor() {
    this.lastSeenId = this.getLastSeenUpdate();

    // Create updates panel container (button is now in index.html)
    this.container = document.createElement("div");
    this.container.id = "updates-container";
    this.container.className = "updates-container";
    this.container.innerHTML = `
      <div id="updates-panel" class="updates-panel" style="display: none;">
        <div class="updates-header">
          <h3>Game Updates</h3>
          <button id="updates-close-btn" class="updates-close-btn" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div id="updates-list" class="updates-list">
          <div class="updates-loading">Loading updates...</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.badge = document.querySelector(".updates-badge");
    this.panel = document.getElementById("updates-panel");

    // Setup event handlers
    this.setupEventHandlers();

    // Load updates
    this.loadUpdates();
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    const toggleBtn = document.getElementById("updates-toggle-btn");
    const mobileToggleBtn = document.getElementById("mobile-updates-btn");
    const closeBtn = document.getElementById("updates-close-btn");

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        this.togglePanel();
      });
    }

    if (mobileToggleBtn) {
      mobileToggleBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        this.togglePanel();
        // Close mobile menu when opening updates
        const mobileMenu = document.getElementById("mobile-controls-menu");
        if (mobileMenu) {
          mobileMenu.classList.add("mobile-menu-closed");
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        this.closePanel();
      });
    }

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (this.isExpanded &&
          !this.container.contains(e.target as Node) &&
          !(e.target as HTMLElement).closest('#mobile-updates-btn')) {
        this.closePanel();
      }
    });
  }

  /**
   * Load updates from JSON feed
   */
  private async loadUpdates(): Promise<void> {
    try {
      const response = await fetch("/updates.json");
      if (!response.ok) {
        throw new Error(`Failed to load updates: ${response.status}`);
      }

      const data: UpdatesFeed = await response.json();
      this.updates = data.updates || [];

      // Sort by date (newest first)
      this.updates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      this.renderUpdates();
      this.updateBadge();

      log.debug(`Loaded ${this.updates.length} updates`);
    } catch (error) {
      log.error("Failed to load updates:", error);
      this.renderError();
    }
  }

  /**
   * Render updates list
   */
  private renderUpdates(): void {
    const listContainer = document.getElementById("updates-list");
    if (!listContainer) return;

    if (this.updates.length === 0) {
      listContainer.innerHTML = `
        <div class="updates-empty">
          <p>No updates yet. Check back soon!</p>
        </div>
      `;
      return;
    }

    const html = this.updates.map((update) => {
      const isNew = !this.lastSeenId || this.isNewerThan(update.id, this.lastSeenId);
      const typeIcon = this.getTypeIcon(update.type);
      const formattedDate = this.formatDate(update.date);

      return `
        <div class="update-item ${isNew ? 'update-new' : ''}" data-update-id="${update.id}">
          <div class="update-header">
            <div class="update-meta">
              <span class="update-icon">${typeIcon}</span>
              <span class="update-date">${formattedDate}</span>
              ${update.version ? `<span class="update-version">v${update.version}</span>` : ''}
              ${isNew ? '<span class="update-new-badge">NEW</span>' : ''}
            </div>
          </div>
          <h4 class="update-title">${update.title}</h4>
          <div class="update-content">${update.content}</div>
        </div>
      `;
    }).join("");

    listContainer.innerHTML = html;
  }

  /**
   * Render error state
   */
  private renderError(): void {
    const listContainer = document.getElementById("updates-list");
    if (!listContainer) return;

    listContainer.innerHTML = `
      <div class="updates-error">
        <p>Failed to load updates. Please try again later.</p>
      </div>
    `;
  }

  /**
   * Update badge with unread count
   */
  private updateBadge(): void {
    const mobileBadge = document.querySelector(".mobile-updates-badge") as HTMLElement;

    const unreadCount = this.updates.filter(update =>
      !this.lastSeenId || this.isNewerThan(update.id, this.lastSeenId)
    ).length;

    // Update desktop badge
    if (this.badge) {
      if (unreadCount > 0) {
        this.badge.textContent = unreadCount.toString();
        this.badge.style.display = "flex";
      } else {
        this.badge.style.display = "none";
      }
    }

    // Update mobile badge
    if (mobileBadge) {
      if (unreadCount > 0) {
        mobileBadge.textContent = unreadCount.toString();
        mobileBadge.style.display = "inline-block";
      } else {
        mobileBadge.style.display = "none";
      }
    }
  }

  /**
   * Toggle panel visibility
   */
  private togglePanel(): void {
    if (this.isExpanded) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  /**
   * Open panel
   */
  private openPanel(): void {
    if (!this.panel) return;

    this.panel.style.display = "block";
    this.isExpanded = true;

    // Mark all updates as seen
    if (this.updates.length > 0) {
      const latestId = this.updates[0].id;
      this.markAsSeen(latestId);
      this.updateBadge();
    }
  }

  /**
   * Close panel
   */
  private closePanel(): void {
    if (!this.panel) return;

    this.panel.style.display = "none";
    this.isExpanded = false;
  }

  /**
   * Get last seen update ID from localStorage
   */
  private getLastSeenUpdate(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      log.warn("Failed to get last seen update:", error);
      return null;
    }
  }

  /**
   * Mark update as seen
   */
  private markAsSeen(updateId: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, updateId);
      this.lastSeenId = updateId;
      log.debug("Marked update as seen:", updateId);
    } catch (error) {
      log.error("Failed to mark update as seen:", error);
    }
  }

  /**
   * Check if update is newer than last seen
   */
  private isNewerThan(updateId: string, lastSeenId: string): boolean {
    const updateIndex = this.updates.findIndex(u => u.id === updateId);
    const lastSeenIndex = this.updates.findIndex(u => u.id === lastSeenId);

    // If last seen not found, all updates are new
    if (lastSeenIndex === -1) return true;

    // Newer updates have lower index (sorted newest first)
    return updateIndex < lastSeenIndex;
  }

  /**
   * Get icon for update type
   */
  private getTypeIcon(type?: string): string {
    switch (type) {
      case "feature": return "✨";
      case "bugfix": return "🐛";
      case "alert": return "⚠️";
      case "announcement": return "📢";
      default: return "📝";
    }
  }

  /**
   * Format date string
   */
  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
    });
  }

  /**
   * Dispose panel
   */
  dispose(): void {
    this.container.remove();
  }
}
