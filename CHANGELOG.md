# Changelog

All notable changes to **Soulmask Clan Manager** are listed here. Versions
follow loose semver: a major feature ships as a minor bump (`0.5.0`), small
fixes/polish stack as patch bumps (`0.5.1`).

There are no git tags or GitHub Releases — the app iterates via PRs against
`main` and deploys straight from `main` via GitHub Pages. \`APP_VERSION\` in
`app.js` is the running number (visible in the footer, used as the cache-bust
query string for the script/style refs, and auto-filled in bug reports).

The live app is at <https://emmyallears.github.io/soulmask-clan-manager/>.

---

## v1.0.0 — Full talent catalog ([#46][])

The talent catalog grew from 253 to **551 entries**, covering every Preference,
Origin, Title, Personality, and Tribe Exclusive talent the in-game scrape
exposes.

### Added

- **Five polarity buckets** instead of two. Each gets its own border colour:
  - `positive` — default, no border tint, counts toward the 6-talent cap
  - `negative` — red, defects (e.g. Slow Pace, Weak Attack)
  - `preference` — purple/pink, Preferences and Personalities (e.g. Likes
    camel, Personality: Cautious)
  - `origin` — amber, fixed-at-birth Origin talents (e.g. Origin - Hunting)
  - `title` — blue/grey, earned Titles (e.g. Archery Master)
- **`tools/generate-talents/`** — committed Node generator that rebuilds
  `data/talents.json` from a frozen upstream scrape, plus an icon fetcher
  that downloads any missing icons (`brew install webp` required).

### Changed

- The 6-positive-talent cap now correctly excludes preferences, origins, and
  titles (none of which are chosen by the player, so they shouldn't eat
  trait slots).
- Mentor-eligibility filtering already excluded the new buckets via the
  existing `polarity === 'positive'` predicate — no change needed.
- The combined "Limb / Torso / Head / Tail Destruction" entry is split into
  four per-part records, matching the in-game data. Same for "Head / Arm /
  Torso / Thigh Stress Response" → four separate stress-response talents.

### Migration

- `STORAGE_VERSION` 2 → 3. On first load after the update, any tribesman
  talent whose name no longer exists in the new catalog (e.g. the combined
  Destruction entry) is removed from the roster, and a one-time alert
  surfaces what was pruned. The user can re-add the specific variants from
  the now-richer dropdown.

[#46]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/46

---

## v0.5.0 — Training Plans

The diagnostic-only Training Suggestions card now has a commitment counterpart:
multi-step **Training Plans** that you can build, track, and iterate on.

### Added

- **Training Plans** ([#13][] / [#15][] / [#18][] / [#19][])
  - Third top-level **Plans** view with a sortable list of every plan
    (trainee, mentors used, status, completed/total step count, total
    estimated time, created date).
  - Plan editor: name, status pill, notes, ordered list of steps with reorder
    + remove + status toggle (queued / running / completed / abandoned).
  - Three step types — **Cap Raise**, **Learn Talent**, **Upgrade Talent** —
    with mentor dropdowns auto-filtered to qualified candidates per step
    type, and gear material picker (1-5: Beast Hide → Bronze → Iron → Steel
    → Endgame).
  - Time estimation: `base_time × material_multiplier`, summed across steps,
    updates live as you tweak gear.
  - Editable Calibration panel (collapsible) for tuning the placeholder time
    constants from your own training logs.
  - Per-tribesman Plans card on the profile, split into *as trainee* and
    *as mentor* sections; ⚠ banner when a tribesman is the trainee on more
    than one active plan (in-game only allows one trainee session at a
    time).
  - **+ Add to plan** button on every Training Suggestion — pick an existing
    draft/active plan or spin up a new one in two clicks.
  - **Suggest plan** button on each profile materializes the trainee's full
    Training Suggestions list into a draft plan, ordered by impact (cap
    raises first, then learn, then upgrade), capped at 5 steps. ([#21][])
- **Duplicate tribesman** button on the profile — deep-clone with a fresh id
  and " (copy)" suffix. ([#16][])
- **Hardened Skin — Anti-Blunt** talent added to the catalog (third sibling
  of Anti-Pierce / Anti-Slash). ([#12][])
- **Roster polish:** default sort is now alphabetical by name; the Talents
  column shows actual icons (with hover tooltips) instead of just the count;
  the bootstrap roster is refreshed from the latest curated clan data; "Fatty
  Wang" renamed to "Lao Wang". ([#17][])
- **Talent info in plan steps:** Learn step lists the eligible talents the
  selected mentor brings; Upgrade step shows the picked talent's icon + level
  context; Cap-raise caption surfaces the mentor's cap on the chosen weapon.
  ([#20][])
- **Stat tooltips** on the profile Attributes card and roster column headers,
  with the in-game effect text for Perception / Agility / Physique /
  Endurance / Strength. ([#6][])
- **Sort hint** in the toolbar legend explaining that shift-click on a skill
  column sorts by current instead of cap. ([#6][])
- **JSDoc typedefs** for the data model (`Tribesman`, `TrainingPlan`,
  `TrainingStep`, `TrainingSuggestion`, `Calibration`, `AppState`, etc.) plus
  a `jsconfig.json` so VS Code's TypeScript server gives autocomplete and
  hover-types without a build step.

### Changed

- **In-app modals everywhere.** Native `prompt`/`confirm`/`alert` popups are
  gone — including the "Pick trainee by number 1..25" prompt. The Add-to-plan
  picker no longer uses radio buttons; it's two big clickable cards. Modal
  helpers respect Escape (cancel) and Enter (submit). ([#31][])
- **Storage schema bumped to v2.** Existing `version: 1` localStorage blobs
  forward-migrate on load: a `plans: []` array is injected and the blob is
  re-saved as v2. Backup JSON now round-trips plans + calibration. Reset to
  Defaults clears them along with everything else.
- Training Suggestions refactored from HTML-string output to a structured
  `getTrainingSuggestions(trainee)` plus a thin renderer, opening the door
  to the Suggest-plan auto-builder above.
- Footer version label is now a link to this changelog.

### Fixed

- Training Suggestions exclude profession/tribe-exclusive talents the
  trainee can't actually learn. ([#9][])
- Talent pill hover reveals the full name + effect for long entries. ([#11][])

[#6]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/6
[#9]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/9
[#11]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/11
[#12]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/12
[#13]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/13
[#15]: https://github.com/EmmyAllEars/soulmask-clan-manager/pull/15
[#16]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/16
[#17]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/17
[#18]: https://github.com/EmmyAllEars/soulmask-clan-manager/pull/18
[#19]: https://github.com/EmmyAllEars/soulmask-clan-manager/pull/19
[#20]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/20
[#21]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/21
[#31]: https://github.com/EmmyAllEars/soulmask-clan-manager/issues/31

---

## v0.4.x and earlier

Pre-Training-Plans history (column sort, profile prev/next, light/dark
toggle, inline-edit, exclusive-talent fix, etc.) wasn't tracked in this
file. See the [commit history][history] for the full record.

[history]: https://github.com/EmmyAllEars/soulmask-clan-manager/commits/main
