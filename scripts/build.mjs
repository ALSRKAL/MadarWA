import { mkdir, rm, copyFile, cp, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const watchMode = process.argv.includes("--watch");

const common = {
  configFile: false,
  root,
  publicDir: false,
  logLevel: "warn",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  esbuild: {
    legalComments: "none",
  },
  build: {
    target: "chrome111",
    minify: "esbuild",
    sourcemap: false,
    emptyOutDir: false,
    chunkSizeWarningLimit: 5000,
  },
};

async function buildPopup() {
  await build({
    ...common,
    base: "./",
    plugins: [react()],
    build: {
      ...common.build,
      outDir: dist,
      emptyOutDir: true,
      assetsDir: "assets",
      rollupOptions: {
        input: { popup: resolve(root, "popup.html") },
      },
    },
  });
}

async function buildLib(entry, name, fileName, plugins = []) {
  await build({
    ...common,
    plugins,
    build: {
      ...common.build,
      outDir: dist,
      lib: {
        entry: resolve(root, entry),
        name,
        formats: ["iife"],
        fileName: () => fileName,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          extend: false,
        },
      },
    },
  });
}

async function copyStatic() {
  await mkdir(resolve(dist, "icons"), { recursive: true });
  await copyFile(resolve(root, "public/manifest.json"), resolve(dist, "manifest.json"));
  await copyFile(resolve(root, "src/injected/privacy.css"), resolve(dist, "privacy.css"));
  await copyFile(
    resolve(root, "node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js"),
    resolve(dist, "wppconnect-wa.js"),
  );
  await cp(resolve(root, "icons"), resolve(dist, "icons"), { recursive: true });

  // UI typeface (IBM Plex Sans Arabic, OFL-1.1), shipped locally: no font CDN.
  const fontSource = resolve(root, "node_modules/@fontsource/ibm-plex-sans-arabic/files");
  await mkdir(resolve(dist, "fonts"), { recursive: true });
  for (const weight of [400, 500, 600]) {
    for (const subset of ["arabic", "latin"]) {
      const file = `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`;
      await copyFile(resolve(fontSource, file), resolve(dist, "fonts", file));
    }
  }
  // The OFL requires its text to travel with the font files.
  await copyFile(
    resolve(root, "node_modules/@fontsource/ibm-plex-sans-arabic/LICENSE"),
    resolve(dist, "fonts", "OFL.txt"),
  );
}

async function reportSizes(files) {
  for (const file of files) {
    const info = await stat(resolve(dist, file));
    console.log(`  ${file.padEnd(24)} ${(info.size / 1024).toFixed(1)} KiB`);
  }
}

async function buildAll() {
  console.log(`\nMadarWA build → ${dist}`);
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await buildPopup();
  await buildLib("src/content/index.tsx", "MadarWAContent", "content.js", [react()]);
  await buildLib("src/injected/preload.ts", "MadarWAPreload", "preload.js");
  await buildLib("src/injected/engine.ts", "MadarWAEngine", "injected.js");
  await buildLib("src/background/index.ts", "MadarWABackground", "background.js");
  await copyStatic();

  console.log("\nArtifacts:");
  await reportSizes([
    "manifest.json",
    "background.js",
    "content.js",
    "preload.js",
    "injected.js",
    "wppconnect-wa.js",
    "privacy.css",
    "popup.html",
  ]);
  console.log("\nBuild complete.\n");
}

await buildAll();

if (watchMode) {
  let timer = null;
  console.log("Watching src/, public/, popup.html and icons for changes...");
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void buildAll().catch((error) => console.error("Build failed:", error));
    }, 300);
  };

  for (const target of ["src", "public", "icons"]) {
    watch(resolve(root, target), { recursive: true }, schedule);
  }
  watch(resolve(root, "popup.html"), schedule);
}
