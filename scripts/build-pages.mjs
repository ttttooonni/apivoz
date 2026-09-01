#!/usr/bin/env node
/**
 * Static SPA build for GitHub Pages (no Node server).
 * Default `npm run build` stays on the Vercel/Nitro path.
 *
 *   PAGES_BASE=/apivoz/ npm run build:pages
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dest = join(root, "dist", "pages");
const base = process.env.PAGES_BASE || "/apivoz/";
const basePrefix = base.endsWith("/") ? base.slice(0, -1) : base;
const startUrl = `${basePrefix}/`;

process.env.PAGES = "1";
process.env.PAGES_BASE = base.endsWith("/") ? base : `${base}/`;

const build = spawnSync(process.execPath, ["scripts/with-app-env.mjs", "vite", "build"], {
  stdio: "inherit",
  env: process.env,
  cwd: root,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const candidates = [join(root, "dist", "client"), join(root, ".output", "public"), join(root, "dist")];

function looksLikeSite(dir) {
  if (!existsSync(dir)) return false;
  try {
    const names = readdirSync(dir);
    return names.some((n) => n === "index.html" || n === "_shell.html" || n === "assets");
  } catch {
    return false;
  }
}

const src = candidates.find(looksLikeSite);
if (!src) {
  console.error("[build-pages] No se encontró HTML estático (index.html / assets).");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const name of readdirSync(src)) {
  if (name === "pages") continue;
  cpSync(join(src, name), join(dest, name), { recursive: true });
}

const shellCandidates = ["index.html", "_shell.html", "index.html.html"].map((n) => join(dest, n));
const shell = shellCandidates.find((p) => existsSync(p));
if (!shell) {
  console.error("[build-pages] El build no emitió index.html ni _shell.html.");
  process.exit(1);
}
if (shell !== join(dest, "index.html")) {
  copyFileSync(shell, join(dest, "index.html"));
}

function rewriteRootUrls(html) {
  const prefixRel = basePrefix.replace(/^\//, "");
  return html.replace(/(href|src)="\/(?!\/)([^"]*)"/g, (full, attr, path) => {
    if (path === prefixRel || path.startsWith(`${prefixRel}/`)) return full;
    return `${attr}="${basePrefix}/${path}"`;
  });
}

const indexPath = join(dest, "index.html");
const rewritten = rewriteRootUrls(readFileSync(indexPath, "utf8"));
writeFileSync(indexPath, rewritten);
writeFileSync(join(dest, "404.html"), rewritten);
writeFileSync(join(dest, ".nojekyll"), "");

const manifest = {
  name: "mi-apiario",
  short_name: "mi-apiario",
  id: startUrl,
  start_url: startUrl,
  scope: startUrl,
  display: "standalone",
  background_color: "#f3efe4",
  theme_color: "#f3efe4",
  lang: "es",
  icons: [
    { src: `${startUrl}icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${startUrl}icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${startUrl}__grok/icon-180.png`, sizes: "180x180", type: "image/png" },
  ],
};
const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
mkdirSync(join(dest, "__grok"), { recursive: true });
writeFileSync(join(dest, "__grok", "manifest.webmanifest"), manifestJson);
writeFileSync(join(dest, "manifest.webmanifest"), manifestJson);

console.log(`[build-pages] Listo: ${dest} (base ${startUrl})`);
