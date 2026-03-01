import { environment } from "@env";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import type { Analytics } from "firebase/analytics";
import { logger } from "../utils/logger.js";
import {
  ANALYTICS_EVENTS,
  type AnalyticsEventName,
  type AnalyticsEventParamsMap,
} from "./analyticsEvents.js";
import { getFirebaseAppOptions } from "./firebaseAppConfig.js";
import { settingsService } from "./settings.js";

const log = logger.create("AnalyticsService");

type AnalyticsModule = typeof import("firebase/analytics");
type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

export class AnalyticsService {
  private app: FirebaseApp | null = null;
  private analytics: Analytics | null = null;
  private analyticsModulePromise: Promise<AnalyticsModule> | null = null;
  private started = false;
  private sdkReady = false;
  private sdkSupported = false;
  private analyticsEnabled = false;
  private lastAppliedCollectionEnabled: boolean | null = null;

  isConfigured(): boolean {
    return isAnalyticsConfigured();
  }

  isEnabled(): boolean {
    return this.analyticsEnabled && this.sdkReady && this.sdkSupported;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.analyticsEnabled = settingsService.getSettings().privacy.analyticsEnabled === true;

    settingsService.onChange((settings) => {
      const enabled = settings.privacy.analyticsEnabled === true;
      if (enabled === this.analyticsEnabled) {
        return;
      }
      this.analyticsEnabled = enabled;
      void this.applyCollectionState();
    });

    await this.applyCollectionState();
    if (this.isEnabled()) {
      this.logEvent(ANALYTICS_EVENTS.APP_SHELL_BOOTED, {
        build_mode: environment.production ? "production" : "development",
      });
    }
  }

  logEvent<Name extends AnalyticsEventName>(
    eventName: Name,
    params: AnalyticsEventParamsMap[Name] = {} as AnalyticsEventParamsMap[Name]
  ): void {
    if (!this.analyticsEnabled || !eventName.trim()) {
      return;
    }
    void this.logEventAsync(eventName, params as AnalyticsParams);
  }

  private async logEventAsync(eventName: AnalyticsEventName, params: AnalyticsParams): Promise<void> {
    await this.initializeSdk();
    if (!this.analytics || !this.sdkSupported || !this.analyticsEnabled) {
      return;
    }

    try {
      const analyticsModule = await this.getAnalyticsModule();
      analyticsModule.logEvent(this.analytics, eventName, sanitizeParams(params));
    } catch (error) {
      log.warn("Failed to send analytics event", error);
    }
  }

  private async initializeSdk(): Promise<void> {
    if (this.sdkReady || !isAnalyticsConfigured() || typeof window === "undefined") {
      return;
    }

    try {
      const analyticsModule = await this.getAnalyticsModule();
      const supported = await analyticsModule.isSupported();
      if (!supported) {
        this.sdkSupported = false;
        log.info("Firebase analytics unsupported in this browser/runtime");
        return;
      }

      this.app = getApps()[0] ?? initializeApp(getFirebaseAppOptions());
      this.analytics = analyticsModule.getAnalytics(this.app);
      this.sdkSupported = true;
      log.info("Firebase analytics initialized");
    } catch (error) {
      this.sdkSupported = false;
      log.warn("Failed to initialize Firebase analytics", error);
    } finally {
      this.sdkReady = true;
    }
  }

  private async applyCollectionState(): Promise<void> {
    if (this.analyticsEnabled) {
      await this.initializeSdk();
    }
    if (!this.analytics || !this.sdkSupported) {
      this.lastAppliedCollectionEnabled = this.analyticsEnabled;
      return;
    }

    try {
      const analyticsModule = await this.getAnalyticsModule();
      analyticsModule.setAnalyticsCollectionEnabled(this.analytics, this.analyticsEnabled);
      if (this.analyticsEnabled && this.lastAppliedCollectionEnabled !== true) {
        analyticsModule.logEvent(this.analytics, ANALYTICS_EVENTS.ANALYTICS_CONSENT_ENABLED);
      }
      this.lastAppliedCollectionEnabled = this.analyticsEnabled;
    } catch (error) {
      log.warn("Failed to update analytics collection state", error);
    }
  }

  private async getAnalyticsModule(): Promise<AnalyticsModule> {
    if (!this.analyticsModulePromise) {
      this.analyticsModulePromise = import("firebase/analytics");
    }
    return this.analyticsModulePromise;
  }
}

function sanitizeParams(params: AnalyticsParams): Record<string, string | number | boolean | null> {
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function isAnalyticsConfigured(): boolean {
  if (!environment.features.analytics) {
    return false;
  }

  const config = environment.firebaseConfig;
  return Boolean(
    config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId &&
      config.messagingSenderId
  );
}

export const analyticsService = new AnalyticsService();
