import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const errors = [];
const passes = [];

function pass(message) {
  passes.push(message);
  console.log(`  ✅ ${message}`);
}

function fail(message) {
  errors.push(message);
  console.log(`  ❌ ${message}`);
}

function safeResolve(relative) {
  const full = resolve(dist, relative);
  if (full !== dist && !full.startsWith(dist + sep)) {
    throw new Error(`Path escapes dist: ${relative}`);
  }
  return full;
}

async function checkFile(relative, label = relative) {
  try {
    const full = safeResolve(relative);
    const info = await stat(full);
    if (!info.isFile()) {
      fail(`${label} is not a file`);
      return false;
    }
    if (info.size === 0) {
      fail(`${label} is empty`);
      return false;
    }
    pass(`${label} exists (${(info.size / 1024).toFixed(1)} KiB)`);
    return true;
  } catch (error) {
    fail(`${label} missing or unreadable (${error instanceof Error ? error.message : String(error)})`);
    return false;
  }
}

async function readText(relative) {
  return readFile(safeResolve(relative), "utf8");
}

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

console.log("\nMadarWA build verification\n");

let manifest;
try {
  manifest = JSON.parse(await readText("manifest.json"));
  pass("dist/manifest.json is valid JSON");
} catch (error) {
  fail(`manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  console.log("\nBuild verification failed.\n");
  process.exit(1);
}

assert(manifest.manifest_version === 3, "Manifest V3 is declared");
assert(typeof manifest.name === "string" && manifest.name.length > 0, "Extension name present");
assert(/^\d+\.\d+\.\d+$/.test(manifest.version), `Extension version is semver (${manifest.version})`);

const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert(packageJson.version === manifest.version, "package.json and manifest versions match");

assert(manifest.action && manifest.action.default_popup === "popup.html", "Action popup points to popup.html");
assert(manifest.background && manifest.background.service_worker === "background.js", "Service worker is background.js");
assert(Array.isArray(manifest.permissions) && manifest.permissions.includes("storage"), "storage permission declared");
assert(Array.isArray(manifest.permissions) && manifest.permissions.includes("alarms"), "alarms permission declared");
assert(Array.isArray(manifest.permissions) && manifest.permissions.includes("notifications"), "notifications permission declared");
assert(
  Array.isArray(manifest.host_permissions) &&
    manifest.host_permissions.some((entry) => entry.includes("web.whatsapp.com")),
  "WhatsApp Web host permission declared",
);
assert(
  manifest.content_security_policy?.extension_pages?.includes("script-src 'self'"),
  "Extension CSP restricts scripts to self",
);

const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
const mainScript = scripts.find((entry) => entry.world === "MAIN");
const isolatedScript = scripts.find((entry) => entry.world === "ISOLATED");
assert(Boolean(mainScript), "MAIN world content script declared");
assert(Boolean(isolatedScript), "ISOLATED world content script declared");

if (mainScript) {
  const js = Array.isArray(mainScript.js) ? mainScript.js : [];
  assert(js.includes("wppconnect-wa.js"), "MAIN world loads local wppconnect-wa.js");
  assert(js.includes("injected.js"), "MAIN world loads injected.js");
  assert(mainScript.run_at === "document_start", "MAIN engine runs at document_start");
  assert(!js.some((file) => /^https?:/i.test(file)), "MAIN world uses only bundled scripts");
}
if (isolatedScript) {
  const js = Array.isArray(isolatedScript.js) ? isolatedScript.js : [];
  const css = Array.isArray(isolatedScript.css) ? isolatedScript.css : [];
  assert(js.includes("content.js"), "ISOLATED world loads content.js");
  assert(css.includes("privacy.css"), "ISOLATED world injects privacy.css");
  assert(!js.some((file) => /^https?:/i.test(file)), "ISOLATED world uses only bundled scripts");
}

const referenced = new Set();
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
for (const icon of Object.values(manifest.icons ?? {})) referenced.add(icon);
for (const icon of Object.values(manifest.action?.default_icon ?? {})) referenced.add(icon);
for (const entry of scripts) {
  for (const file of entry.js ?? []) referenced.add(file);
  for (const file of entry.css ?? []) referenced.add(file);
}
for (const entry of manifest.web_accessible_resources ?? []) {
  for (const resource of entry.resources ?? []) {
    if (!resource.includes("*")) referenced.add(resource);
  }
}

for (const file of [...referenced].sort()) {
  await checkFile(file, file);
}

for (const [size, file] of Object.entries(manifest.icons ?? {})) {
  try {
    const metadata = await sharp(safeResolve(file)).metadata();
    const expected = Number(size);
    if (metadata.width === expected && metadata.height === expected) {
      pass(`Icon ${file} is ${expected}x${expected}`);
    } else {
      fail(`Icon ${file} is ${metadata.width}x${metadata.height}, expected ${expected}x${expected}`);
    }
  } catch (error) {
    fail(`Icon ${file} could not be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await checkFile("wppconnect-wa.js", "wppconnect-wa.js");
await checkFile("privacy.css", "privacy.css");
await checkFile("popup.html", "popup.html");
await checkFile("content.js", "content.js");
await checkFile("injected.js", "injected.js");
await checkFile("background.js", "background.js");

const wppBundle = await readText("wppconnect-wa.js");
assert(wppBundle.includes("self.WPP="), "wa-js bundle exposes window.WPP locally");

const contentJs = await readText("content.js");
assert(contentJs.includes("madarwa-shadow-host"), "content.js mounts the Shadow DOM host");
assert(contentJs.includes("MADARWA_CMD_REQUEST") && contentJs.includes("MADARWA_CMD_RESPONSE"), "content.js includes the bridge protocol");
assert(contentJs.includes("madarwa:settings"), "content.js includes persisted settings keys");

const injectedJs = await readText("injected.js");
assert(injectedJs.includes("chat.new_message") && injectedJs.includes("chat.msg_revoke"), "injected.js subscribes to WA message events");
assert(injectedJs.includes("sendTextMessage") && injectedJs.includes("sendFileMessage"), "injected.js calls real WA send APIs");
assert(injectedJs.includes("MADARWA_CMD_REQUEST"), "injected.js includes the bridge listener");

const backgroundJs = await readText("background.js");
assert(backgroundJs.includes("MADARWA_WEBHOOK_DELIVER"), "background.js handles webhook delivery");
assert(backgroundJs.includes("X-MadarWA-Token"), "background.js sends the webhook token header");
assert(backgroundJs.includes("notifications.create"), "background.js dispatches desktop notifications");

const privacyCss = await readText("privacy.css");
assert(privacyCss.includes("data-madarwa-blur-preview"), "privacy.css gates blurring by body dataset");
assert(privacyCss.includes("data-madarwa-hidden-presence"), "privacy.css supports presence hiding");

const popupHtml = await readText("popup.html");
const scriptSources = [...popupHtml.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((match) => match[1]);
const styleSources = [...popupHtml.matchAll(/<link[^>]*\shref=["']([^"']+)["']/gi)].map((match) => match[1]);
assert(scriptSources.length > 0, "popup.html references an external compiled script");
for (const source of [...scriptSources, ...styleSources]) {
  if (/^(https?:)?\/\//i.test(source)) {
    fail(`popup.html references a remote asset: ${source}`);
  } else {
    const relative = source.replace(/^\.\//, "").replace(/^\//, "");
    await checkFile(relative, `popup asset ${relative}`);
  }
}
const inlineScripts = [...popupHtml.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter(
  (match) => (match[1] ?? "").trim().length > 0,
);
assert(inlineScripts.length === 0, "popup.html contains no inline scripts");

const distFiles = await readdir(dist, { withFileTypes: true });
assert(distFiles.length > 0, "dist/ contains build artifacts");
assert(!distFiles.some((entry) => entry.name === "node_modules"), "dist/ does not contain node_modules");

console.log(`\n${passes.length} checks passed, ${errors.length} failed.`);
if (errors.length > 0) {
  console.log("\nBuild verification FAILED.\n");
  process.exit(1);
}
console.log("Build verification PASSED.\n");
