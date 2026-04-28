# generate-talents

Regenerates `data/talents.json` from a scraped catalog of all in-game talents
(`source/soulmask_talents_551.json`, sourced from soulmaskdatabase.com).

## Usage

```sh
cd tools/generate-talents
node fetch-icons.mjs   # download any missing icons (PNG → WebP via cwebp)
node build.mjs         # regenerate data/talents.json from scrape + curated overrides
```

`fetch-icons.mjs` requires `cwebp` (`brew install webp`). It is idempotent —
re-running just skips icons that already exist in `icons/`.

`build.mjs` reads `source/curated_overrides.json` (a frozen snapshot of the
original pre-issue-46 catalog) to carry forward curated fields (polarity,
finer category, cn_name, type, lock, prereq, effect rollup) for any talent
name already there. The snapshot is frozen so re-runs are idempotent — the
generator never reads its own output.

New names get heuristic polarity inference; the script prints the
inferred-negative list to stdout for manual review.

## Polarity buckets

- `positive` — standard learnable talents. Counted in the 6-positive cap.
- `negative` — defects (red border in the UI).
- `preference` — Preferences and Personality entries (purple/pink border).
- `origin` — Origin entries (amber border).
- `title` — Title entries (blue/grey border).

Origin/Title/Preference are not learnable from mentors and don't count toward
the 6-positive cap.

## Refreshing the scrape

If a future patch adds new talents:

1. Re-scrape from soulmaskdatabase.com (or wherever the upstream dataset
   lives) and overwrite `source/soulmask_talents_551.json`.
2. Re-run `fetch-icons.mjs && build.mjs`.
3. Eyeball the polarity report; if any new defect was misclassified positive,
   tweak `NEGATIVE_LEADERS` in `build.mjs` and re-run.
