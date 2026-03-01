import { environment } from "@env";
import type { FirebaseOptions } from "firebase/app";

export function getFirebaseAppOptions(): FirebaseOptions {
  const {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  } = environment.firebaseConfig;

  // Intentionally omit measurementId so Analytics can resolve the canonical ID
  // from Firebase backend metadata and avoid local/server mismatch warnings.
  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
  };
}
