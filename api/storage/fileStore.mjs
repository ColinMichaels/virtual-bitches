import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cloneStore, DEFAULT_STORE } from "./defaultStore.mjs";

export async function createFileStoreAdapter({
  dataDir,
  dataFile,
  logger,
}) {
  if (!dataDir || !dataFile) {
    throw new Error("File store adapter requires dataDir and dataFile");
  }

  return {
    name: "file",
    metadata: {
      backend: "file",
      dataFile,
    },
    async load() {
      await mkdir(dataDir, { recursive: true });

      if (!existsSync(dataFile)) {
        await writeFile(dataFile, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
        return cloneStore(DEFAULT_STORE);
      }

      try {
        const raw = await readFile(dataFile, "utf8");
        const parsed = JSON.parse(raw);
        return cloneStore(parsed);
      } catch (error) {
        logger?.warn?.("Failed to load file store, using defaults", error);
        return cloneStore(DEFAULT_STORE);
      }
    },
    async save(nextStore) {
      await mkdir(dataDir, { recursive: true });
      await writeFile(dataFile, JSON.stringify(nextStore, null, 2), "utf8");
    },
  };
}
