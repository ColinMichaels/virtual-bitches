import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloneStore, deepEqualJson, getStoreSections } from "./defaultStore.mjs";

const MAX_BATCH_WRITES = 400;

export async function createFirestoreStoreAdapter({
  logger,
  firebaseProjectId,
  firestorePrefix,
}) {
  const app = getOrCreateFirebaseAdminApp({ logger, firebaseProjectId });
  const db = getFirestore(app);

  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Firestore settings are immutable after first use.
  }

  const collectionPrefix = normalizeCollectionPrefix(firestorePrefix);
  let previousStore = cloneStore();

  return {
    name: "firestore",
    async load() {
      const nextStore = cloneStore();
      const sections = getStoreSections();

      await Promise.all(
        sections.map(async (section) => {
          const snapshot = await db
            .collection(getCollectionName(collectionPrefix, section))
            .get();
          const sectionMap = {};
          snapshot.forEach((doc) => {
            sectionMap[doc.id] = doc.data();
          });
          nextStore[section] = sectionMap;
        })
      );

      previousStore = cloneStore(nextStore);
      return nextStore;
    },
    async save(nextStore) {
      const normalizedStore = cloneStore(nextStore);
      const sections = getStoreSections();

      for (const section of sections) {
        const prevSectionMap = previousStore[section] ?? {};
        const nextSectionMap = normalizedStore[section] ?? {};
        await syncSection(
          db,
          collectionPrefix,
          section,
          prevSectionMap,
          nextSectionMap
        );
      }

      previousStore = cloneStore(normalizedStore);
    },
  };
}

function getOrCreateFirebaseAdminApp({ logger, firebaseProjectId }) {
  const existing = getApps()[0];
  if (existing) {
    return existing;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (serviceAccountJson) {
    try {
      const credentials = JSON.parse(serviceAccountJson);
      return initializeApp({
        credential: cert(credentials),
        projectId: firebaseProjectId || credentials.project_id || undefined,
      });
    } catch (error) {
      logger?.error?.("Invalid FIREBASE_SERVICE_ACCOUNT_JSON", error);
      throw error;
    }
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId: firebaseProjectId || undefined,
  });
}

function normalizeCollectionPrefix(rawPrefix) {
  const trimmed = String(rawPrefix ?? "api_v1").trim().toLowerCase();
  const normalized = trimmed.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
  return normalized || "api_v1";
}

function getCollectionName(prefix, section) {
  return `${prefix}_${section}`;
}

async function syncSection(db, collectionPrefix, section, previousMap, nextMap) {
  const changed = [];
  const removed = [];

  for (const [id, value] of Object.entries(nextMap)) {
    if (!id) continue;
    const previousValue = previousMap[id];
    if (!deepEqualJson(previousValue, value)) {
      changed.push([id, value]);
    }
  }

  for (const id of Object.keys(previousMap)) {
    if (!Object.prototype.hasOwnProperty.call(nextMap, id)) {
      removed.push(id);
    }
  }

  if (changed.length === 0 && removed.length === 0) {
    return;
  }

  const collection = db.collection(getCollectionName(collectionPrefix, section));
  let batch = db.batch();
  let opCount = 0;

  const commitBatch = async () => {
    if (opCount === 0) return;
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  };

  for (const [id, value] of changed) {
    const ref = collection.doc(id);
    batch.set(ref, sanitizeForFirestore(value), { merge: false });
    opCount += 1;
    if (opCount >= MAX_BATCH_WRITES) {
      await commitBatch();
    }
  }

  for (const id of removed) {
    const ref = collection.doc(id);
    batch.delete(ref);
    opCount += 1;
    if (opCount >= MAX_BATCH_WRITES) {
      await commitBatch();
    }
  }

  await commitBatch();
}

function sanitizeForFirestore(value) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForFirestore(entry));
  }
  if (typeof value !== "object") {
    return value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    next[key] = sanitizeForFirestore(entry);
  }
  return next;
}
