#!/usr/bin/env node
// Download any talent icons referenced by the scrape but missing from icons/.
// Saves them as lowercase .webp by piping the upstream PNG through `cwebp`
// (homebrew: `brew install webp`).
//
// Idempotent: skips icons that already exist locally.

import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRAPE_PATH = resolve(__dirname, 'source', 'soulmask_talents_551.json');
const ICON_DIR = resolve(REPO_ROOT, 'icons');

if (!existsSync(ICON_DIR)) mkdirSync(ICON_DIR, { recursive: true });

// Same logic as build.mjs — kept inline so this script is standalone.
function iconFromUrl(url) {
  if (!url) return null;
  const base = url.split('/').pop() || '';
  const noExt = base.replace(/\.[a-z]+$/i, '');
  return noExt.toLowerCase() + '.webp';
}

const scrape = JSON.parse(readFileSync(SCRAPE_PATH, 'utf8'));
const haveIcons = new Set(readdirSync(ICON_DIR));

// Group iconUrls by destination filename so we only fetch each once.
const need = new Map(); // localFilename → upstreamUrl
for (const s of scrape) {
  if (!s.iconUrl) continue;
  const local = iconFromUrl(s.iconUrl);
  if (haveIcons.has(local)) continue;
  if (!need.has(local)) need.set(local, s.iconUrl);
}

console.log(`Need to fetch ${need.size} icons (have ${haveIcons.size} locally).`);
if (need.size === 0) process.exit(0);

// Verify cwebp is available.
try {
  execFileSync('cwebp', ['-version'], { stdio: 'pipe' });
} catch (e) {
  console.error('cwebp not found. Install with: brew install webp');
  process.exit(1);
}

let ok = 0;
let fail = 0;
const tmpPng = resolve(tmpdir(), `soulmask-icon-fetch-${process.pid}.png`);

for (const [local, url] of need) {
  try {
    // Fetch PNG bytes.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    writeFileSync(tmpPng, buf);
    // Convert to webp at quality 90 (matches the size class of existing icons).
    const outPath = resolve(ICON_DIR, local);
    execFileSync('cwebp', ['-q', '90', '-quiet', tmpPng, '-o', outPath]);
    ok++;
    process.stdout.write(`✓ ${local}\n`);
  } catch (e) {
    fail++;
    process.stderr.write(`✗ ${local} (${url}): ${e.message}\n`);
  }
}

if (existsSync(tmpPng)) unlinkSync(tmpPng);
console.log(`\nDone: ${ok} fetched, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
