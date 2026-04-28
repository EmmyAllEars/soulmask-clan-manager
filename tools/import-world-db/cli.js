#!/usr/bin/env node
// CLI: take an `lgo` text dump + an existing clan_backup.json and produce a
// merged clan_backup.json that adds new captures, flags renames, and marks
// missing-from-game entries as bodies.
//
// Usage:
//   node cli.js \
//     --lgo <path-to-lgo-dump.txt> \
//     --existing <path-to-current-clan_backup.json> \
//     --out <path-to-write-new-clan_backup.json> \
//     [--owner-suffix E]   # filter lgo to entries with " <E>" (default: include all-suffix entries; pass "" to disable filter)
//     [--rename-policy keep-roster|adopt-lgo]   # default keep-roster
//     [--no-mark-body]     # don't auto-flag missing tribesmen as bodies
//     [--dry-run]          # print the report; don't write
//     [--players <name1,name2,...>]  # extra player names to filter out (in addition to common ones)
//
// The output JSON matches the shape consumed by ClanManager's "Restore JSON"
// button (see app.js:1313/1323 — { roster, groups, tags, plans, version,
// exported }).

"use strict";

const fs = require("fs");
const path = require("path");
const { parseLgo, filterTribesmen } = require("./parse-lgo");
const { mergeRoster } = require("./merge");
const { parseTrainingLog, reduceEvents } = require("./parse-training-log");
const { applyTrainingDeltas, loadTalentCatalog } = require("./apply-training");

const STORAGE_VERSION = 2; // matches app.js STORAGE_VERSION

function parseArgs(argv) {
  const args = {
    lgo: null,
    existing: null,
    out: null,
    ownerSuffix: undefined, // undefined = no suffix filter
    renamePolicy: "keep-roster",
    markBody: true,
    dryRun: false,
    players: [],
    trainingLog: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--lgo":           args.lgo = next(); break;
      case "--existing":      args.existing = next(); break;
      case "--out":           args.out = next(); break;
      case "--owner-suffix":  args.ownerSuffix = next(); break;
      case "--rename-policy": args.renamePolicy = next(); break;
      case "--no-mark-body":  args.markBody = false; break;
      case "--dry-run":       args.dryRun = true; break;
      case "--players":       args.players = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--training-log":  args.trainingLog = next(); break;
      case "-h": case "--help":
        printHelpAndExit(0); break;
      default:
        console.error(`unknown arg: ${a}`);
        printHelpAndExit(2);
    }
  }
  if (!args.lgo || !args.existing || (!args.out && !args.dryRun)) {
    console.error("--lgo, --existing, and --out (or --dry-run) are required");
    printHelpAndExit(2);
  }
  return args;
}

function printHelpAndExit(code) {
  const usage = `Usage: node cli.js --lgo <path> --existing <path> --out <path> [options]

Options:
  --lgo            Path to a text dump of \`lgo <guild_uid>\` (pages 1+2 concatenated)
  --existing       Path to your current clan_backup.json
  --out            Where to write the merged clan_backup.json
  --owner-suffix   Filter lgo to entries whose name ends in " <X>". Default: no filter.
                   On the test clan, "<E>" = Emmy's, "<Q>" = husband's.
  --rename-policy  keep-roster (default) | adopt-lgo
                   keep-roster: ignore in-game renames, keep your existing roster names
                   adopt-lgo:   overwrite roster name with the in-game name
  --no-mark-body   Don't flag tribesmen missing from lgo as is_body=true
  --dry-run        Print the change report; don't write the output file
  --players        Comma-separated extra player names to filter out
                   (defaults already exclude common-named entities like 'Cat', 'Donkey', 'Boar', and boats/airships)
  --training-log   Path to a copy-paste of the in-game "Training ground" log.
                   When provided, weapon/skill caps and talent levels are
                   advanced based on the log events. Lines that don't match
                   are silently skipped; events for tribesmen not in the
                   merged roster are reported but not applied.

The output is consumed by ClanManager's "Restore JSON" button.`;
  console.log(usage);
  process.exit(code);
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const args = parseArgs(process.argv);

  const lgoText = fs.readFileSync(args.lgo, "utf8");
  const existing = loadJson(args.existing);

  let entries = parseLgo(lgoText);
  console.error(`[lgo] parsed ${entries.length} entries from ${path.basename(args.lgo)}`);

  if (args.ownerSuffix !== undefined && args.ownerSuffix !== "") {
    const before = entries.length;
    entries = entries.filter((e) => e.suffix === args.ownerSuffix);
    console.error(`[lgo] filtered by suffix "${args.ownerSuffix}": ${before} → ${entries.length}`);
  }

  // Always strip non-tribesman entities (vehicles, animals, players, etc.)
  const builtInPlayers = ["Emmy", "Heimart", "Aruvak Bone-Chanter", "Aruvak Bone‑Chanter"];
  const tribesmen = filterTribesmen(entries, [...builtInPlayers, ...args.players]);
  if (tribesmen.length !== entries.length) {
    console.error(`[lgo] filtered out ${entries.length - tribesmen.length} non-tribesman entities (vehicles/animals/players/buildings)`);
  }
  console.error(`[lgo] tribesman entries to merge: ${tribesmen.length}`);

  const { roster: mergedRoster, report } = mergeRoster(existing.roster || [], tribesmen, {
    renamePolicy: args.renamePolicy,
    markMissingAsBody: args.markBody,
  });

  // Print report
  console.error(`\n=== Merge report ===`);
  console.error(`  unchanged:    ${report.unchanged}`);
  console.error(`  added:        ${report.added.length}`);
  for (const t of report.added) console.error(`     + ${t.id}  ${t.name}`);
  console.error(`  renamed:      ${report.renamed.length}`);
  for (const r of report.renamed) console.error(`     ~ ${r.uid}  roster:'${r.rosterName}'  lgo:'${r.lgoName}'`);
  console.error(`  marked body:  ${report.marked_body.length}`);
  for (const m of report.marked_body) console.error(`     † ${m.uid}  ${m.name}`);
  console.error(`  → final roster size: ${mergedRoster.length}`);

  // Optionally apply training-log deltas
  if (args.trainingLog) {
    const text = fs.readFileSync(args.trainingLog, "utf8");
    const events = parseTrainingLog(text);
    const reduced = reduceEvents(events);
    const repoRoot = path.resolve(__dirname, "..", "..");
    const catalog = loadTalentCatalog(repoRoot);
    const t = applyTrainingDeltas(mergedRoster, reduced, catalog);

    console.error(`\n=== Training-log deltas ===`);
    console.error(`  events parsed:   ${events.length}`);
    console.error(`  weapon bumps:    ${t.weaponBumps.length}`);
    for (const b of t.weaponBumps) console.error(`     ⚔ ${b.tribesman}  ${b.weapon}: cap ${b.oldCap ?? "-"} → ${b.newCap}`);
    console.error(`  skill bumps:     ${t.skillBumps.length}`);
    for (const b of t.skillBumps) console.error(`     ⚒ ${b.tribesman}  ${b.skill}: cap ${b.oldCap ?? "-"} → ${b.newCap}`);
    console.error(`  talent bumps:    ${t.talentBumps.length}`);
    for (const b of t.talentBumps) console.error(`     ★ ${b.tribesman}  ${b.talent}: Lv.${b.oldLevel ?? "-"} → Lv.${b.newLevel}`);
    if (t.talentAdds.length) {
      console.error(`  talents added:   ${t.talentAdds.length}`);
      for (const a of t.talentAdds) console.error(`     + ${a.tribesman}  ${a.talent} (Lv.${a.level})`);
    }
    if (t.unmatchedNames.length) {
      console.error(`  unmatched names: ${t.unmatchedNames.length}`);
      for (const u of t.unmatchedNames) console.error(`     ? ${u.tribesman}  (no roster entry)`);
    }
    if (t.unknownTargets.length) {
      console.error(`  unknown weapon/skill targets: ${t.unknownTargets.length}`);
      for (const u of t.unknownTargets) console.error(`     ? ${u.tribesman}  [${u.target}] Lv.${u.level}  (not a known weapon or skill)`);
    }
    if (t.unknownTalents.length) {
      console.error(`  unknown talents: ${t.unknownTalents.length}`);
      for (const u of t.unknownTalents) console.error(`     ? ${u.tribesman}  [${u.talent}]  (not in data/talents.json)`);
    }
  }

  if (args.dryRun) {
    console.error(`\n[dry-run] not writing output`);
    return;
  }

  const out = {
    roster: mergedRoster,
    groups: existing.groups || [],
    tags: existing.tags || [],
    plans: existing.plans || [],
    version: existing.version || STORAGE_VERSION,
    exported: new Date().toISOString(),
  };
  if (existing.calibration !== undefined) out.calibration = existing.calibration;

  fs.writeFileSync(args.out, JSON.stringify(out, null, 2));
  console.error(`\n[ok] wrote ${args.out}`);
}

main();
