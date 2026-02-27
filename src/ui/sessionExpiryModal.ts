import { audioService } from "../services/audio.js";
import { modalManager } from "./modalManager.js";

export type SessionExpiryChoice = "lobby" | "solo";

export class SessionExpiryModal {
  private readonly container: HTMLElement;
  private resolver: ((choice: SessionExpiryChoice) => void) | null = null;

  constructor() {
    this.container = this.createModal();
    document.body.appendChild(this.container);
    modalManager.register({
      id: "session-expiry-modal",
      close: () => this.resolve("solo"),
    });
  }

  async prompt(reason?: string): Promise<SessionExpiryChoice> {
    if (this.resolver) {
      return "solo";
    }

    const reasonText = this.container.querySelector<HTMLElement>("[data-session-expiry-reason]");
    if (reasonText) {
      reasonText.textContent = this.formatReason(reason);
    }

    modalManager.requestOpen("session-expiry-modal");
    this.container.style.display = "flex";
    return new Promise<SessionExpiryChoice>((resolve) => {
      this.resolver = resolve;
    });
  }

  dispose(): void {
    this.resolve("solo");
    modalManager.notifyClosed("session-expiry-modal");
    this.container.remove();
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "session-expiry-modal";
    modal.className = "modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content confirm-modal-content session-expiry-modal-content">
        <div class="modal-header">
          <h2>Room Expired</h2>
          <button class="modal-close" title="Close">&times;</button>
        </div>
        <div class="session-expiry-content confirm-modal-body">
          <p class="confirm-modal-message">This multiplayer room expired or became inactive.</p>
          <p class="confirm-modal-message" data-session-expiry-reason></p>
          <p class="confirm-modal-message">You can return to the lobby to join/create another room, or continue solo immediately.</p>
          <div class="session-expiry-actions confirm-modal-actions">
            <button class="btn btn-primary primary btn-session-lobby">Return to Lobby</button>
            <button class="btn btn-secondary secondary btn-session-solo">Continue Solo</button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      this.resolve("solo");
    });
    modal.querySelector(".modal-close")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve("solo");
    });
    modal.querySelector(".btn-session-lobby")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve("lobby");
    });
    modal.querySelector(".btn-session-solo")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve("solo");
    });

    return modal;
  }

  private formatReason(reason?: string): string {
    const safeReason = typeof reason === "string" ? reason.trim() : "";
    if (!safeReason) {
      return "Reason: session timeout.";
    }
    return `Reason: ${safeReason.replace(/_/g, " ")}.`;
  }

  private resolve(choice: SessionExpiryChoice): void {
    if (this.container.style.display !== "none") {
      modalManager.notifyClosed("session-expiry-modal");
    }
    this.container.style.display = "none";
    const current = this.resolver;
    this.resolver = null;
    current?.(choice);
  }
}
