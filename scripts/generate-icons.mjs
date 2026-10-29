import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "icons");

/**
 * How much detail the mark keeps at each size, and its transparent margin.
 * Toolbar sizes are full-bleed so the tile is as large as Chrome draws it;
 * the Chrome Web Store asks for 96px of artwork inside 16px of padding at 128.
 */
const ICONS = [
  { size: 16, detail: "tiny", padding: 0 },
  { size: 32, detail: "small", padding: 0 },
  { size: 48, detail: "full", padding: 2 },
  { size: 128, detail: "full", padding: 16 },
];

/** Bundles src/shared/brand.ts, so the icons are drawn by the same code as the UI. */
async function loadBrand() {
  const result = await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      emptyOutDir: false,
      copyPublicDir: false,
      lib: { entry: resolve(root, "src/shared/brand.ts"), formats: ["es"], fileName: "brand" },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap((output) => output.output).find((item) => item.type === "chunk" && item.isEntry);
  if (!chunk) throw new Error("Could not bundle src/shared/brand.ts");
  return import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
}

const { brandMarkSvg } = await loadBrand();

await mkdir(outDir, { recursive: true });

for (const { size, detail, padding } of ICONS) {
  const file = resolve(outDir, `icon-${size}.png`);
  await sharp(Buffer.from(brandMarkSvg({ size, detail, padding })))
    .png({ compressionLevel: 9 })
    .toFile(file);
  const meta = await sharp(file).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`Icon ${size} rendered as ${meta.width}x${meta.height}`);
  }
  console.log(`icon-${size}.png  ${meta.width}x${meta.height}  ${detail}, ${padding}px padding`);
}

// Full-bleed vector master for anything that needs the mark at another size.
await writeFile(resolve(outDir, "icon.svg"), `${brandMarkSvg({ size: 128, detail: "full" })}\n`, "utf8");
console.log("Icons generated.");
