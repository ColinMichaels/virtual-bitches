import type { MultiplayerRoomChannelMessage } from "../multiplayer/networkService.js";

type ChatSeverity = "info" | "success" | "warning" | "error";
type ChatThreadKind = "public" | "direct";

export interface MultiplayerChatParticipant {
  playerId: string;
  label: string;
  isBot: boolean;
  isSeated: boolean;
}

interface MultiplayerChatThread {
  id: string;
  kind: ChatThreadKind;
  participantId?: string;
  label: string;
  unreadCount: number;
  lastMessageAt: number;
  messages: MultiplayerChatMessageEntry[];
}

interface MultiplayerChatMessageEntry {
  id: string;
  channel: ChatThreadKind;
  topic?: string;
  message: string;
  senderId?: string;
  senderLabel: string;
  severity: ChatSeverity;
  timestamp: number;
  outgoing: boolean;
}

export interface MultiplayerChatPanelOptions {
  localPlayerId: string;
  onSendPublic: (message: string) => MultiplayerRoomChannelMessage | null;
  onSendWhisper: (
    targetPlayerId: string,
    message: string
  ) => MultiplayerRoomChannelMessage | null;
  onInfo?: (message: string, severity?: ChatSeverity) => void;
  onUnreadCountChange?: (count: number) => void;
  onVisibilityChange?: (isOpen: boolean) => void;
}

const PUBLIC_THREAD_ID = "public";
const MAX_MESSAGES_PER_THREAD = 120;

function normalizeSeverity(value: unknown): ChatSeverity {
  return value === "success" || value === "warning" || value === "error"
    ? value
    : "info";
}

function normalizeIncomingMessage(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOutgoingMessage(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 320);
}

function formatMessageTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "--:--";
  }
}

function buildDirectThreadId(playerId: string): string {
  return `direct:${playerId}`;
}

function parseDirectThreadPlayerId(threadId: string): string | null {
  if (!threadId.startsWith("direct:")) {
    return null;
  }
  const playerId = threadId.slice("direct:".length).trim();
  return playerId || null;
}

export class MultiplayerChatPanel {
  private readonly options: MultiplayerChatPanelOptions;
  private localPlayerId: string;

  private readonly participantsById = new Map<string, MultiplayerChatParticipant>();
  private readonly threadsById = new Map<string, MultiplayerChatThread>();
  private threadOrder: string[] = [PUBLIC_THREAD_ID];
  private activeThreadId = PUBLIC_THREAD_ID;
  private sessionId: string | null = null;
  private roomCode: string | null = null;
  private connected = false;

  private modalEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private tabsEl: HTMLElement | null = null;
  private feedEl: HTMLElement | null = null;
  private composeFormEl: HTMLFormElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtnEl: HTMLButtonElement | null = null;
  private whisperSelectEl: HTMLSelectElement | null = null;
  private whisperOpenBtnEl: HTMLButtonElement | null = null;

  constructor(options: MultiplayerChatPanelOptions) {
    this.options = options;
    this.localPlayerId = options.localPlayerId;
    this.threadsById.set(PUBLIC_THREAD_ID, this.createPublicThread());
    this.ensureModal();
    this.renderAll();
    this.emitUnreadCountChange();
  }

  setLocalPlayerId(playerId: string): void {
    const normalized = typeof playerId === "string" ? playerId.trim() : "";
    if (!normalized || normalized === this.localPlayerId) {
      return;
    }
    this.localPlayerId = normalized;
  }

  setSessionContext(sessionId: string | null, roomCode?: string | null): void {
    const normalizedSessionId =
      typeof sessionId === "string" && sessionId.trim().length > 0
        ? sessionId.trim()
        : null;
    const hasSessionChanged = normalizedSessionId !== this.sessionId;
    this.sessionId = normalizedSessionId;
    this.roomCode =
      typeof roomCode === "string" && roomCode.trim().length > 0
        ? roomCode.trim().toUpperCase()
        : null;
    if (hasSessionChanged) {
      this.resetThreads();
    }
    this.renderAll();
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.renderStatus();
    this.renderComposerState();
  }

  setParticipants(participants: MultiplayerChatParticipant[]): void {
    this.participantsById.clear();
    participants.forEach((participant) => {
      if (!participant || typeof participant.playerId !== "string") {
        return;
      }
      const playerId = participant.playerId.trim();
      if (!playerId || playerId === this.localPlayerId) {
        return;
      }
      const label =
        typeof participant.label === "string" && participant.label.trim().length > 0
          ? participant.label.trim().slice(0, 24)
          : `Player ${playerId.slice(0, 4)}`;
      this.participantsById.set(playerId, {
        playerId,
        label,
        isBot: participant.isBot === true,
        isSeated: participant.isSeated === true,
      });
    });
    this.syncDirectThreadLabels();
    this.renderTabs();
    this.renderWhisperPicker();
  }

  openRoom(): void {
    this.setActiveThread(PUBLIC_THREAD_ID);
    this.open();
  }

  openWhisper(targetPlayerId?: string): void {
    if (typeof targetPlayerId === "string" && targetPlayerId.trim().length > 0) {
      const participant = this.participantsById.get(targetPlayerId.trim());
      if (!participant) {
        this.options.onInfo?.("That player is not in this room right now.", "warning");
        return;
      }
      if (participant.isBot) {
        this.options.onInfo?.("Bots cannot receive whispers yet.", "info");
        return;
      }
      this.ensureDirectThread(targetPlayerId.trim(), participant.label);
      this.setActiveThread(buildDirectThreadId(targetPlayerId.trim()));
      this.open();
      return;
    }

    const whisperTargets = Array.from(this.participantsById.values()).filter(
      (participant) => !participant.isBot
    );
    if (whisperTargets.length === 0) {
      this.options.onInfo?.("No players available to whisper.", "info");
      return;
    }

    const fallback = whisperTargets[0];
    this.ensureDirectThread(fallback.playerId, fallback.label);
    this.setActiveThread(buildDirectThreadId(fallback.playerId));
    this.open();
  }

  open(): void {
    const modal = this.ensureModal();
    if (!modal) {
      return;
    }
    modal.style.display = "flex";
    this.renderAll();
    this.inputEl?.focus();
    this.options.onVisibilityChange?.(true);
  }

  close(): void {
    if (!this.modalEl) {
      return;
    }
    this.modalEl.style.display = "none";
    this.options.onVisibilityChange?.(false);
  }

  isOpen(): boolean {
    return this.modalEl?.style.display === "flex";
  }

  clear(): void {
    this.close();
    this.sessionId = null;
    this.roomCode = null;
    this.connected = false;
    this.participantsById.clear();
    this.resetThreads();
    this.renderAll();
  }

  appendIncomingChannelMessage(payload: MultiplayerRoomChannelMessage): void {
    this.appendChannelMessage(payload, false);
  }

  appendOutgoingChannelMessage(payload: MultiplayerRoomChannelMessage): void {
    this.appendChannelMessage(payload, true);
  }

  private createPublicThread(): MultiplayerChatThread {
    return {
      id: PUBLIC_THREAD_ID,
      kind: "public",
      label: "Room",
      unreadCount: 0,
      lastMessageAt: 0,
      messages: [],
    };
  }

  private resetThreads(): void {
    this.threadsById.clear();
    this.threadsById.set(PUBLIC_THREAD_ID, this.createPublicThread());
    this.threadOrder = [PUBLIC_THREAD_ID];
    this.activeThreadId = PUBLIC_THREAD_ID;
    this.emitUnreadCountChange();
  }

  private appendChannelMessage(
    payload: MultiplayerRoomChannelMessage,
    outgoing: boolean
  ): void {
    const channel: ChatThreadKind = payload.channel === "direct" ? "direct" : "public";
    const message = normalizeIncomingMessage(payload.message);
    if (!message) {
      return;
    }

    const sourcePlayerId =
      typeof payload.sourcePlayerId === "string" ? payload.sourcePlayerId.trim() : "";
    const fallbackPlayerId =
      typeof payload.playerId === "string" ? payload.playerId.trim() : "";
    const senderId = sourcePlayerId || fallbackPlayerId || undefined;
    const targetPlayerId =
      typeof payload.targetPlayerId === "string" ? payload.targetPlayerId.trim() : "";
    const timestamp =
      typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
        ? Math.floor(payload.timestamp)
        : Date.now();
    const severity = normalizeSeverity(payload.severity);
    const topic =
      typeof payload.topic === "string" && payload.topic.trim().length > 0
        ? payload.topic.trim().toLowerCase()
        : undefined;

    let threadId = PUBLIC_THREAD_ID;
    if (channel === "direct") {
      const counterpartId = outgoing
        ? targetPlayerId
        : senderId && senderId !== this.localPlayerId
          ? senderId
          : targetPlayerId && targetPlayerId !== this.localPlayerId
            ? targetPlayerId
            : "";
      if (!counterpartId) {
        return;
      }
      const counterpartLabel = this.resolveParticipantLabel(counterpartId);
      threadId = this.ensureDirectThread(counterpartId, counterpartLabel).id;
    }

    const senderLabel = outgoing
      ? "You"
      : this.resolveSenderLabel(senderId, payload.title, payload.sourceRole);
    const entry: MultiplayerChatMessageEntry = {
      id:
        typeof payload.id === "string" && payload.id.trim().length > 0
          ? payload.id.trim()
          : `${threadId}:${timestamp}:${Math.random().toString(36).slice(2, 8)}`,
      channel,
      topic,
      message,
      senderId,
      senderLabel,
      severity,
      timestamp,
      outgoing,
    };

    const thread = this.threadsById.get(threadId);
    if (!thread) {
      return;
    }
    thread.messages.push(entry);
    if (thread.messages.length > MAX_MESSAGES_PER_THREAD) {
      thread.messages.splice(0, thread.messages.length - MAX_MESSAGES_PER_THREAD);
    }
    thread.lastMessageAt = Math.max(thread.lastMessageAt, timestamp);
    if (thread.id !== this.activeThreadId) {
      thread.unreadCount += 1;
    }
    this.recomputeThreadOrder();
    this.renderTabs();
    this.renderFeed();
    this.emitUnreadCountChange();
  }

  private resolveSenderLabel(
    senderId: string | undefined,
    fallbackTitle: string | undefined,
    sourceRole: string | undefined
  ): string {
    if (senderId && senderId === this.localPlayerId) {
      return "You";
    }
    if (senderId) {
      return this.resolveParticipantLabel(senderId);
    }
    if (typeof fallbackTitle === "string" && fallbackTitle.trim().length > 0) {
      return fallbackTitle.trim().slice(0, 24);
    }
    if (sourceRole === "system" || sourceRole === "service" || sourceRole === "admin") {
      return "System";
    }
    return "Room";
  }

  private resolveParticipantLabel(playerId: string): string {
    const participant = this.participantsById.get(playerId);
    if (participant?.label) {
      return participant.label;
    }
    return `Player ${playerId.slice(0, 4)}`;
  }

  private ensureDirectThread(playerId: string, label: string): MultiplayerChatThread {
    const threadId = buildDirectThreadId(playerId);
    const existing = this.threadsById.get(threadId);
    if (existing) {
      existing.label = label;
      existing.participantId = playerId;
      return existing;
    }

    const created: MultiplayerChatThread = {
      id: threadId,
      kind: "direct",
      participantId: playerId,
      label,
      unreadCount: 0,
      lastMessageAt: 0,
      messages: [],
    };
    this.threadsById.set(threadId, created);
    this.recomputeThreadOrder();
    return created;
  }

  private recomputeThreadOrder(): void {
    const directThreads = Array.from(this.threadsById.values())
      .filter((thread) => thread.kind === "direct")
      .sort((left, right) => right.lastMessageAt - left.lastMessageAt);
    this.threadOrder = [
      PUBLIC_THREAD_ID,
      ...directThreads.map((thread) => thread.id),
    ];
  }

  private syncDirectThreadLabels(): void {
    this.threadsById.forEach((thread) => {
      if (thread.kind !== "direct") {
        return;
      }
      const participantId = thread.participantId ?? parseDirectThreadPlayerId(thread.id);
      if (!participantId) {
        return;
      }
      thread.participantId = participantId;
      thread.label = this.resolveParticipantLabel(participantId);
    });
  }

  private setActiveThread(threadId: string): void {
    if (!this.threadsById.has(threadId)) {
      return;
    }
    this.activeThreadId = threadId;
    const thread = this.threadsById.get(threadId);
    if (thread) {
      thread.unreadCount = 0;
    }
    this.renderTabs();
    this.renderFeed();
    this.renderComposerState();
    this.emitUnreadCountChange();
  }

  private getTotalUnreadCount(): number {
    let total = 0;
    this.threadsById.forEach((thread) => {
      total += Math.max(0, Math.floor(thread.unreadCount));
    });
    return total;
  }

  private emitUnreadCountChange(): void {
    this.options.onUnreadCountChange?.(this.getTotalUnreadCount());
  }

  private ensureModal(): HTMLElement | null {
    if (this.modalEl) {
      return this.modalEl;
    }

    const existing = document.getElementById("multiplayer-chat-modal");
    if (existing) {
      this.modalEl = existing;
      this.bindExistingElements(existing);
      return existing;
    }

    const modal = document.createElement("div");
    modal.id = "multiplayer-chat-modal";
    modal.className = "modal multiplayer-chat-modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content multiplayer-chat-modal-content">
        <div class="modal-header multiplayer-chat-modal-header">
          <h2>Room Chat</h2>
          <button class="modal-close multiplayer-chat-close" title="Close (ESC)">&times;</button>
        </div>
        <p class="multiplayer-chat-status"></p>
        <div class="multiplayer-chat-tabs" role="tablist" aria-label="Chat channels"></div>
        <div class="multiplayer-chat-feed" aria-live="polite"></div>
        <form class="multiplayer-chat-compose">
          <div class="multiplayer-chat-whisper-picker">
            <select class="multiplayer-chat-whisper-select" aria-label="Choose whisper target"></select>
            <button type="button" class="btn btn-outline multiplayer-chat-whisper-open">Open Whisper</button>
          </div>
          <textarea class="multiplayer-chat-input" rows="2" maxlength="320" placeholder="Type a message..."></textarea>
          <div class="multiplayer-chat-compose-actions">
            <button type="submit" class="btn btn-primary multiplayer-chat-send">Send</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;
    this.bindExistingElements(modal);
    return modal;
  }

  private bindExistingElements(root: HTMLElement): void {
    this.statusEl = root.querySelector(".multiplayer-chat-status");
    this.tabsEl = root.querySelector(".multiplayer-chat-tabs");
    this.feedEl = root.querySelector(".multiplayer-chat-feed");
    this.composeFormEl = root.querySelector(".multiplayer-chat-compose");
    this.inputEl = root.querySelector(".multiplayer-chat-input");
    this.sendBtnEl = root.querySelector(".multiplayer-chat-send");
    this.whisperSelectEl = root.querySelector(".multiplayer-chat-whisper-select");
    this.whisperOpenBtnEl = root.querySelector(".multiplayer-chat-whisper-open");

    root.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      this.close();
    });
    root.querySelector(".multiplayer-chat-close")?.addEventListener("click", () => {
      this.close();
    });

    this.tabsEl?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>(".multiplayer-chat-tab");
      const threadId = button?.dataset.threadId ?? "";
      if (!threadId) {
        return;
      }
      this.setActiveThread(threadId);
    });

    this.whisperOpenBtnEl?.addEventListener("click", () => {
      const targetId = this.whisperSelectEl?.value ?? "";
      if (!targetId) {
        this.options.onInfo?.("Choose a player to whisper.", "info");
        return;
      }
      this.openWhisper(targetId);
    });

    this.inputEl?.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      event.preventDefault();
      this.composeFormEl?.requestSubmit();
    });
    this.inputEl?.addEventListener("input", () => {
      this.renderComposerState();
    });

    this.composeFormEl?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleSubmitMessage();
    });
  }

  private handleSubmitMessage(): void {
    const input = this.inputEl;
    if (!input) {
      return;
    }
    const normalized = normalizeOutgoingMessage(input.value);
    if (!normalized) {
      return;
    }

    if (!this.sessionId) {
      this.options.onInfo?.("Join a multiplayer room to chat.", "warning");
      return;
    }
    if (!this.connected) {
      this.options.onInfo?.("Reconnect to room chat before sending.", "warning");
      return;
    }

    const thread = this.threadsById.get(this.activeThreadId);
    if (!thread) {
      return;
    }

    let sentPayload: MultiplayerRoomChannelMessage | null = null;
    if (thread.kind === "public") {
      sentPayload = this.options.onSendPublic(normalized);
    } else if (thread.participantId) {
      sentPayload = this.options.onSendWhisper(thread.participantId, normalized);
    }

    if (!sentPayload) {
      this.options.onInfo?.("Unable to send message right now.", "warning");
      return;
    }

    this.appendOutgoingChannelMessage(sentPayload);
    input.value = "";
    this.renderComposerState();
  }

  private renderAll(): void {
    this.renderStatus();
    this.renderTabs();
    this.renderFeed();
    this.renderWhisperPicker();
    this.renderComposerState();
  }

  private renderStatus(): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.classList.remove("is-online", "is-offline");
    if (!this.sessionId) {
      this.statusEl.textContent = "Join a multiplayer room to chat.";
      this.statusEl.classList.add("is-offline");
      return;
    }
    if (!this.connected) {
      this.statusEl.textContent = "Reconnecting to room chat...";
      this.statusEl.classList.add("is-offline");
      return;
    }
    const roomLabel = this.roomCode ? `Room ${this.roomCode}` : "Room connected";
    this.statusEl.textContent = `${roomLabel} chat is live.`;
    this.statusEl.classList.add("is-online");
  }

  private renderTabs(): void {
    const tabsEl = this.tabsEl;
    if (!tabsEl) {
      return;
    }
    tabsEl.innerHTML = "";

    const fragment = document.createDocumentFragment();
    this.threadOrder.forEach((threadId) => {
      const thread = this.threadsById.get(threadId);
      if (!thread) {
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "multiplayer-chat-tab";
      if (threadId === this.activeThreadId) {
        button.classList.add("is-active");
      }
      if (thread.kind === "direct") {
        button.classList.add("is-direct");
      }
      button.dataset.threadId = thread.id;

      const label = document.createElement("span");
      label.className = "multiplayer-chat-tab-label";
      label.textContent = thread.kind === "public" ? "Room" : thread.label;
      button.appendChild(label);

      if (thread.unreadCount > 0) {
        const badge = document.createElement("span");
        badge.className = "multiplayer-chat-tab-badge";
        badge.textContent = thread.unreadCount > 9 ? "9+" : String(thread.unreadCount);
        button.appendChild(badge);
      }

      fragment.appendChild(button);
    });

    tabsEl.appendChild(fragment);
  }

  private renderFeed(): void {
    const feedEl = this.feedEl;
    if (!feedEl) {
      return;
    }
    feedEl.innerHTML = "";

    const thread = this.threadsById.get(this.activeThreadId);
    if (!thread || thread.messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "multiplayer-chat-empty";
      empty.textContent =
        thread?.kind === "direct"
          ? "No whispers yet. Say hello."
          : "No room messages yet. Break the silence.";
      feedEl.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    thread.messages.forEach((entry) => {
      const row = document.createElement("article");
      row.className = "multiplayer-chat-message";
      row.classList.add(entry.outgoing ? "is-outgoing" : "is-incoming");
      row.classList.add(`tone-${entry.severity}`);

      const meta = document.createElement("header");
      meta.className = "multiplayer-chat-message-meta";
      const sender = document.createElement("span");
      sender.className = "multiplayer-chat-message-sender";
      sender.textContent = entry.senderLabel;
      const time = document.createElement("time");
      time.className = "multiplayer-chat-message-time";
      time.textContent = formatMessageTimestamp(entry.timestamp);
      meta.append(sender, time);

      const body = document.createElement("p");
      body.className = "multiplayer-chat-message-body";
      body.textContent = entry.message;

      row.append(meta, body);
      fragment.appendChild(row);
    });

    feedEl.appendChild(fragment);
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  private renderWhisperPicker(): void {
    const select = this.whisperSelectEl;
    const openBtn = this.whisperOpenBtnEl;
    if (!select || !openBtn) {
      return;
    }

    const whisperTargets = Array.from(this.participantsById.values()).filter(
      (participant) => !participant.isBot
    );
    const previousValue = select.value;
    select.innerHTML = "";

    if (whisperTargets.length === 0) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No whisper targets";
      select.appendChild(empty);
      select.disabled = true;
      openBtn.disabled = true;
      return;
    }

    whisperTargets.forEach((participant) => {
      const option = document.createElement("option");
      option.value = participant.playerId;
      const seatStatus = participant.isSeated ? "seated" : "standing";
      option.textContent = `${participant.label} (${seatStatus})`;
      select.appendChild(option);
    });

    if (previousValue && whisperTargets.some((participant) => participant.playerId === previousValue)) {
      select.value = previousValue;
    }
    select.disabled = false;
    openBtn.disabled = false;
  }

  private renderComposerState(): void {
    const input = this.inputEl;
    const sendBtn = this.sendBtnEl;
    if (!input || !sendBtn) {
      return;
    }

    const activeThread = this.threadsById.get(this.activeThreadId);
    const canSend = Boolean(this.sessionId) && this.connected;
    const isDirect = activeThread?.kind === "direct";
    const directLabel =
      isDirect && activeThread
        ? this.resolveParticipantLabel(activeThread.participantId ?? "")
        : "";

    if (isDirect && directLabel) {
      input.placeholder = `Whisper to ${directLabel}...`;
    } else {
      input.placeholder = "Send a room message...";
    }
    input.disabled = !canSend;
    sendBtn.disabled = !canSend || normalizeOutgoingMessage(input.value).length === 0;
    input.setAttribute("aria-label", isDirect ? "Whisper message" : "Room message");
  }
}
