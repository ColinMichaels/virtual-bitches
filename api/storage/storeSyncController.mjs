export function createStoreSyncController({
  getStore,
  setStore,
  cloneStore,
  rehydrateCooldownMs,
  beforePersist,
  afterRehydrate,
  now = () => Date.now(),
  log,
}) {
  if (typeof getStore !== "function") {
    throw new Error("Store sync controller requires getStore()");
  }
  if (typeof setStore !== "function") {
    throw new Error("Store sync controller requires setStore()");
  }
  if (typeof cloneStore !== "function") {
    throw new Error("Store sync controller requires cloneStore()");
  }

  const cooldownMs =
    Number.isFinite(rehydrateCooldownMs) && rehydrateCooldownMs >= 0
      ? Math.floor(rehydrateCooldownMs)
      : 0;

  let storeAdapter = null;
  let persistStoreQueue = Promise.resolve();
  let storeRehydratePromise = null;
  let lastStoreRehydrateAt = 0;

  function setAdapter(nextStoreAdapter) {
    storeAdapter = nextStoreAdapter ?? null;
  }

  function getAdapter() {
    return storeAdapter;
  }

  async function persistStore() {
    if (!storeAdapter || typeof storeAdapter.save !== "function") {
      return;
    }

    persistStoreQueue = persistStoreQueue
      .catch(() => {
        // Keep persist operations flowing even if a prior save failed.
      })
      .then(async () => {
        if (typeof beforePersist === "function") {
          beforePersist();
        }
        await storeAdapter.save(getStore());
      });

    await persistStoreQueue;
  }

  async function rehydrateStore(reason, options = {}) {
    if (!storeAdapter || typeof storeAdapter.load !== "function") {
      return false;
    }

    // Avoid reading stale remote state while local saves are still being flushed.
    await persistStoreQueue.catch(() => {
      // Rehydrate can still continue and try to recover from adapter state.
    });

    if (storeRehydratePromise) {
      return storeRehydratePromise;
    }

    const rehydrateNow = now();
    if (
      options.force !== true &&
      cooldownMs > 0 &&
      lastStoreRehydrateAt > 0 &&
      rehydrateNow - lastStoreRehydrateAt < cooldownMs
    ) {
      return false;
    }

    storeRehydratePromise = (async () => {
      try {
        const loaded = await storeAdapter.load();
        if (!loaded || typeof loaded !== "object") {
          return false;
        }

        setStore(cloneStore(loaded));

        let persistAfterRehydrate = false;
        if (typeof afterRehydrate === "function") {
          const result = await afterRehydrate({ reason, options });
          persistAfterRehydrate = result?.persist === true;
        }

        if (persistAfterRehydrate) {
          await persistStore();
        }

        lastStoreRehydrateAt = now();
        log?.debug?.(`Store rehydrated from adapter (${reason})`);
        return true;
      } catch (error) {
        log?.warn?.(`Failed to rehydrate store (${reason})`, error);
        return false;
      }
    })();

    try {
      return await storeRehydratePromise;
    } finally {
      storeRehydratePromise = null;
    }
  }

  return {
    setAdapter,
    getAdapter,
    persistStore,
    rehydrateStore,
  };
}
