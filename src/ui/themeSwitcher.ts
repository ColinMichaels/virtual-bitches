/**
 * Theme Switcher UI Component
 * Displays available themes and allows switching between them
 */

import { themeManager } from "../services/themeManager.js";
import { audioService } from "../services/audio.js";

export class ThemeSwitcher {
  private container: HTMLElement;
  private unsubscribeTheme?: () => void;

  constructor() {
    this.container = document.createElement("div");
    this.container.className = "theme-switcher";

    // Initial render (may be empty if themes not loaded yet)
    this.render();

    // Subscribe to theme changes to update UI
    this.unsubscribeTheme = themeManager.onThemeChange(() => {
      this.render();
    });

    // Wait for theme manager to initialize, then render
    this.waitForThemes();
  }

  private async waitForThemes(): Promise<void> {
    // Wait a bit for themes to load if they haven't already
    let attempts = 0;
    while (attempts < 10 && themeManager.getAvailableThemes().length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    this.render();
  }

  /**
   * Render theme switcher UI as a compact dropdown
   */
  private render(): void {
    const currentTheme = themeManager.getCurrentTheme();
    const availableThemes = themeManager.getAvailableThemes();

    this.container.innerHTML = `
      <div class="theme-switcher-header">
        <h3>Dice Theme</h3>
      </div>
      <div class="theme-dropdown-container">
        ${availableThemes.length === 0
          ? '<p style="color: #999; font-size: 14px;">Loading themes...</p>'
          : `<select class="theme-dropdown" id="theme-dropdown">
              ${availableThemes
                .map(
                  ({ name, config }) => `
                <option value="${name}" ${name === currentTheme ? 'selected' : ''}>
                  ${config.name} - by ${config.author}
                </option>
              `
                )
                .join("")}
            </select>`
        }
      </div>
    `;

    // Attach change handler
    const dropdown = this.container.querySelector("#theme-dropdown");
    if (dropdown) {
      dropdown.addEventListener("change", (e) => {
        const themeName = (e.target as HTMLSelectElement).value;
        if (themeName) {
          audioService.playSfx("click");
          themeManager.setTheme(themeName);
        }
      });
    }
  }

  /**
   * Get the container element
   */
  getElement(): HTMLElement {
    return this.container;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.unsubscribeTheme?.();
    this.container.remove();
  }
}
