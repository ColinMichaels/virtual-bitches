import { logger } from "../utils/logger.js";
import { gameBrand } from "../config/brand.js";

const log = logger.create('PWA');

/**
 * PWA Service
 * Handles service worker registration and install prompts
 */
class PWAService {
  private deferredPrompt: any = null;
  private installed: boolean = false;

  constructor() {
    this.init();
  }

  /**
   * Initialize PWA features
   */
  private async init(): Promise<void> {
    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        log.info('Service Worker registered:', registration);
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          window.location.reload();
        });

        // Check for updates periodically
        setInterval(() => {
          registration.update();
        }, 60 * 60 * 1000); // Check every hour

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                log.info('New service worker available');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });

      } catch (error) {
        log.error('Service Worker registration failed:', error);
      }
    } else {
      log.warn('Service Workers not supported');
    }

    // Listen for install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      log.info('Install prompt available');
      // Prevent the default prompt
      e.preventDefault();
      // Store the event for later use
      this.deferredPrompt = e;
      // Show custom install UI
      this.showInstallPrompt();
    });

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      log.info('App installed successfully');
      this.installed = true;
      this.deferredPrompt = null;
    });

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      log.info('App running in standalone mode');
      this.installed = true;
    }
  }

  /**
   * Check if app is installed
   */
  isInstalled(): boolean {
    return this.installed;
  }

  /**
   * Check if install prompt is available
   */
  canInstall(): boolean {
    return this.deferredPrompt !== null;
  }

  /**
   * Trigger install prompt
   */
  async install(): Promise<boolean> {
    if (!this.deferredPrompt) {
      log.warn('Install prompt not available');
      return false;
    }

    try {
      // Show the install prompt
      this.deferredPrompt.prompt();

      // Wait for the user's response
      const choiceResult = await this.deferredPrompt.userChoice;

      log.info('Install prompt result:', choiceResult.outcome);

      if (choiceResult.outcome === 'accepted') {
        log.info('User accepted the install prompt');
        return true;
      } else {
        log.info('User dismissed the install prompt');
        return false;
      }
    } catch (error) {
      log.error('Install prompt error:', error);
      return false;
    } finally {
      // Clear the deferred prompt
      this.deferredPrompt = null;
    }
  }

  /**
   * Show custom install prompt UI
   */
  private showInstallPrompt(): void {
    // Check if user has previously dismissed
    const dismissed = localStorage.getItem('biscuits-install-dismissed');
    if (dismissed) {
      const dismissedTime = parseInt(dismissed);
      const daysSinceDismissal = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);

      // Don't show again for 7 days
      if (daysSinceDismissal < 7) {
        log.info('Install prompt recently dismissed, skipping');
        return;
      }
    }

    // Create install banner
    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.className = 'pwa-install-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-text">
          <strong>Install ${gameBrand.productName}</strong>
          <p>Add to home screen for quick access and offline play</p>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-install-btn" class="btn btn-primary primary">Install</button>
          <button id="pwa-dismiss-btn" class="btn btn-secondary secondary">Not Now</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Install button
    document.getElementById('pwa-install-btn')!.addEventListener('click', async () => {
      const installed = await this.install();
      if (installed) {
        banner.remove();
      }
    });

    // Dismiss button
    document.getElementById('pwa-dismiss-btn')!.addEventListener('click', () => {
      banner.remove();
      localStorage.setItem('biscuits-install-dismissed', Date.now().toString());
      log.info('Install prompt dismissed');
    });

    // Show with animation
    setTimeout(() => {
      banner.classList.add('show');
    }, 1000);
  }

  /**
   * Show update notification when new version is available
   */
  private showUpdateNotification(): void {
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';
    notification.innerHTML = `
      <div class="pwa-update-content">
        <strong>Update Available</strong>
        <p>A new version of ${gameBrand.productName} is ready</p>
        <button id="pwa-update-btn" class="btn btn-primary primary">Reload</button>
      </div>
    `;

    document.body.appendChild(notification);

    document.getElementById('pwa-update-btn')!.addEventListener('click', () => {
      window.location.reload();
    });

    setTimeout(() => {
      notification.classList.add('show');
    }, 100);
  }

  /**
   * Precache specific assets
   */
  async precacheAssets(urls: string[]): Promise<void> {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CACHE_URLS',
        urls: urls,
      });
      log.info('Requested precaching of assets:', urls);
    }
  }

  /**
   * Ask service worker to upload game logs in background.
   * Returns accepted count when worker upload succeeds.
   */
  async syncGameLogs(
    logs: unknown[],
    endpoint: string
  ): Promise<{ ok: boolean; accepted: number }> {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      return { ok: false, accepted: 0 };
    }
    if (logs.length === 0) {
      return { ok: true, accepted: 0 };
    }

    const result = await this.postMessageWithReply<{
      type: string;
      endpoint: string;
      logs: unknown[];
    }, {
      ok?: boolean;
      accepted?: number;
    }>({
      type: 'SYNC_GAME_LOGS',
      endpoint,
      logs,
    });

    return {
      ok: result?.ok === true,
      accepted: typeof result?.accepted === 'number' ? result.accepted : 0,
    };
  }

  private async postMessageWithReply<TRequest, TResponse>(
    payload: TRequest,
    timeoutMs: number = 7000
  ): Promise<TResponse | null> {
    return new Promise((resolve) => {
      if (!navigator.serviceWorker.controller) {
        resolve(null);
        return;
      }

      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => {
        channel.port1.onmessage = null;
        resolve(null);
      }, timeoutMs);

      channel.port1.onmessage = (event: MessageEvent<TResponse>) => {
        window.clearTimeout(timeout);
        channel.port1.onmessage = null;
        resolve(event.data ?? null);
      };

      navigator.serviceWorker.controller.postMessage(payload, [channel.port2]);
    });
  }
}

// Export singleton instance
export const pwaService = new PWAService();
