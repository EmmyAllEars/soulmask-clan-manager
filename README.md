# Soulmask Clan Manager

A browser-based tribesman roster manager for Soulmask. Vanilla JS, single static page,
runs anywhere — locally, on GitHub Pages, or any static host.

**Live site:** <https://emmyallears.github.io/soulmask-clan-manager/>

> v0.0.1 — first cut, generated with Claude Cowork. Expect rough edges; please open
> issues at <https://github.com/EmmyAllEars/soulmask-clan-manager/issues>.

## Features

- **Roster view** — full table of every tribesman with all 14 work skills + 9 weapon caps
  + 5 attributes + Recognition. Profession-aligned skills bolded with a star. Cap-tier
  color coded: orange (mastery 120+) → yellow (specialist 100+) → green (Iron 90+) →
  grey (sub-Iron).
- **Profile view** — full editor for one tribesman: identity, attributes, every skill
  current/cap with progress bars, every weapon, talents, groups, tags, notes, plus
  **training partner suggestions** computed from the rest of your roster.
- **Talents** — searchable dropdown of all 252 talents (positive + negative) loaded from
  the talent catalog. Auto-suggests as you type. Hard-warns at 6 positive talents max.
- **Groups & Tags** — multi-assign per tribesman. Filter the roster by group or tag.
- **localStorage persistence** — every change saves automatically to your browser.
- **CSV import/export** — round-trip the whole roster.
- **JSON backup/restore** — full state snapshot.
- **Reset to defaults** — restores the bundled 25-tribesman starter roster.

## Quick start (local)

Just open `index.html` in a browser. Most modern browsers will let you load the talent
catalog (`data/talents.json`) and roster from disk via `file://` URLs. **However, some
browsers (notably Chrome) block `fetch()` of local JSON files for security reasons.**
If the talents dropdown is empty when you open it, that's the issue. Two fixes:

1. **Run a tiny local server.** From this folder:
   ```
   python3 -m http.server 8000
   ```
   then open <http://localhost:8000>.

2. **Deploy to GitHub Pages** (see below) and access it via the URL.

## Hosting

This repo is already deployed via GitHub Pages — see the **Live site** link at the top.
To run your own fork: Settings → Pages → Branch: `main`, folder: `/ (root)` → Save.

Your tribesman data lives in your browser's localStorage — never uploaded anywhere. The
GitHub-hosted page is just the static UI.

## File structure

```
ClanManager/
├── index.html              # markup
├── app.js                  # all logic
├── style.css               # styles
├── data/
│   ├── talents.json        # 252 talents catalog (parsed from TALENTS_REFERENCE.md)
│   └── default_roster.json # 25-tribesman starter roster
├── icons/                  # 251 talent icon WebP files
└── README.md               # this file
```

## Workflow

### Adding talents (manually, from screenshots)

1. Open a tribesman's Profile view.
2. In the Talents card, type the start of a talent name in the search box.
3. Pick from the dropdown. Set level (I/II/III). Click Add.
4. The talent appears as a pill with its icon. The 6/6 positive cap is enforced
   (warning prompt if you try to add a 7th).

### Tracking groups (workstation focus)

The "Groups" field on each tribesman is for assigning them to a workstation/role
(matching the in-game Groups feature). Examples: "Cooking Stove", "Loom",
"Carpenter Table 1", "Combat Squad A". Both filterable from the Roster view.

### Suggested Training Partners

In a tribesman's profile, the "Training Suggestions" card automatically lists:
- **Cap raises** — for each weapon, who in your roster has a higher cap that could
  mentor (within the 125 class-weapon ceiling / 100 off-class ceiling).
- **Talent upgrades** — for each talent the trainee has below Lv 3, who has the same
  talent at a higher level.
- **Talents to learn** — what positive talents other tribesmen have that this trainee
  doesn't, ranked by how high a level the mentor offers.

### CSV column format

When you Export CSV, the columns are:

```
id, name, level, title, profession, tribe, trait, location, is_body, recognition, notes,
skill_<Skill>_cur, skill_<Skill>_cap (×14),
weapon_<Weapon>_cur, weapon_<Weapon>_cap (×9),
attr_Per, attr_Agi, attr_Phy, attr_End, attr_Str,
groups, tags, talents
```

`groups` and `tags` are pipe-separated (`group1|group2`).
`talents` are pipe-separated `Name@Level` pairs (`Swift Pace@2|Dual-blade DMG Increase@3`).

When you Import CSV, the same format is expected. Rows missing fields use defaults.
**Import REPLACES the entire roster.** Use JSON Backup before importing if you want
to be safe.

## Mechanics references baked into the app

- **Profession → best skills** (for the highlighting):
  - Laborer → Lumberjack/Miner/Gatherer/Farmer
  - Porter (杂工) → Weaver/Potter/Carpenter/Tanner/Kiln Worker
  - Craftsman → Craftsman/Alchemist/Cook/Blacksmith/Armorer
- **Profession → class weapons** (training ceiling 125):
  - Warrior → Dual-blade/Hammer/Blade/Great Sword/Gauntlets
  - Hunter → Bow/Dual-blade/Blade/Spear/Gauntlets/Spiked Whip
  - Guard → Shield/Bow/Blade/Great Sword/Spear
- **Cap tiers**: 30=Stone, 60=Bronze, 90=Iron, 120=Mastery
- **Talent level ceiling**: III (3). No higher.
- **Positive talent count**: 6 max per tribesman.

## Known limitations / next-up

- No undo. Edits are committed to localStorage immediately.
- Talent icons load from `icons/` relative to the page; if hosted elsewhere, copy
  that folder along.
- Training Suggestions only consider tribesmen in this roster. Add high-cap mentors
  before they show up as suggestions.
- The "auto-detect from screenshot" feature would be a nice future addition; for
  now talents are added manually via the dropdown.
