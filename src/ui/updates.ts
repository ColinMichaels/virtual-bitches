/**
 * Updates Panel
 * Small blog section for game updates and notifications
 */

import { audioService } from "../services/audio.js";
import {
  getCommitUpdatesFeedUrlCandidates,
  getUpdatesFeedUrlCandidates,
} from "../services/assetUrl.js";
import { getLocalPlayerId } from "../services/playerIdentity.js";
import { logger } from "../utils/logger.js";
import type {
  MultiplayerGameUpdateMessage,
  MultiplayerPlayerNotificationMessage,
} from "../multiplayer/networkService.js";

const log = logger.create('UpdatesPanel');

const STORAGE_KEY = "biscuits-last-seen-update";
const FEED_AUTO_REFRESH_MS = 120000;

type UpdateSource = "release" | "commit" | "live";

interface GameUpdateCommitReference {
  hash: string;
  shortHash: string;
  url?: string;
  pullRequestNumber?: number;
  pullRequestUrl?: string;
}

export interface GameUpdate {
  id: string;
  date: string;
  title: string;
  content: string;
  version?: string;
  type?: "feature" | "bugfix" | "announcement" | "alert";
  source?: UpdateSource;
  commit?: GameUpdateCommitReference;
}

export interface UpdatesFeed {
  updates: GameUpdate[];
}

export class UpdatesPanel {
  private container: HTMLElement;
  private badge: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private updates: GameUpdate[] = [];
  private lastSeenId: string | null = null;
  private isExpanded = false;
  private lastSyncedAt: number | null = null;
  private isRefreshing = false;
  private refreshTimerId: number | null = null;
  private readonly localPlayerId = getLocalPlayerId();
  private readonly onDocumentClick = (e: MouseEvent) => {
    const targetNode = e.target;
    const targetElement = targetNode instanceof Element ? targetNode : null;

    if (
      this.isExpanded &&
      targetNode instanceof Node &&
      !this.container.contains(targetNode) &&
      !targetElement?.closest("#mobile-updates-btn, #updates-toggle-btn")
    ) {
      this.closePanel();
    }
  };
  private readonly onRealtimeUpdate = (event: Event) => {
    const payload = (event as CustomEvent<MultiplayerGameUpdateMessage>).detail;
    if (!payload) return;
    this.pushRealtimeUpdate(payload);
  };
  private readonly onRealtimeNotification = (event: Event) => {
    const payload = (event as CustomEvent<MultiplayerPlayerNotificationMessage>).detail;
    if (!payload) return;
    this.pushRealtimeNotification(payload);
  };
  private readonly onVisibilityChange = () => {
    if (!document.hidden) {
      void this.loadUpdates({ silent: true });
    }
  };

  constructor() {
    this.lastSeenId = this.getLastSeenUpdate();

    // Create updates panel container (button is now in index.html)
    this.container = document.createElement("div");
    this.container.id = "updates-container";
    this.container.className = "updates-container";
    this.container.innerHTML = `
      <div id="updates-panel" class="updates-panel" style="display: none;">
        <div class="updates-header">
          <div class="updates-header-meta">
            <h3>Game Updates</h3>
            <p id="updates-status" class="updates-status">Syncing release notes...</p>
          </div>
          <div class="updates-header-actions">
            <button id="updates-refresh-btn" class="updates-refresh-btn" title="Refresh">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
                <polyline points="21 3 21 9 15 9"></polyline>
              </svg>
            </button>
            <button id="updates-close-btn" class="updates-close-btn" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div id="updates-list" class="updates-list">
          <div class="updates-loading">Loading updates...</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.badge = document.querySelector(".updates-badge");
    this.panel = document.getElementById("updates-panel");
    this.statusEl = document.getElementById("updates-status");

    // Setup event handlers
    this.setupEventHandlers();
    this.setupRealtimeEventHandlers();
    this.startAutoRefresh();
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    // Load updates
    void this.loadUpdates({ silent: false });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    const toggleBtn = document.getElementById("updates-toggle-btn");
    const mobileToggleBtn = document.getElementById("mobile-updates-btn");
    const refreshBtn = document.getElementById("updates-refresh-btn");
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

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        void this.loadUpdates({ silent: false });
      });
    }

    // Close on outside click
    document.addEventListener("click", this.onDocumentClick);
  }

  private setupRealtimeEventHandlers(): void {
    document.addEventListener("multiplayer:update:received", this.onRealtimeUpdate as EventListener);
    document.addEventListener(
      "multiplayer:notification:received",
      this.onRealtimeNotification as EventListener
    );
  }

  private startAutoRefresh(): void {
    if (this.refreshTimerId !== null) {
      window.clearInterval(this.refreshTimerId);
      this.refreshTimerId = null;
    }

    this.refreshTimerId = window.setInterval(() => {
      if (document.hidden) {
        return;
      }
      void this.loadUpdates({ silent: true });
    }, FEED_AUTO_REFRESH_MS);
  }

  private setStatus(message: string): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.textContent = message;
  }

  /**
   * Load updates from release feed + commit-derived feed.
   */
  private async loadUpdates(options: { silent: boolean }): Promise<void> {
    if (this.isRefreshing) {
      return;
    }
    this.isRefreshing = true;

    if (!options.silent) {
      this.setStatus("Refreshing updates...");
    }

    try {
      const liveUpdates = this.updates.filter((update) => update.source === "live");
      const [releaseResult, commitResult] = await Promise.allSettled([
        this.fetchFeedUpdates(getUpdatesFeedUrlCandidates(), "release"),
        this.fetchFeedUpdates(getCommitUpdatesFeedUrlCandidates(), "commit"),
      ]);

      const fetchedUpdates: GameUpdate[] = [];
      let successfulFeeds = 0;

      if (releaseResult.status === "fulfilled") {
        fetchedUpdates.push(...releaseResult.value);
        successfulFeeds += 1;
      }
      if (commitResult.status === "fulfilled") {
        fetchedUpdates.push(...commitResult.value);
        successfulFeeds += 1;
      }

      if (successfulFeeds === 0) {
        const releaseError =
          releaseResult.status === "rejected" ? releaseResult.reason : null;
        const commitError =
          commitResult.status === "rejected" ? commitResult.reason : null;
        throw commitError ?? releaseError ?? new Error("updates_fetch_failed");
      }

      this.updates = this.mergeUpdates([...fetchedUpdates, ...liveUpdates]);
      this.lastSyncedAt = Date.now();
      if (this.isExpanded && this.updates.length > 0) {
        this.markAsSeen(this.updates[0].id);
      }

      this.renderUpdates();
      this.updateBadge();
      this.setStatus(
        `Updated ${this.formatDate(new Date(this.lastSyncedAt).toISOString())} • ${this.updates.length} entries`
      );

      log.debug(
        `Loaded ${this.updates.length} updates (release=${releaseResult.status === "fulfilled"}, commits=${commitResult.status === "fulfilled"})`
      );
    } catch (error) {
      log.error("Failed to load updates:", error);
      this.setStatus("Failed to refresh updates.");
      this.renderError();
    } finally {
      this.isRefreshing = false;
    }
  }

  private async fetchFeedUpdates(
    candidates: string[],
    source: Exclude<UpdateSource, "live">
  ): Promise<GameUpdate[]> {
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`updates_fetch_failed:${source}:${response.status}`);
        }

        const data = (await response.json()) as UpdatesFeed;
        const updates = Array.isArray(data?.updates) ? data.updates : [];
        return updates
          .map((update, index) =>
            this.normalizeIncomingUpdate(update, source, `${source}-${index}`)
          )
          .filter(Boolean) as GameUpdate[];
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error(`updates_fetch_failed:${source}`);
  }

  private normalizeIncomingUpdate(
    update: Partial<GameUpdate>,
    source: Exclude<UpdateSource, "live">,
    fallbackIdSeed: string
  ): GameUpdate | null {
    const title = typeof update.title === "string" ? update.title.trim() : "";
    const content = typeof update.content === "string" ? update.content.trim() : "";
    if (!title || !content) {
      return null;
    }

    const date =
      typeof update.date === "string" && !Number.isNaN(Date.parse(update.date))
        ? update.date
        : new Date().toISOString();

    const id =
      typeof update.id === "string" && update.id.trim()
        ? update.id.trim()
        : `${source}-${fallbackIdSeed}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      date,
      title,
      content,
      version: update.version,
      type: this.normalizeUpdateType(update.type as MultiplayerGameUpdateMessage["updateType"]),
      source,
      commit: this.normalizeCommitReference((update as { commit?: unknown }).commit),
    };
  }

  private mergeUpdates(updates: GameUpdate[]): GameUpdate[] {
    const deduped = new Map<string, GameUpdate>();
    updates.forEach((update) => {
      if (!update.id) {
        return;
      }
      const existing = deduped.get(update.id);
      if (!existing) {
        deduped.set(update.id, update);
        return;
      }

      const existingTime = Date.parse(existing.date);
      const nextTime = Date.parse(update.date);
      if (Number.isNaN(existingTime) || (!Number.isNaN(nextTime) && nextTime > existingTime)) {
        deduped.set(update.id, update);
      }
    });

    return Array.from(deduped.values()).sort((a, b) => {
      const left = Date.parse(a.date);
      const right = Date.parse(b.date);
      if (Number.isNaN(left) && Number.isNaN(right)) {
        return b.id.localeCompare(a.id);
      }
      if (Number.isNaN(left)) {
        return 1;
      }
      if (Number.isNaN(right)) {
        return -1;
      }
      return right - left;
    });
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
      const sourceLabel = this.getSourceLabel(update.source);
      const safeUpdateId = this.escapeHtml(update.id);
      const safeTitle = this.escapeHtml(update.title);
      const safeVersion = typeof update.version === "string" ? this.escapeHtml(update.version) : "";
      const linksHtml = this.renderUpdateLinks(update);

      return `
        <div class="update-item ${isNew ? 'update-new' : ''}" data-update-id="${safeUpdateId}">
          <div class="update-header">
            <div class="update-meta">
              <span class="update-icon">${typeIcon}</span>
              <span class="update-date">${formattedDate}</span>
              ${sourceLabel ? `<span class="update-source update-source-${update.source}">${sourceLabel}</span>` : ''}
              ${safeVersion ? `<span class="update-version">v${safeVersion}</span>` : ''}
              ${isNew ? '<span class="update-new-badge">NEW</span>' : ''}
            </div>
          </div>
          <h4 class="update-title">${safeTitle}</h4>
          <div class="update-content">${update.content}</div>
          ${linksHtml ? `<div class="update-links">${linksHtml}</div>` : ""}
        </div>
      `;
    }).join("");

    listContainer.innerHTML = html;
  }

  private renderUpdateLinks(update: GameUpdate): string {
    if (!update.commit) {
      return "";
    }

    const links: string[] = [];
    if (update.commit.url) {
      links.push(
        `<a class="update-link" href="${this.escapeHtml(
          update.commit.url
        )}" target="_blank" rel="noopener noreferrer">Commit ${this.escapeHtml(
          update.commit.shortHash
        )}</a>`
      );
    }

    if (update.commit.pullRequestUrl) {
      const prLabel =
        typeof update.commit.pullRequestNumber === "number"
          ? `PR #${update.commit.pullRequestNumber}`
          : "Pull Request";
      links.push(
        `<a class="update-link" href="${this.escapeHtml(
          update.commit.pullRequestUrl
        )}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(prLabel)}</a>`
      );
    }

    return links.join("");
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

  private pushRealtimeUpdate(payload: MultiplayerGameUpdateMessage): void {
    const title = payload.title.trim();
    const content = payload.content.trim();
    if (!title || !content) return;

    const timestamp = typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
    const generatedId = `ws-update-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const updateId = payload.id?.trim() || generatedId;
    if (this.updates.some((update) => update.id === updateId)) {
      return;
    }

    const normalizedType = this.normalizeUpdateType(payload.updateType);
    const safeContent = `<p>${this.escapeHtml(content)}</p>`;

    this.updates.unshift({
      id: updateId,
      date: this.normalizeDateInput(payload.date, timestamp),
      title,
      content: safeContent,
      version: payload.version,
      type: normalizedType,
      source: "live",
    });

    this.updates = this.mergeUpdates(this.updates);
    this.renderUpdates();
    this.updateBadge();

  }

  private pushRealtimeNotification(payload: MultiplayerPlayerNotificationMessage): void {
    if (payload.targetPlayerId && payload.targetPlayerId !== this.localPlayerId) {
      return;
    }

    const message = payload.message.trim();
    if (!message) return;

    const title = payload.title?.trim() || "Player Notification";

    const timestamp = typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
    const generatedId = `ws-note-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    const updateId = payload.id?.trim() || generatedId;
    if (this.updates.some((update) => update.id === updateId)) {
      return;
    }

    this.updates.unshift({
      id: updateId,
      date: new Date(timestamp).toISOString(),
      title,
      content: `<p>${this.escapeHtml(message)}</p>`,
      type: "alert",
      source: "live",
    });

    this.updates = this.mergeUpdates(this.updates);
    this.renderUpdates();
    this.updateBadge();
  }

  private normalizeUpdateType(
    updateType: MultiplayerGameUpdateMessage["updateType"]
  ): GameUpdate["type"] {
    switch (updateType) {
      case "feature":
      case "bugfix":
      case "announcement":
      case "alert":
        return updateType;
      default:
        return "announcement";
    }
  }

  private normalizeDateInput(dateInput: string | undefined, fallbackTimestamp: number): string {
    if (dateInput && !Number.isNaN(Date.parse(dateInput))) {
      return dateInput;
    }

    return new Date(fallbackTimestamp).toISOString();
  }

  private normalizeCommitReference(commit: unknown): GameUpdateCommitReference | undefined {
    if (!commit || typeof commit !== "object") {
      return undefined;
    }

    const candidate = commit as Partial<GameUpdateCommitReference>;
    const hash = typeof candidate.hash === "string" ? candidate.hash.trim() : "";
    const shortHash = typeof candidate.shortHash === "string" ? candidate.shortHash.trim() : "";
    if (!hash || !shortHash) {
      return undefined;
    }

    const normalized: GameUpdateCommitReference = {
      hash,
      shortHash,
    };

    const url = this.normalizeHttpUrl(candidate.url);
    if (url) {
      normalized.url = url;
    }

    if (Number.isFinite(candidate.pullRequestNumber as number)) {
      const prNumber = Math.max(1, Math.floor(candidate.pullRequestNumber as number));
      normalized.pullRequestNumber = prNumber;
    }

    const pullRequestUrl = this.normalizeHttpUrl(candidate.pullRequestUrl);
    if (pullRequestUrl) {
      normalized.pullRequestUrl = pullRequestUrl;
    }

    return normalized;
  }

  private normalizeHttpUrl(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return undefined;
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  private getSourceLabel(source?: UpdateSource): string {
    switch (source) {
      case "commit":
        return "Commit";
      case "release":
        return "Release";
      case "live":
        return "Live";
      default:
        return "";
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
    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    document.removeEventListener("multiplayer:update:received", this.onRealtimeUpdate as EventListener);
    document.removeEventListener(
      "multiplayer:notification:received",
      this.onRealtimeNotification as EventListener
    );
    if (this.refreshTimerId !== null) {
      window.clearInterval(this.refreshTimerId);
      this.refreshTimerId = null;
    }
    this.container.remove();
  }
}
