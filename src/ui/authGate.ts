import { audioService } from "../services/audio.js";
import { modalManager } from "./modalManager.js";

export type AuthGateChoice = "google" | "guest" | "cancel";

export class AuthGateModal {
  private readonly container: HTMLElement;
  private resolver: ((choice: AuthGateChoice) => void) | null = null;

  constructor() {
    this.container = this.createModal();
    document.body.appendChild(this.container);
    modalManager.register({
      id: "auth-gate-modal",
      close: () => this.resolve("cancel"),
    });
  }

  async prompt(): Promise<AuthGateChoice> {
    if (this.resolver) {
      return "cancel";
    }

    modalManager.requestOpen("auth-gate-modal");
    this.container.style.display = "flex";
    return new Promise<AuthGateChoice>((resolve) => {
      this.resolver = resolve;
    });
  }

  dispose(): void {
    this.resolve("cancel");
    modalManager.notifyClosed("auth-gate-modal");
    this.container.remove();
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "auth-gate-modal";
    modal.className = "modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content auth-gate-modal-content">
        <div class="modal-header">
          <h2>Choose Play Mode</h2>
          <button class="modal-close" title="Close">&times;</button>
        </div>
        <div class="auth-gate-content">
          <p>Sign in to compete on the global leaderboard and save your player name.</p>
          <p>You can also continue as Guest and play without leaderboard posting.</p>
          <div class="auth-gate-actions">
            <button class="btn btn-primary btn-auth-google">Continue with Google</button>
            <button class="btn btn-secondary btn-auth-guest">Play as Guest</button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      this.resolve("cancel");
    });
    modal.querySelector(".modal-close")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve("cancel");
    });
    modal.querySelector(".btn-auth-google")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve("google");
    });
    modal.querySelector(".btn-auth-guest")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve("guest");
    });

    return modal;
  }

  private resolve(choice: AuthGateChoice): void {
    if (this.container.style.display !== "none") {
      modalManager.notifyClosed("auth-gate-modal");
    }
    this.container.style.display = "none";
    const current = this.resolver;
    this.resolver = null;
    current?.(choice);
  }
}
