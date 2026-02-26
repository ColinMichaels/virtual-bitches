import { audioService } from "../services/audio.js";

export type ConfirmModalTone = "primary" | "danger";

export interface ConfirmModalOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmModalTone;
}

interface PendingConfirmRequest {
  options: ConfirmModalOptions;
  resolve: (confirmed: boolean) => void;
}

export class ConfirmModal {
  private readonly container: HTMLElement;
  private readonly titleEl: HTMLElement | null;
  private readonly messageEl: HTMLElement | null;
  private readonly confirmBtn: HTMLButtonElement | null;
  private readonly cancelBtn: HTMLButtonElement | null;
  private resolver: ((confirmed: boolean) => void) | null = null;
  private readonly queue: PendingConfirmRequest[] = [];

  constructor() {
    this.container = this.createModal();
    this.titleEl = this.container.querySelector<HTMLElement>("[data-confirm-title]");
    this.messageEl = this.container.querySelector<HTMLElement>("[data-confirm-message]");
    this.confirmBtn = this.container.querySelector<HTMLButtonElement>(".btn-confirm-accept");
    this.cancelBtn = this.container.querySelector<HTMLButtonElement>(".btn-confirm-cancel");
    document.body.appendChild(this.container);
    document.addEventListener("keydown", this.onKeyDown);
  }

  prompt(options: ConfirmModalOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.queue.push({ options, resolve });
      this.drainQueue();
    });
  }

  dispose(): void {
    while (this.queue.length > 0) {
      this.queue.shift()?.resolve(false);
    }
    this.resolve(false);
    document.removeEventListener("keydown", this.onKeyDown);
    this.container.remove();
  }

  private createModal(): HTMLElement {
    const modal = document.createElement("div");
    modal.id = "confirm-modal";
    modal.className = "modal";
    modal.style.display = "none";
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content confirm-modal-content">
        <div class="modal-header">
          <h2 data-confirm-title>Confirm Action</h2>
          <button class="modal-close" title="Close">&times;</button>
        </div>
        <div class="confirm-modal-body">
          <p class="confirm-modal-message" data-confirm-message></p>
          <div class="confirm-modal-actions">
            <button class="btn-confirm-cancel">Cancel</button>
            <button class="btn-confirm-accept">Confirm</button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      this.resolve(false);
    });
    modal.querySelector(".modal-close")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve(false);
    });
    modal.querySelector(".btn-confirm-cancel")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve(false);
    });
    modal.querySelector(".btn-confirm-accept")?.addEventListener("click", () => {
      audioService.playSfx("click");
      this.resolve(true);
    });

    return modal;
  }

  private drainQueue(): void {
    if (this.resolver || this.queue.length === 0) {
      return;
    }
    const pending = this.queue.shift();
    if (!pending) {
      return;
    }

    const options = pending.options;
    this.titleEl!.textContent = options.title?.trim() || "Confirm Action";
    this.messageEl!.textContent = options.message?.trim() || "Are you sure you want to continue?";
    this.cancelBtn!.textContent = options.cancelLabel?.trim() || "Cancel";
    this.confirmBtn!.textContent = options.confirmLabel?.trim() || "Confirm";
    this.confirmBtn!.classList.toggle("is-danger", options.tone === "danger");

    this.container.style.display = "flex";
    this.resolver = pending.resolve;
    this.confirmBtn?.focus();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.container.style.display !== "flex" || !this.resolver) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.resolve(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.resolve(true);
    }
  };

  private resolve(confirmed: boolean): void {
    this.container.style.display = "none";
    const current = this.resolver;
    this.resolver = null;
    current?.(confirmed);
    this.drainQueue();
  }
}

let singleton: ConfirmModal | null = null;

export function confirmAction(options: ConfirmModalOptions): Promise<boolean> {
  if (!singleton) {
    singleton = new ConfirmModal();
  }
  return singleton.prompt(options);
}
