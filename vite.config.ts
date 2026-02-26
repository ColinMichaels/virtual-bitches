import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

/**
 * Vite configuration for BISCUITS
 *
 * Bundle size analysis (after optimization):
 * - babylon-core.js: ~5.1MB (BabylonJS core - cannot reduce significantly)
 * - babylon-loaders.js: ~213KB (glTF loader + side effects)
 * - firebase.js: ~153KB
 * - index.js: ~127KB (shell/auth/splash bootstrap)
 * - gameRuntime.js: ~158KB (loaded on Start Game)
 * - Total gzipped (JS): ~1.3MB
 *
 * Note: We only use PNG/JPG textures, but @babylonjs/loaders bundles all
 * texture loaders due to side effects. This is a known limitation.
 */
export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  // Determine which environment file to use
  const envFile = isProduction
    ? "environment.prod.ts"
    : mode === "development"
    ? "environment.dev.ts"
    : "environment.ts";

  return {
    base: "./",
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: "src/content/rules.md",
            dest: ".",
          },
        ],
      }),
    ],
    publicDir: "public",
    build: {
      target: "es2022",
      // Keep Babylon truly lazy: avoid injecting preload graph for dynamic chunks.
      modulePreload: false,
      // Generate source maps for production debugging
      // 'hidden' doesn't include source map reference in bundle but generates .map files
      sourcemap: isProduction ? "hidden" : true,
      // Babylon core is intentionally large; set a threshold above known baseline noise.
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        output: {
          // Partition large vendors so updates to app code don't invalidate all runtime deps.
          manualChunks(id: string): string | undefined {
            if (id.includes("vite/preload-helper") || id.includes("modulepreload-polyfill")) {
              return "vendor";
            }

            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (id.includes("@babylonjs/loaders")) {
              return "babylon-loaders";
            }

            if (id.includes("@babylonjs/core")) {
              return "babylon-core";
            }

            if (id.includes("/firebase/") || id.includes("/@firebase/")) {
              return "firebase";
            }

            if (id.includes("/marked/")) {
              return "marked";
            }

            return "vendor";
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
