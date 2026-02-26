import { createFileStoreAdapter } from "./fileStore.mjs";

export { DEFAULT_STORE } from "./defaultStore.mjs";

export async function createStoreAdapter(options = {}) {
  const backend = normalizeBackend(options.backend);
  if (backend === "firestore") {
    const { createFirestoreStoreAdapter } = await import("./firestoreStore.mjs");
    return createFirestoreStoreAdapter({
      logger: options.logger,
      firebaseProjectId: options.firebaseProjectId,
      firestorePrefix: options.firestorePrefix,
    });
  }

  return createFileStoreAdapter({
    dataDir: options.dataDir,
    dataFile: options.dataFile,
    logger: options.logger,
  });
}

function normalizeBackend(rawBackend) {
  const backend = String(rawBackend ?? "file").trim().toLowerCase();
  if (backend === "firestore") {
    return "firestore";
  }
  return "file";
}
