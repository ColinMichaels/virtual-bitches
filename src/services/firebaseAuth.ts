import { environment } from "@env";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  FacebookAuthProvider,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { logger } from "../utils/logger.js";
import { getFirebaseAppOptions } from "./firebaseAppConfig.js";

const log = logger.create("FirebaseAuth");
const FIREBASE_SESSION_EXPIRED_EVENT_COOLDOWN_MS = 10000;

export interface FirebaseUserProfile {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  providerId?: string;
  isAnonymous: boolean;
}

export type FirebaseSocialProvider = "google" | "facebook";

export class FirebaseAuthService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private currentUser: User | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private authStateUnsubscribe: (() => void) | null = null;
  private lastSessionExpiredEventAt = 0;

  isConfigured(): boolean {
    return hasFirebaseConfig();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCurrentUserProfile(): FirebaseUserProfile | null {
    if (!this.currentUser) return null;
    return mapUser(this.currentUser);
  }

  isAuthenticated(): boolean {
    return Boolean(this.currentUser && !this.currentUser.isAnonymous);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.bootstrap().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  async getIdToken(forceRefresh = false): Promise<string | null> {
    await this.initialize();
    if (!this.auth?.currentUser) {
      return null;
    }

    try {
      return await this.auth.currentUser.getIdToken(forceRefresh);
    } catch (error) {
      const code = extractFirebaseAuthErrorCode(error);
      if (isFirebaseSessionExpiredCode(code)) {
        await this.handleSessionExpired(code ?? "firebase_session_expired");
        return null;
      }
      log.warn("Failed to obtain Firebase ID token", error);
      return null;
    }
  }

  async signInWithGoogle(): Promise<boolean> {
    return this.signInWithProvider("google");
  }

  async signInWithFacebook(): Promise<boolean> {
    return this.signInWithProvider("facebook");
  }

  async signInWithProvider(providerName: FirebaseSocialProvider): Promise<boolean> {
    await this.initialize();
    if (!this.auth) {
      return false;
    }

    try {
      const provider =
        providerName === "facebook" ? new FacebookAuthProvider() : new GoogleAuthProvider();
      if (providerName === "google") {
        (provider as GoogleAuthProvider).setCustomParameters({
          prompt: "select_account",
        });
      }
      await signInWithPopup(this.auth, provider);
      return true;
    } catch (error) {
      log.warn(`${providerName} sign-in failed`, error);
      return false;
    }
  }

  async signOutCurrentUser(): Promise<void> {
    await this.initialize();
    if (!this.auth) {
      return;
    }

    try {
      await signOut(this.auth);
    } catch (error) {
      log.warn("Sign-out failed", error);
    }
  }

  private async bootstrap(): Promise<void> {
    if (!hasFirebaseConfig()) {
      log.warn("Firebase auth disabled: missing Firebase web config");
      this.initialized = true;
      this.dispatchAuthChanged();
      return;
    }

    try {
      this.app = getApps()[0] ?? initializeApp(getFirebaseAppOptions());
      this.auth = getAuth(this.app);
      await this.configurePersistence(this.auth);
      await this.bindAuthStateListener(this.auth);
    } catch (error) {
      log.error("Failed to initialize Firebase auth", error);
    } finally {
      this.initialized = true;
      this.dispatchAuthChanged();
    }
  }

  private async configurePersistence(auth: Auth): Promise<void> {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (error) {
      log.warn("Unable to enable local Firebase auth persistence", error);
    }
  }

  private async bindAuthStateListener(auth: Auth): Promise<void> {
    await new Promise<void>((resolve) => {
      let initialStateObserved = false;
      this.authStateUnsubscribe?.();
      this.authStateUnsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          this.currentUser = user;
          this.dispatchAuthChanged();
          if (!initialStateObserved) {
            initialStateObserved = true;
            resolve();
          }
        },
        (error) => {
          log.warn("Firebase auth state observer error", error);
          if (!initialStateObserved) {
            initialStateObserved = true;
            resolve();
          }
        }
      );
    });
  }

  private async handleSessionExpired(reason: string): Promise<void> {
    log.warn(`Firebase auth session expired (${reason})`);
    if (this.auth?.currentUser) {
      try {
        await signOut(this.auth);
      } catch (error) {
        log.warn("Failed to sign out expired Firebase session", error);
      }
    }
    this.dispatchFirebaseSessionExpired(reason);
  }

  private dispatchAuthChanged(): void {
    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }

    document.dispatchEvent(
      new CustomEvent("auth:firebaseUserChanged", {
        detail: this.getCurrentUserProfile(),
      })
    );
  }

  private dispatchFirebaseSessionExpired(reason: string): void {
    if (typeof document === "undefined" || typeof CustomEvent === "undefined") {
      return;
    }

    const now = Date.now();
    if (
      this.lastSessionExpiredEventAt > 0 &&
      now - this.lastSessionExpiredEventAt < FIREBASE_SESSION_EXPIRED_EVENT_COOLDOWN_MS
    ) {
      return;
    }
    this.lastSessionExpiredEventAt = now;

    document.dispatchEvent(
      new CustomEvent("auth:firebaseSessionExpired", {
        detail: { reason },
      })
    );
  }
}

function hasFirebaseConfig(): boolean {
  const config = environment.firebaseConfig;
  return Boolean(
    config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId &&
      config.messagingSenderId
  );
}

function mapUser(user: User): FirebaseUserProfile {
  const providerId =
    Array.isArray(user.providerData) && user.providerData.length > 0
      ? user.providerData.find((entry) => typeof entry?.providerId === "string")?.providerId
      : undefined;
  return {
    uid: user.uid,
    displayName: user.displayName ?? undefined,
    email: user.email ?? undefined,
    photoURL: user.photoURL ?? undefined,
    providerId: typeof providerId === "string" && providerId.trim().length > 0 ? providerId : undefined,
    isAnonymous: Boolean(user.isAnonymous),
  };
}

function extractFirebaseAuthErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isFirebaseSessionExpiredCode(code: string | null): boolean {
  if (!code) {
    return false;
  }
  return (
    code === "auth/user-token-expired" ||
    code === "auth/id-token-expired" ||
    code === "auth/invalid-user-token" ||
    code === "auth/user-disabled" ||
    code === "auth/user-not-found"
  );
}

export const firebaseAuthService = new FirebaseAuthService();
