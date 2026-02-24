import { logger } from "../utils/logger.js";
import { settingsService } from "./settings.js";

const log = logger.create('Haptics');

/**
 * Haptic feedback patterns for different game events
 */
type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

/**
 * Service for managing haptic feedback on mobile devices
 *
 * Provides vibration feedback for various game interactions to enhance
 * the tactile experience on touch devices. Falls back gracefully on
 * devices that don't support the Vibration API.
 */
class HapticsService {
  private supported: boolean = false;
  private enabled: boolean = true;

  constructor() {
    // Check if Vibration API is supported
    this.supported = 'vibrate' in navigator;

    if (!this.supported) {
      log.info("Vibration API not supported on this device");
    } else {
      log.info("Haptic feedback initialized");
    }

    // Load enabled state from settings
    const settings = settingsService.getSettings();
    this.enabled = settings.haptics ?? true;
  }

  /**
   * Check if haptic feedback is supported on this device
   */
  isSupported(): boolean {
    return this.supported;
  }

  /**
   * Check if haptic feedback is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.supported;
  }

  /**
   * Enable or disable haptic feedback
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    // Update settings
    settingsService.updateHaptics(enabled);

    log.info(`Haptic feedback ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Trigger haptic feedback with a specific pattern
   * @param pattern - The type of haptic feedback to trigger
   */
  trigger(pattern: HapticPattern): void {
    if (!this.isEnabled()) {
      return;
    }

    let vibrationPattern: number | number[];

    switch (pattern) {
      case 'light':
        // Quick, subtle tap (10ms)
        vibrationPattern = 10;
        break;

      case 'medium':
        // Standard tap (20ms)
        vibrationPattern = 20;
        break;

      case 'heavy':
        // Strong tap (50ms)
        vibrationPattern = 50;
        break;

      case 'selection':
        // Very light tap for selections (5ms)
        vibrationPattern = 5;
        break;

      case 'success':
        // Two quick taps: vibrate, pause, vibrate
        vibrationPattern = [30, 50, 30];
        break;

      case 'warning':
        // Three short pulses
        vibrationPattern = [20, 40, 20, 40, 20];
        break;

      case 'error':
        // Long vibration
        vibrationPattern = 100;
        break;

      default:
        vibrationPattern = 10;
    }

    try {
      navigator.vibrate(vibrationPattern);
    } catch (error) {
      log.error("Failed to trigger vibration:", error);
    }
  }

  /**
   * Cancel any ongoing vibration
   */
  cancel(): void {
    if (this.supported) {
      navigator.vibrate(0);
    }
  }

  // Convenience methods for common game events

  /**
   * Haptic feedback for dice roll
   */
  roll(): void {
    this.trigger('heavy');
  }

  /**
   * Haptic feedback for dice selection/deselection
   */
  select(): void {
    this.trigger('selection');
  }

  /**
   * Haptic feedback for scoring dice
   */
  score(): void {
    this.trigger('success');
  }

  /**
   * Haptic feedback for game complete
   */
  gameComplete(): void {
    // Special pattern: two strong pulses
    if (!this.isEnabled()) return;

    try {
      navigator.vibrate([50, 100, 50]);
    } catch (error) {
      log.error("Failed to trigger game complete vibration:", error);
    }
  }

  /**
   * Haptic feedback for button press
   */
  buttonPress(): void {
    this.trigger('light');
  }

  /**
   * Haptic feedback for invalid action
   */
  invalid(): void {
    this.trigger('warning');
  }

  /**
   * Haptic feedback for errors
   */
  error(): void {
    this.trigger('error');
  }
}

// Export singleton instance
export const hapticsService = new HapticsService();
