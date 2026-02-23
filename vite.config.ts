import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  // Determine which environment file to use
  const envFile = mode === "production"
    ? "environment.prod.ts"
    : mode === "development"
    ? "environment.dev.ts"
    : "environment.ts";

  return {
    base: "./",
    build: {
      target: "es2022",
    },
    optimizeDeps: {
      exclude: ["@babylonjs/core", "@babylonjs/loaders"],
    },
    resolve: {
      alias: {
        "@env": resolve(__dirname, `src/environments/${envFile}`),
      },
    },
  };
});
