#!/usr/bin/env node
// Apply a screenshot-extracted "tribesman patch" JSON to a ClanManager roster.
//
// The patch is produced by Claude (or any vision-capable model) reading the
// in-game Character → Ability and Character → Proficiency tabs. See
// EXTRACT_PROMPT.md for the documented extraction prompt and skill name map.
//
// Patch shape:
//   {
//     "schema": "clan-screenshot-patch-v1",
//     "tribesmen": [
//       {
//         "match": { "id": "<UID>", "name": "<name>" },   // either is fine; id wins
//         "level": 50,
//         "title": "Skilled",
//         "profession": "Warrior",
//         "tribe": "Wildwolf",
//         "attrs": { "Per": 23, "Agi": 29, "Phy": 27, "End": 26, "Str": 23 },
//         "skills":  { "Lumberjack": { "current": 21, "cap": 84 }, ... },
//         "weapons": { "Spear":      { "current": 11, "cap": 99 }, ... }
//       },
//       ...
//     ]
//   }
//
// Merge rules:
//   - Top-level scalar fields (level, title, profession, tribe):
//     overwrite if present in the patch, otherwise leave alone.
//   - attrs: replaced wholesale if present.
//   - skills / weapons: per-key deep merge — only the keys the patch has are
//     touched. Existing skills/weapons absent from the patch are preserved.
//     Within a cell, undefined fields don't overwrite (so a patch with only
//     {cap: 84} preserves the existing current value).
//   - is_body, location, notes, groups, tags, talents: NEVER touched. Those
//     are user-curated and the screenshots can't represent them.
//
// Usage:
//   node apply-patch.js \
//     --patch <path-to-patch.json> \
//     --existing <clan_backup.json> \
//     --out <merged.json> \
//     [--dry-run]

"use strict";

const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "clan-screenshot-patch-v1";

function parseArgs(argv) {
  const args = { patch: null, existing: null, out: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--patch":     args.patch = next(); break;
      case "--existing":  args.existing = next(); break;
      case "--out":       args.out = next(); break;
      case "--dry-run":   args.dryRun = true; break;
      case "-h": case "--help": printHelpAndExit(0);
      default:
        console.error(`unknown arg: ${a}`);
        printHelpAndExit(2);
    }
  }
  if (!args.patch || !args.existing || (!args.out && !args.dryRun)) {
    console.error("--patch, --existing, and --out (or --dry-run) are required");
    printHelpAndExit(2);
  }
  return args;
}

function printHelpAndExit(code) {
  console.log(`Usage: node apply-patch.js --patch <file> --existing <file> --out <file> [--dry-run]

Apply a screenshot-extracted patch JSON to a ClanManager roster.

Options:
  --patch     Path to the patch JSON (clan-screenshot-patch-v1).
  --existing  Path to the current clan_backup.json.
  --out       Path to write the patched clan_backup.json.
  --dry-run   Print the change report; don't write the output file.

See EXTRACT_PROMPT.md for how to produce the patch JSON from screenshots.`);
  process.exit(code);
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * Find the roster entry that a patch entry refers to. Prefers `match.id`,
 * falls back to case-insensitive `match.name`.
 */
function findTarget(roster, match) {
  if (!match) return null;
  if (match.id) {
    const byId = roster.find((t) => t.id === match.id);
    if (byId) return byId;
  }
  if (match.name) {
    const lower = match.name.toLowerCase();
    return roster.find((t) => t.name && t.name.toLowerCase() === lower) || null;
  }
  return null;
}

/**
 * Merge a single patch entry into the matching roster entry, in place.
 * Returns a list of changed-field descriptors for reporting.
 */
function applyOne(target, patch) {
  const changes = [];
  const setIfDifferent = (key) => {
    if (!(key in patch)) return;
    if (target[key] !== patch[key]) {
      changes.push({ field: key, from: target[key], to: patch[key] });
      target[key] = patch[key];
    }
  };
  setIfDifferent("level");
  setIfDifferent("title");
  setIfDifferent("profession");
  setIfDifferent("tribe");

  if (patch.attrs && typeof patch.attrs === "object") {
    target.attrs = target.attrs || {};
    for (const k of ["Per", "Agi", "Phy", "End", "Str"]) {
      if (k in patch.attrs && target.attrs[k] !== patch.attrs[k]) {
        changes.push({ field: `attrs.${k}`, from: target.attrs[k], to: patch.attrs[k] });
        target.attrs[k] = patch.attrs[k];
      }
    }
  }

  if (patch.skills && typeof patch.skills === "object") {
    target.skills = target.skills || {};
    for (const [name, cell] of Object.entries(patch.skills)) {
      const cur = target.skills[name] || { current: null, cap: null };
      const merged = { current: cur.current, cap: cur.cap };
      if (cell.current !== undefined && merged.current !== cell.current) {
        changes.push({ field: `skills.${name}.current`, from: merged.current, to: cell.current });
        merged.current = cell.current;
      }
      if (cell.cap !== undefined && merged.cap !== cell.cap) {
        changes.push({ field: `skills.${name}.cap`, from: merged.cap, to: cell.cap });
        merged.cap = cell.cap;
      }
      target.skills[name] = merged;
    }
  }

  if (patch.weapons && typeof patch.weapons === "object") {
    target.weapons = target.weapons || {};
    for (const [name, cell] of Object.entries(patch.weapons)) {
      const cur = target.weapons[name] || { current: null, cap: null };
      const merged = { current: cur.current, cap: cur.cap };
      if (cell.current !== undefined && merged.current !== cell.current) {
        changes.push({ field: `weapons.${name}.current`, from: merged.current, to: cell.current });
        merged.current = cell.current;
      }
      if (cell.cap !== undefined && merged.cap !== cell.cap) {
        changes.push({ field: `weapons.${name}.cap`, from: merged.cap, to: cell.cap });
        merged.cap = cell.cap;
      }
      target.weapons[name] = merged;
    }
  }

  return changes;
}

function main() {
  const args = parseArgs(process.argv);
  const patch = loadJson(args.patch);
  const existing = loadJson(args.existing);

  if (patch.schema && patch.schema !== SCHEMA_VERSION) {
    console.error(`warning: patch schema "${patch.schema}" — expected "${SCHEMA_VERSION}"`);
  }
  if (!Array.isArray(patch.tribesmen)) {
    console.error("patch is missing a `tribesmen` array");
    process.exit(2);
  }
  if (!Array.isArray(existing.roster)) {
    console.error("existing is missing a `roster` array");
    process.exit(2);
  }

  console.error(`=== Apply patch ===`);
  console.error(`  patch:      ${path.basename(args.patch)}  (${patch.tribesmen.length} entries)`);
  console.error(`  existing:   ${path.basename(args.existing)}  (${existing.roster.length} tribesmen)`);
  console.error("");

  const unmatched = [];
  let totalChanges = 0;
  for (const entry of patch.tribesmen) {
    const target = findTarget(existing.roster, entry.match);
    if (!target) {
      unmatched.push(entry.match);
      console.error(`  ? unmatched: ${JSON.stringify(entry.match)}`);
      continue;
    }
    const changes = applyOne(target, entry);
    totalChanges += changes.length;
    if (changes.length === 0) {
      console.error(`  · ${target.name} (${target.id})  no changes`);
      continue;
    }
    console.error(`  ✎ ${target.name} (${target.id})  ${changes.length} change(s):`);
    for (const c of changes) {
      const fmt = (v) => (v === null || v === undefined ? "—" : JSON.stringify(v));
      console.error(`       ${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`);
    }
  }

  console.error("");
  console.error(`  total changes: ${totalChanges}`);
  if (unmatched.length) console.error(`  unmatched:     ${unmatched.length}`);

  if (args.dryRun) {
    console.error(`\n[dry-run] not writing output`);
    return;
  }

  const out = {
    ...existing,
    roster: existing.roster, // already mutated in place
    exported: new Date().toISOString(),
  };
  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.error(`\n[ok] wrote ${args.out}`);
}

main();
