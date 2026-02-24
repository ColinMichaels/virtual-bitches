import { defineConfig } from "vite";
import { resolve } from "path";
import { viteStaticCopy } from "vite-plugin-static-copy";

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
      // Generate source maps for production debugging
      // 'hidden' doesn't include source map reference in bundle but generates .map files
      sourcemap: isProduction ? "hidden" : true,
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
