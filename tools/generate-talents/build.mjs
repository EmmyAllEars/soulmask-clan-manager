#!/usr/bin/env node
// Regenerate data/talents.json from the soulmaskdatabase.com scrape.
//
// Inputs:
//   - source/soulmask_talents_551.json  (committed copy of upstream scrape)
//   - source/curated_overrides.json     (frozen snapshot of the original
//                                         pre-issue-46 talents.json — used to
//                                         carry forward hand-curated polarity
//                                         + finer categories. Frozen so the
//                                         generator is idempotent and
//                                         doesn't self-feedback on re-run.)
// Output:
//   - ../../data/talents.json (overwritten)
//
// Side effect: prints per-bucket counts and any inferred-negative names so
// the user can spot-check classification before committing.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRAPE_PATH = resolve(__dirname, 'source', 'soulmask_talents_551.json');
const CURATED_PATH = resolve(__dirname, 'source', 'curated_overrides.json');
const OUTPUT_PATH = resolve(REPO_ROOT, 'data', 'talents.json');

// --- HTML entity decode (the scrape contains &#x27; &amp; &quot;) -----------
function decodeEntities(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// --- icon filename normalization --------------------------------------------
// Scrape gives PNG URLs like .../images/TianFu_bishijixu.png. Local convention
// is lowercase + .webp. We lowercase the basename so case-sensitive hosts
// (GitHub Pages) serve consistently with the existing catalog.
function iconFromUrl(url) {
  if (!url) return null;
  const base = url.split('/').pop() || '';
  const noExt = base.replace(/\.[a-z]+$/i, '');
  return noExt.toLowerCase() + '.webp';
}

// --- category mapping --------------------------------------------------------
// Coarse scrape categories → finer existing categories where the curated
// catalog has a verdict, otherwise fall back to a sensible default.
function mapCategory(scrapeCategory, curatedCategory) {
  switch (scrapeCategory) {
    case 'Preference': return 'Preference';
    case 'Origin': return 'Origin';
    case 'Personality': return 'Personality';
    case 'Title': return 'Title / Specialty Talents';
    case 'Tribe Exclusive': return 'Advanced / Tribe-Locked Combat Talents';
    case 'Experience': return 'Acquired Combat Talents';
    case 'General':
      // Inherit existing curated category if available (preserves the finer
      // buckets like 'Innate / Generic Stat Talents').
      return curatedCategory || 'Crafter Specialty Talents';
    default:
      return curatedCategory || scrapeCategory || 'Uncategorized';
  }
}

// --- polarity inference ------------------------------------------------------
// Body-defect leading-word patterns observed in the existing 31 curated
// negatives. Anchored as a word so 'Slow Pace' → negative but 'Slow Reload'
// is matched too (both are negatives in the curated set).
const NEGATIVE_LEADERS = [
  /^Slow\b/, /^Weak\b/, /^Poor\b/, /^Clumsy\b/, /^Prone to\b/,
  /^Sluggish\b/, /^Heavy Footsteps\b/, /^Short Sight\b/, /^Poor Hearing\b/,
  /^Devious Heart\b/, /^Slow-witted\b/, /^Stamina Depleted\b/,
  /^Thick Blood\b/, /^Rapid Absorption\b/, /^World-shaking\b/,
  /^No Load Wanted\b/, /^Suspicious Behavior\b/,
  /^Add Insult to Injury\b/, /^Born with Bad Luck\b/, /^Flame Fear\b/,
  /^Flame of Friendship\b/, /^Slow Bandaging\b/, /^Injury Worsening\b/,
  // "Soft Leather - Weak Blunt Strike" / "...Weak Pierce" / "...Weak Slash"
  // are tribe-locked defects ("DMG taken from X-type attacks +25%").
  /^Soft Leather - Weak\b/,
];

function inferPolarity({ scrapeCategory, name, curatedPolarity }) {
  // 1. Deterministic by scrape category.
  if (scrapeCategory === 'Origin') return 'origin';
  if (scrapeCategory === 'Title') return 'title';
  if (scrapeCategory === 'Preference' || scrapeCategory === 'Personality') return 'preference';
  // Tribe-locked and Experience entries are born-with traits — treated as
  // origin for polarity purposes (not counted toward the 6-positive cap and
  // not learnable from a mentor). Only green-icon positives are teachable.
  if (scrapeCategory === 'Tribe Exclusive' || scrapeCategory === 'Experience') return 'origin';
  // 2. Curated override (preserves the 31 hand-tagged negatives).
  if (curatedPolarity) return curatedPolarity;
  // 3. Body-defect keyword leaders.
  if (NEGATIVE_LEADERS.some(re => re.test(name))) return 'negative';
  // 4. Default.
  return 'positive';
}

// --- effect rollup -----------------------------------------------------------
// The current schema has a single `effect` string with all tiers rolled up
// (e.g. 'DMG +3% / +6% / +9%'). The scrape stores per-tier descriptions.
// We synthesize a rollup by: (a) preferring the curated effect if available
// (it's already nicely rolled), (b) otherwise using the highest-tier
// description from the scrape (the L1/L2/L3 numbers usually only differ in
// percentage — printing tier 3 gives the user the ceiling at a glance and
// the per-tier `tiers` field carries the full detail).
function rolledEffect(scrape, curated) {
  if (curated && curated.effect) return curated.effect;
  const tiers = scrape.tiers || {};
  // Try 3-star, 2-star, 1-star in order.
  const t = tiers['★★★'] || tiers['★★'] || tiers['★'];
  if (t && t.description) return decodeEntities(t.description);
  return null;
}

// --- main --------------------------------------------------------------------
const scrape = JSON.parse(readFileSync(SCRAPE_PATH, 'utf8'));
const curated = JSON.parse(readFileSync(CURATED_PATH, 'utf8'));

// Build lookup: lowercase name → curated record.
const curatedByName = new Map();
for (const c of curated) {
  curatedByName.set(c.name.trim().toLowerCase(), c);
}

const out = [];
const polarityCounts = { positive: 0, negative: 0, preference: 0, origin: 0, title: 0 };
const inferredNegatives = [];
const inferredPositiveSuspicious = [];

for (const s of scrape) {
  const name = decodeEntities(s.name);
  const curatedHit = curatedByName.get(name.trim().toLowerCase()) || null;
  const category = mapCategory(s.category, curatedHit && curatedHit.category);
  const polarity = inferPolarity({
    scrapeCategory: s.category,
    name,
    curatedPolarity: curatedHit && curatedHit.polarity,
  });
  polarityCounts[polarity]++;
  if (polarity === 'negative' && !curatedHit) inferredNegatives.push(name);
  // Sanity: anything that mentions defect-like words but landed positive.
  if (polarity === 'positive' && /\b(slow|weak|poor|clumsy|prone|sluggish)\b/i.test(name)) {
    inferredPositiveSuspicious.push(name);
  }

  const icon = iconFromUrl(s.iconUrl);
  const tiers = {};
  for (const [stars, t] of Object.entries(s.tiers || {})) {
    tiers[stars] = {
      slug: t.slug || null,
      description: decodeEntities(t.description || ''),
    };
  }

  out.push({
    name,
    cn_name: curatedHit ? (curatedHit.cn_name || null) : null,
    category,
    type: curatedHit ? (curatedHit.type || null) : null,
    effect: rolledEffect(s, curatedHit),
    lock: curatedHit ? (curatedHit.lock || null) : null,
    prereq: curatedHit ? (curatedHit.prereq || null) : null,
    icon,
    icon_url: s.iconUrl || null,
    polarity,
    primarySlug: s.primarySlug || null,
    tiers,
  });
}

// Sort alphabetically by name for stable diffs and easier scanning.
out.sort((a, b) => a.name.localeCompare(b.name));

writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

// --- report ------------------------------------------------------------------
console.log(`\nWrote ${out.length} talents to ${OUTPUT_PATH}\n`);
console.log('Polarity distribution:');
for (const [k, v] of Object.entries(polarityCounts)) console.log(`  ${k.padEnd(12)} ${v}`);
console.log(`\nInferred negatives (${inferredNegatives.length}, no curated override):`);
for (const n of inferredNegatives) console.log(`  • ${n}`);
if (inferredPositiveSuspicious.length) {
  console.log(`\nWarning: positive talents whose names mention defect-like words (review):`);
  for (const n of inferredPositiveSuspicious) console.log(`  ! ${n}`);
}

// --- icon-need report --------------------------------------------------------
// Print the list of icons referenced by the new catalog that are NOT yet in
// icons/ — fetch-icons.mjs reads this same logic to decide what to download.
import { readdirSync, existsSync } from 'node:fs';
const iconDir = resolve(REPO_ROOT, 'icons');
const haveIcons = new Set(existsSync(iconDir) ? readdirSync(iconDir) : []);
const missing = new Set();
for (const t of out) {
  if (t.icon && !haveIcons.has(t.icon)) missing.add(t.icon);
}
console.log(`\nIcons missing from icons/ (${missing.size}):`);
for (const m of [...missing].sort()) console.log(`  - ${m}`);
