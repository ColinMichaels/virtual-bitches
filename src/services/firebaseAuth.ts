import { environment } from "@env";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  type Auth,
  type User,
} from "firebase/auth";
import { logger } from "../utils/logger.js";

const log = logger.create("FirebaseAuth");

export interface FirebaseUserProfile {
  uid: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  isAnonymous: boolean;
}

export class FirebaseAuthService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private currentUser: User | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;

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
      log.warn("Failed to obtain Firebase ID token", error);
      return null;
    }
  }

  async signInWithGoogle(): Promise<boolean> {
    await this.initialize();
    if (!this.auth) {
      return false;
    }

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account",
      });
      await signInWithPopup(this.auth, provider);
      return true;
    } catch (error) {
      log.warn("Google sign-in failed", error);
      return false;
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
      this.app = getApps()[0] ?? initializeApp(environment.firebaseConfig);
      this.auth = getAuth(this.app);
      onAuthStateChanged(this.auth, (user) => {
        this.currentUser = user;
        this.dispatchAuthChanged();
      });

      if (!this.auth.currentUser) {
        await signInAnonymously(this.auth);
      } else {
        this.currentUser = this.auth.currentUser;
      }
    } catch (error) {
      log.error("Failed to initialize Firebase auth", error);
    } finally {
      this.initialized = true;
      this.dispatchAuthChanged();
    }
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
  return {
    uid: user.uid,
    displayName: user.displayName ?? undefined,
    email: user.email ?? undefined,
    photoURL: user.photoURL ?? undefined,
    isAnonymous: Boolean(user.isAnonymous),
  };
}

export const firebaseAuthService = new FirebaseAuthService();
