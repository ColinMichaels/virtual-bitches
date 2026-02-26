/**
 * Alpha Warning Modal
 * Displays one-time warning about pre-release status with image support
 */

import { audioService } from "../services/audio.js";
import { logger } from "../utils/logger.js";

const log = logger.create('AlphaWarning');

const STORAGE_KEY = "biscuits-alpha-seen";

export class AlphaWarningModal {
  private container: HTMLElement;
  private dontShowAgain = false;

  constructor() {
    // Create modal
    this.container = document.createElement("div");
    this.container.id = "alpha-warning-modal";
    this.container.className = "modal alpha-warning-modal";
    this.container.innerHTML = `
      <div class="modal-backdrop alpha-backdrop"></div>
      <div class="modal-content alpha-content">
        <div class="alpha-badge">⚠️ ALPHA RELEASE</div>

        <div class="alpha-hero">
          <img src="./alpha-banner.png" alt="Alpha Release" class="alpha-image"
               onerror="this.onerror=null; this.src='./alpha-warning.png';" />
        </div>

        <div class="alpha-body">
          <h2>Welcome to BISCUITS Alpha!</h2>
          <p class="alpha-subtitle">Pre-Beta Development Build</p>

          <div class="alpha-message">
            <p>
              Thank you for testing BISCUITS! This is an <strong>alpha pre-release</strong> version
              and is still under active development.
            </p>

            <div class="alpha-warnings">
              <div class="alpha-warning-item">
                <span class="alpha-icon">🐛</span>
                <span>You may encounter bugs or unexpected behavior</span>
              </div>
              <div class="alpha-warning-item">
                <span class="alpha-icon">💾</span>
                <span>Saved data may be reset between updates</span>
              </div>
              <div class="alpha-warning-item">
                <span class="alpha-icon">🚧</span>
                <span>Features are incomplete and subject to change</span>
              </div>
              <div class="alpha-warning-item">
                <span class="alpha-icon">📱</span>
                <span>Mobile experience is still being optimized</span>
              </div>
            </div>

            <p class="alpha-thanks">
              Your feedback helps make BISCUITS better! Please report any issues you encounter.
            </p>
          </div>

          <div class="alpha-checkbox">
            <label>
              <input type="checkbox" id="alpha-dont-show" />
              Don't show this again
            </label>
          </div>

          <div class="alpha-actions">
            <button id="alpha-accept-btn" class="primary">I Understand, Let's Play!</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for modal interactions
   */
  private setupEventHandlers(): void {
    const acceptBtn = document.getElementById("alpha-accept-btn");
    const dontShowCheckbox = document.getElementById("alpha-dont-show") as HTMLInputElement;

    if (acceptBtn) {
      acceptBtn.addEventListener("click", () => {
        audioService.playSfx("click");
        this.hide();
        if (this.dontShowAgain) {
          this.markAsSeen();
        }
      });
    }

    if (dontShowCheckbox) {
      dontShowCheckbox.addEventListener("change", (e) => {
        this.dontShowAgain = (e.target as HTMLInputElement).checked;
      });
    }

    // Allow ESC to close
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isVisible()) {
        this.hide();
        if (this.dontShowAgain) {
          this.markAsSeen();
        }
      }
    };
    document.addEventListener("keydown", escHandler);
  }

  /**
   * Check if user has seen the warning
   */
  static hasSeenWarning(): boolean {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      return seen === "true";
    } catch (error) {
      log.warn("Failed to check alpha warning status:", error);
      return false;
    }
  }

  /**
   * Mark warning as seen
   */
  private markAsSeen(): void {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
      log.debug("Alpha warning marked as seen");
    } catch (error) {
      log.error("Failed to save alpha warning status:", error);
    }
  }

  /**
   * Show the warning modal
   */
  show(): void {
    this.container.style.display = "flex";
    log.debug("Alpha warning displayed");
  }

  /**
   * Hide the warning modal
   */
  hide(): void {
    this.container.style.display = "none";
  }

  /**
   * Check if modal is visible
   */
  private isVisible(): boolean {
    return this.container.style.display === "flex";
  }

  /**
   * Reset warning (for testing)
   */
  static reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      log.debug("Alpha warning reset");
    } catch (error) {
      log.error("Failed to reset alpha warning:", error);
    }
  }

  /**
   * Dispose modal
   */
  dispose(): void {
    this.container.remove();
  }
}
