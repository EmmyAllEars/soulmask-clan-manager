# Feature: Training Plans

**Status:** Design draft. No code yet.
**Author:** Drafted with Claude · 2026-04-26
**Target version:** v0.5

## Why

Training Ground sessions are slow (a fully-leveled talent costs ~7h 46m of real
time, cap raises are similarly expensive) and have multiple ordering choices
(which weapon first, which talent to learn next, when to swap mentors). Today
the Clan Manager **diagnoses** training opportunities (the Training Suggestions
card on each profile), but the user can't **commit** to a sequence and track
progress against it.

A "Training Plan" lets Emmy:

1. Save a multi-step training agenda for a tribesman ("here's how I'm building
   Andaria over the next two weeks").
2. See projected total time and projected outcome (resulting caps, talent set).
3. Track progress as steps complete.
4. Reuse mentor pairings without re-deriving them every time.
5. See at-a-glance which plans are blocked on a mentor (e.g. Five Star Blade is
   in 3 plans — which goes first?).

This is explicitly *user-driven planning*, not full optimization. The app
suggests; the user commits.

## What a plan is

A **TrainingPlan** belongs to one trainee and contains an ordered list of
**TrainingSteps**. Each step is one Training Ground session.

Three step types, matching the three Training Ground tabs:

| Step type | Trainee | Mentor | Configures | Outcome |
|---|---|---|---|---|
| **Cap Raise** | one weapon's cap | required, must have higher cap | weapon, target cap, gear material | trainee's cap rises toward mentor's (clamped to 125 if class-weapon, else 100) |
| **Learn Talent** | a talent slot | required, must have at least one positive talent the trainee lacks | gear material, optional "preferred talent" wishlist | trainee gains one random talent (Lv I) from mentor's eligible pool |
| **Upgrade Talent** | one existing talent | required, must have same talent at higher level | weapon (if talent requires one), gear material | trainee's talent level rises by 1, sequentially |

Soulmask gear has three independent axes (visible in the Training Ground UI as
"Specify Material, Quality, and Mod"):

- **Material** — 1-5 progression: Beast Hide → Bronze → Iron → Steel → Endgame.
  **Affects training duration** — modeled here.
- **Quality** — the I-VI colored badges (gray → red). Cosmetic / stat upgrade,
  but **does not** affect duration. Not modeled.
- **Mod** — additional modifier slot. Also **does not** affect duration. Not
  modeled.

Talent levels are a separate concept (always 1-3) and live in the Upgrade
Talent step's "target Lv" field.

Step lifecycle: `draft → queued → running → completed | abandoned`.

Plan lifecycle: `draft → active → done | abandoned`. A plan is `active` when
any step is `running` or `queued`.

## Data model (proposed)

```ts
TrainingPlan = {
  id: "P_xxx",
  name: string,                  // e.g. "Andaria full kit, phase 1"
  traineeId: string,             // tribesman id
  status: "draft"|"active"|"done"|"abandoned",
  createdAt: ISO date,
  notes: string,                 // long-text
  steps: TrainingStep[],         // ordered
}

TrainingStep = {
  id: "S_xxx",
  type: "cap-raise"|"learn"|"upgrade",
  mentorId: string,              // tribesman id
  weapon?: string,               // for cap-raise and weapon-gated talents
  talent?: string,               // for upgrade and (optional wishlist) learn
  targetCap?: number,            // cap-raise: stop value, defaults to mentor's cap
  targetLevel?: number,          // upgrade: target Lv (2 or 3)
  material: 1|2|3|4|5,           // gear material tier (Beast Hide..Endgame)
  status: "queued"|"running"|"completed"|"abandoned",
  startedAt?: ISO,
  completedAt?: ISO,
  actualDurationMin?: number,    // if user logs the real duration
  note: string,
}
```

Plans live alongside `roster`, `groups`, `tags` in localStorage under
`soulmaskClan_v1`. A schema bump (`version: 2`) handles migration: existing
saves get an empty `plans: []` field.

## UI surfaces

### 1. New top-level **Plans view**

Add to topbar nav: `Roster | Profile | Plans`.

The Plans view shows every plan in a list/table:

| Plan | Trainee | Mentor(s) | Status | Steps | Est. time | Created |
|---|---|---|---|---|---|---|
| Andaria phase 1 | Andaria | Bertha, Five Star Blade | Active (2/5) | 5 | ~24h | 2026-04-26 |

Filterable by status, trainee, mentor. Click a row → Plan editor.

### 2. Plan editor

Header: name (editable), trainee (read-only after creation), notes textarea,
total estimated time, current status, action buttons (`Mark complete`,
`Abandon`, `Delete`, `Duplicate`).

Body: ordered list of steps. Each step is a card showing:
- Step number, type icon, mentor name + their relevant cap/talent
- Weapon / talent target
- Gear tier dropdown (I-VI)
- Estimated duration (auto-calculated)
- Status (with quick-toggle buttons)
- A note field

Drag-handle to reorder. `+ Add step` button at the bottom opens a step
creation modal (see below).

### 3. **Profile view → "Training Plans" card** (new)

Below the existing Training Suggestions card, list this tribesman's plans
(both as trainee AND as mentor — important to surface mentor commitments).

Each suggestion in the existing **Training Suggestions** card grows a tiny
button: `+ Add to plan`. Clicking opens a small picker:
- "Add to existing plan: [dropdown of trainee's draft/active plans]"
- "Or start a new plan"

This is the main on-ramp from suggestion → committed plan.

### 4. Step creation modal

Two-step wizard:

**Step 1 — pick step type:**
- Cap Raise
- Learn Talent
- Upgrade Talent

**Step 2 — configure:**
- For cap-raise: weapon dropdown (only weapons where trainee.cap < ceiling),
  mentor dropdown (auto-filtered to those with higher cap on that weapon),
  target cap slider (defaults to min(mentor cap, ceiling)).
- For upgrade: talent dropdown (only trainee's existing talents below Lv 3),
  mentor dropdown (auto-filtered to those with same talent at higher level),
  target level (defaults to mentor's level).
- For learn: mentor dropdown (those with positive talents trainee doesn't
  have); optional checklist of mentor's available talents marked as
  "preferred" — used only for documentation / odds display, since Learn is
  random in-game.
- Always: gear material dropdown (1-5: Beast Hide → Endgame), notes.
- Estimated duration shown live as inputs change.

## Time estimation

Bake the observed timings from the knowledge file as a constants table.
**Both gear material and step type matter; gear quality and mod do not**
(confirmed in-game).

```js
const BASE_TIMES_MIN = {
  'learn':       212,  // ~3h 32m  (Lv 1 acquired, random)
  'upgrade-1-2':  86,  // ~1h 26m
  'upgrade-2-3': 168,  // ~2h 48m
  'cap-raise':   180,  // PLACEHOLDER — needs first-hand measurement
};
// Higher gear material reduces duration. Quality (I-VI badges) and Mod
// do NOT (confirmed in-game).
const MATERIAL_MULTIPLIER = {
  1: 1.40, // Beast Hide — slow
  2: 1.15, // Bronze
  3: 1.00, // Iron       — neutral
  4: 0.85, // Steel
  5: 0.70, // Endgame    — fast
};
// All multiplier values are placeholders until measured. They are
// exposed in a small "Calibration" panel so Emmy can adjust them
// based on her own training logs.
```

Total plan time = sum of step `base * material_mult`.

When a step completes and the user fills in `actualDurationMin`, the app can
suggest recalibrating the multipliers. v1 ships with the placeholder
multipliers and a "Reset to observed" button; v2 could auto-fit.

## Integration with existing Training Suggestions

The Training Suggestions card stays. It's the **diagnostic** half. Plans are
the **commitment** half. The two link via:

- Each suggestion gets `+ Add to plan` (writes a draft step into either an
  existing plan for that trainee or a new one).
- Each plan in the Profile's Plans card gets a glance-link to the
  Suggestions that produced it (optional v2).

## Mentor scheduling (informational only, v1)

The Plans view shows a per-mentor count: "Five Star Blade is mentor in 3
active plans." A mentor can only run one Training Ground session at a time
in-game, so this is a hint that work is queued. v1 does not auto-schedule;
it just surfaces the contention.

## Auto-generated plans (v2 idea, not v1)

A "Suggest plan" button on a profile that:

1. Pulls all of the trainee's Training Suggestions.
2. Orders them by impact (cap raises beating talent learns beating talent
   upgrades, since cap raises gate weapon power; Lv 3 talents are nice-to-have
   on top).
3. Picks the highest-cap mentor for each weapon and the highest-level mentor
   for each talent.
4. Caps at ~5 steps so the plan stays scannable.
5. Drops the result as a draft plan the user can edit before committing.

Useful but not necessary for v1. Mention in the v2 tracker.

## Open questions for Emmy

1. **Cap-raise timing.** No measurement yet. The first cap-raise run (Bertha
   → Andaria Gauntlets) will give the base value. Worth logging the duration
   in the step's `actualDurationMin` to seed the constants.
2. **Material-multiplier curve.** Gear material confirmed to matter,
   magnitude unknown. Suggest Emmy run two identical talent upgrades
   back-to-back with different materials to measure (e.g. Lv 2→3 with
   Bronze then Steel on a different talent). Even one comparison gives
   an order-of-magnitude.
3. **Medicine slot.** Three potion icons in the Training Ground UI; effect
   not yet pinned down. Probably another duration multiplier or a success-
   rate boost on Learn. v1 stores it as a free-text field; v2 can quantify.
4. **What happens when a mentor levels up mid-plan and gains new talents?**
   No effect on existing steps; new "Learn from this mentor" suggestions just
   get more options. Re-runs of the Plan suggester would pick them up.
5. **Should plans persist after the trainee is deleted?** Probably no — cascade
   delete with a confirmation prompt: "Delete Andaria? She has 2 active plans,
   which will also be deleted."
6. **Does the same Training Ground constraint that limits one mentor at a
   time also limit the trainee?** I.e. can Andaria be the trainee in two
   simultaneous plans? In-game test would confirm; the UI should warn.

## v1 cut (concrete scope)

To ship a useful v1 fast:

- **In:** Plan CRUD; Cap Raise + Learn + Upgrade step types; manual gear
  material picker (1-5); static placeholder time constants (with editable
  Calibration panel); Plans view + Plan editor + Profile Plans card; `+ Add
  to plan` from suggestions; localStorage persistence with v1→v2 migration;
  CSV/JSON export including plans.
- **Out (defer):** Auto-generated plans, calibration auto-fit, mentor
  conflict resolution, gantt-style timeline, mid-plan mentor swap.

## Migration / persistence notes

- Bump localStorage schema to `version: 2`. On load, if `version === 1`,
  inject `plans: []` and re-save.
- CSV export gains three new top-level rows or a `plans.json` companion file.
  Round-tripping plans through CSV is awkward (nested step lists); JSON
  Backup remains the canonical full-state export.
- Reset to Defaults clears plans too.

## Naming the feature in the UI

Candidates: "Training Plans", "Training Queue", "Training Roadmap".
Recommend **Training Plans** — matches the in-game right-rail "Training
Plan" button label, and "plan" is the right mental model (designed
ahead, executable).

## Acceptance checklist for v1

- [ ] Can create a plan, add 3 steps of mixed types, save, reload, all
      preserved.
- [ ] Total estimated time updates as gear material changes per step.
- [ ] Profile shows the plan; the Plans view shows it; suggestions on the
      profile have a working `+ Add to plan` button.
- [ ] Marking a step complete bumps the plan's progress count.
- [ ] Deleting a tribesman cascades to delete their plans (with
      confirmation).
- [ ] CSV/JSON export includes plans without breaking import of v1-era files.
- [ ] Plans show up in dark and light themes correctly.

## What I want feedback on

- Is "trainee + mentor + step type + gear material + target" enough metadata
  per step, or am I missing a knob you'd want?
- Should I treat the in-game Training Ground's "Auto-create Upgrade Talent
  task after learning" as a single combined step in the planner, or two
  steps? (Currently modeled as two — feels cleaner.)
- Calibration UI: a single panel of editable multipliers, or a per-step
  "this took X minutes" log that auto-fits the multipliers? (v1 = panel,
  v2 = auto-fit.)
- Naming bikeshed: Training **Plans** vs Training **Queue** vs Training
  **Roadmap**?
