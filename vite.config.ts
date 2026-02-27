import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import { readFileSync } from "fs";
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
  const env = loadEnv(mode, process.cwd(), "");
  const isProduction = mode === "production";
  const apiProxyTarget = env.VITE_API_PROXY_TARGET?.trim() || "http://localhost:3000";
  const feedbackFormUrl =
    env.FEEDBACK_FORM_URL?.trim() ||
    env.VITE_FEEDBACK_FORM_URL?.trim() ||
    "https://docs.google.com/forms/d/e/1FAIpQLSeB0EGnrvQ5G3sbyOoW9rtcA1BNPbZo_NCFRejntquZ-z1o6w/viewform";
  const facebookShareMetaTemplate = readFileSync(
    resolve(__dirname, "src/social/share/facebook-share-meta.template.html"),
    "utf8"
  );
  const brandProductName = env.VITE_BRAND_PRODUCT_NAME?.trim() || "BISCUITS";
  const brandOgTitle = env.VITE_BRAND_OG_TITLE?.trim() || `${brandProductName} - Push Your Luck Dice Game`;
  const brandOgDescription =
    env.VITE_BRAND_OG_DESCRIPTION?.trim() ||
    `Roll low, score lower, and challenge friends in ${brandProductName}.`;
  const brandOgImageAlt = env.VITE_BRAND_OG_IMAGE_ALT?.trim() || `${brandProductName} share artwork.`;

  const applyBrandTokens = (value: string): string =>
    value
      .replaceAll("__BRAND_PRODUCT_NAME__", brandProductName)
      .replaceAll("__BRAND_OG_TITLE__", brandOgTitle)
      .replaceAll("__BRAND_OG_DESCRIPTION__", brandOgDescription)
      .replaceAll("__BRAND_OG_IMAGE_ALT__", brandOgImageAlt);
  const brandedFacebookShareMetaTemplate = applyBrandTokens(facebookShareMetaTemplate);

  // Determine which environment file to use
  const envFile = isProduction
    ? "environment.prod.ts"
    : mode === "development"
    ? "environment.dev.ts"
    : "environment.ts";

  return {
    base: "./",
    plugins: [
      {
        name: "feedback-redirect",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const pathname = req.url?.split("?")[0] ?? "";
            if (pathname !== "/feedback") {
              next();
              return;
            }
            res.statusCode = 302;
            res.setHeader("Location", feedbackFormUrl);
            res.end();
          });
        },
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const pathname = req.url?.split("?")[0] ?? "";
            if (pathname !== "/feedback") {
              next();
              return;
            }
            res.statusCode = 302;
            res.setHeader("Location", feedbackFormUrl);
            res.end();
          });
        },
      },
      {
        name: "inject-facebook-share-meta-template",
        transformIndexHtml(html) {
          return applyBrandTokens(html).replace(
            "<!-- FACEBOOK_SHARE_META_TEMPLATE -->",
            brandedFacebookShareMetaTemplate
          );
        },
      },
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
      // Keep JS/CSS aggressively minified for deploy builds.
      minify: "esbuild",
      cssMinify: "esbuild",
      // Keep Babylon truly lazy: avoid injecting preload graph for dynamic chunks.
      modulePreload: false,
      // Keep source maps out of production bundles to reduce payload/artifact size.
      sourcemap: isProduction ? false : true,
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
    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: {
        "@env": resolve(__dirname, `src/environments/${envFile}`),
      },
    },
  };
});
