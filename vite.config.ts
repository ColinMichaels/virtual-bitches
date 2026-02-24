import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Vite configuration for BISCUITS
 *
 * Bundle size analysis (after optimization):
 * - babylonjs.js: ~5.1MB (BabylonJS core - cannot reduce significantly)
 * - loaders.js: ~213KB (glTF loader + side effects)
 * - index.js: ~119KB (game code)
 * - Total gzipped: ~1.2MB
 *
 * Note: We only use PNG/JPG textures, but @babylonjs/loaders bundles all
 * texture loaders due to side effects. This is a known limitation.
 */
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
      rollupOptions: {
        output: {
          // Separate large dependencies into their own chunks for better caching
          manualChunks: {
            babylonjs: ["@babylonjs/core"],
            loaders: ["@babylonjs/loaders"],
          },
        },
      },
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
