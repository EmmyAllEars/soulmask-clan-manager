#!/usr/bin/env node
// Preprocess Soulmask Character-tab screenshots before vision extraction.
//
// Why this exists: macOS retina screenshots are 3456×2234. When fed to a
// vision model, the image is downsampled aggressively, and the small
// `current/cap` numbers in the Proficiency tab (~14px tall in source)
// collapse into ambiguous blobs — 1/7, 3/8, 5/6 confusions become routine.
//
// Cropping out the character model and the right-side detail rail
// shrinks the source to the data-bearing region only. Same downsample
// budget, but every output pixel now lands on a number worth reading.
// Validated on the 2026-04-28 clan refresh: a single Atalanta proficiency
// crop surfaced 8 misreads from the previous full-image pass (e.g.
// Dual-blade 10→61, Great Sword 33→21).
//
// Crop bounds are tuned for 3456×2234 retina screenshots of the Character
// → Ability and Character → Proficiency tabs at default UI zoom. If your
// monitor resolution differs, override with --abil-crop / --prof-crop
// (each takes "W:H:X:Y" as ffmpeg's crop filter expects).
//
// Workflow:
//   1. In game, tab through tribesmen capturing Ability + Proficiency for
//      each. Two screenshots per tribesman.
//   2. Run this tool against the screenshot folder.
//   3. Feed the cropped output folder to a Claude session with
//      EXTRACT_PROMPT.md.
//
// Usage:
//   node preprocess-screenshots.js \
//     --in  "/path/to/raw/screenshots" \
//     --out "/path/to/cropped" \
//     [--mode alternating|ability|proficiency] \
//     [--abil-crop W:H:X:Y] \
//     [--prof-crop W:H:X:Y]
//
// Modes:
//   alternating (default) — sorts files by filename and assumes the
//     pattern Ability, Proficiency, Ability, Proficiency, … For Mac
//     screenshots named `Screenshot YYYY-MM-DD at H.MM.SS PM.png` the
//     filename sort matches capture order.
//   ability      — every input is treated as an Ability tab.
//   proficiency  — every input is treated as a Proficiency tab.

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_ABIL_CROP = "1900:1100:1100:80";
const DEFAULT_PROF_CROP = "1500:2050:1100:80";

function parseArgs(argv) {
  const args = {
    in: null,
    out: null,
    mode: "alternating",
    abilCrop: DEFAULT_ABIL_CROP,
    profCrop: DEFAULT_PROF_CROP,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--in":         args.in = next(); break;
      case "--out":        args.out = next(); break;
      case "--mode":       args.mode = next(); break;
      case "--abil-crop":  args.abilCrop = next(); break;
      case "--prof-crop":  args.profCrop = next(); break;
      case "-h": case "--help": printHelpAndExit(0);
      default:
        console.error(`unknown arg: ${a}`);
        printHelpAndExit(2);
    }
  }
  if (!args.in || !args.out) {
    console.error("--in and --out are required");
    printHelpAndExit(2);
  }
  if (!["alternating", "ability", "proficiency"].includes(args.mode)) {
    console.error(`--mode must be alternating|ability|proficiency, got "${args.mode}"`);
    process.exit(2);
  }
  return args;
}

function printHelpAndExit(code) {
  console.log(`Usage: node preprocess-screenshots.js --in <dir> --out <dir> [options]

Crop Soulmask Character-tab screenshots to the data-bearing region only,
producing denser images that survive vision-model downsampling.

Required:
  --in <dir>           Source folder of .png screenshots.
  --out <dir>          Destination folder for cropped output (created if missing).

Options:
  --mode <m>           alternating | ability | proficiency  (default: alternating)
                       alternating: filename-sorted, A-P-A-P-... pairing.
  --abil-crop W:H:X:Y  Override Ability-tab crop. Default: ${DEFAULT_ABIL_CROP}
  --prof-crop W:H:X:Y  Override Proficiency-tab crop. Default: ${DEFAULT_PROF_CROP}
                       (tuned for 3456×2234 retina screenshots)`);
  process.exit(code);
}

function ensureFfmpeg() {
  const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (r.error || r.status !== 0) {
    console.error("ffmpeg is required but not found on PATH. Install via `brew install ffmpeg` (macOS).");
    process.exit(1);
  }
}

function listPngs(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort()
    .map((f) => path.join(dir, f));
}

function crop(input, output, region) {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", input, "-vf", `crop=${region}`, "-loglevel", "error", output],
    { stdio: ["ignore", "inherit", "inherit"] }
  );
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed for ${path.basename(input)}`);
  }
}

function main() {
  const args = parseArgs(process.argv);
  ensureFfmpeg();

  if (!fs.existsSync(args.in)) {
    console.error(`--in does not exist: ${args.in}`);
    process.exit(2);
  }
  fs.mkdirSync(args.out, { recursive: true });

  const inputs = listPngs(args.in);
  if (inputs.length === 0) {
    console.error(`no .png files found in ${args.in}`);
    process.exit(1);
  }

  console.error(`=== Preprocess screenshots ===`);
  console.error(`  in:    ${args.in}  (${inputs.length} files)`);
  console.error(`  out:   ${args.out}`);
  console.error(`  mode:  ${args.mode}`);
  console.error(`  abil:  crop=${args.abilCrop}`);
  console.error(`  prof:  crop=${args.profCrop}`);
  console.error("");

  let abilCount = 0;
  let profCount = 0;
  for (let i = 0; i < inputs.length; i++) {
    const src = inputs[i];
    const base = path.basename(src);
    let region, tabLabel;
    if (args.mode === "ability") {
      region = args.abilCrop;
      tabLabel = "abil";
    } else if (args.mode === "proficiency") {
      region = args.profCrop;
      tabLabel = "prof";
    } else {
      // alternating: even index → ability, odd → proficiency
      if (i % 2 === 0) {
        region = args.abilCrop;
        tabLabel = "abil";
      } else {
        region = args.profCrop;
        tabLabel = "prof";
      }
    }
    const out = path.join(args.out, base.replace(/\.png$/i, `.${tabLabel}.png`));
    try {
      crop(src, out, region);
      if (tabLabel === "abil") abilCount++;
      else profCount++;
      console.error(`  ✎ ${base}  →  ${path.basename(out)}  [${tabLabel}]`);
    } catch (e) {
      console.error(`  ✗ ${base}  ${e.message}`);
    }
  }

  console.error("");
  console.error(`  ability-cropped:    ${abilCount}`);
  console.error(`  proficiency-cropped: ${profCount}`);
  console.error(`\n[ok] ${args.out}`);
}

main();
