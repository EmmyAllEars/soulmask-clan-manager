# Screenshot extraction prompt — for any Claude session

Paste the contents of this file as the first message of a Claude session, then
attach screenshots of one or more tribesmen's **Character → Ability** and
**Character → Proficiency** tabs. Claude will respond with a single
`clan-screenshot-patch-v1` JSON document you save to a file and feed to
`apply-patch.js`.

> **Why a separate prompt instead of embedding it in the CLI:** vision is
> Claude's job, not Node's. Keeping the extraction in a Claude session means
> it works in any environment with Claude available, doesn't require an API
> key in the CLI, and you can interactively correct mistakes before
> committing the patch.

---

## Prompt to paste

You are extracting structured data from screenshots of the survival game
**Soulmask**. Each tribesman in the user's clan is captured across two
screenshots:

- **Character → Ability** tab: shows the tribesman's name (top-left, with a
  `<E>` / `<Q>` etc. owner-suffix tag), title + profession line (e.g.
  "Skilled Warrior"), tribe in `<...Tribe>` brackets, "Body N" line,
  Level (e.g. 50), and the five attributes on a star: **Perception,
  Agility, Physique, Endurance, Strength**. Ignore the Recognition number —
  it changes too quickly to be worth tracking and is not part of the
  output schema.

- **Character → Proficiency** tab: shows two columns — **Production
  Crafting** and **Combat Skills** — with a `current/cap` value next to each
  row.

Your job is to emit a single JSON document with this exact schema:

```json
{
  "schema": "clan-screenshot-patch-v1",
  "extractedAt": "<ISO 8601 UTC timestamp of when you produced the patch>",
  "source": "in-game Character → Ability + Proficiency tabs",
  "tribesmen": [
    {
      "match": { "name": "<name without the <E>/<Q> suffix>" },
      "level": <int>,
      "title": "<first word of the title-profession line>",
      "profession": "<second word — must be one of: Craftsman | Porter | Laborer | Warrior | Hunter | Guard>",
      "tribe": "<the word inside <...Tribe>; just 'Wildwolf' for '<Wildwolf Tribe>'>",
      "attrs": { "Per": <int>, "Agi": <int>, "Phy": <int>, "End": <int>, "Str": <int> },
      "skills": {
        "<ClanManager skill name>": { "current": <int>, "cap": <int> },
        ...
      },
      "weapons": {
        "<weapon name>": { "current": <int>, "cap": <int> },
        ...
      }
    }
  ]
}
```

### Skill name mapping (in-game name → ClanManager name)

The Production Crafting tab uses *activity* names; ClanManager uses *worker*
names. Translate every entry through this table:

| In-game             | ClanManager   |
| ------------------- | ------------- |
| Logging             | Lumberjack    |
| Mining              | Miner         |
| Harvest             | Gatherer      |
| Plant               | Farmer        |
| Weaving             | Weaver        |
| Potting             | Potter        |
| Wood & Stone        | Carpenter     |
| Leatherworking      | Tanner        |
| Kiln                | Kiln Worker   |
| Craftsman           | Craftsman     |
| Alchemy             | Alchemist     |
| Cooking             | Cook          |
| Weapon Crafting     | Blacksmith    |
| Armor Crafting      | Armorer       |

### Weapon names

The Combat Skills tab names already match ClanManager exactly. Use them as-is:

`Spear`, `Shield`, `Dual-blade`, `Great Sword`, `Spiked Whip`, `Blade`,
`Bow`, `Gauntlets`, `Hammer`.

### Rules

1. **Strip owner-suffix tags** (`<E>`, `<Q>`, etc.) from the name before
   putting it in `match.name`.
2. **Title vs profession**: the line just under the name is e.g. "Skilled
   Warrior". Split on whitespace: first word = `title`, second = `profession`.
   Validate the second word is one of the six professions; if not, leave
   `profession` empty and put the whole string in `title`.
3. **Tribe**: from `<Wildwolf Tribe>`, emit just `"Wildwolf"`.
4. **If a screenshot is unreadable** for a particular field, omit that field
   from the patch. Don't guess. The `apply-patch.js` tool preserves existing
   values for any field absent from the patch.
5. **Body N / "Body Two" / etc.**: ignore — that's an in-game body-slot
   indicator, not stored in ClanManager.
6. **Multiple tribesmen**: append additional entries to the `tribesmen`
   array. Each tribesman should have both screenshots.
7. **Innate Talents** (the icon strip at the bottom of the Ability tab):
   ignore for this patch. Talents are managed manually via the ClanManager
   UI; the tool will not touch them.

### Output

Reply with **only the JSON document**, no explanatory prose, in a single
fenced code block. The user will save it to a file and run:

```sh
node apply-patch.js --patch <file> --existing <clan_backup.json> --out <new>
```

---

## Reference example (Andaria)

For the test clan, here's a complete patch entry. Use this exact shape and
field ordering when emitting a real patch.

```json
{
  "schema": "clan-screenshot-patch-v1",
  "extractedAt": "2026-04-28T18:10:00Z",
  "source": "in-game Character → Ability + Proficiency tabs",
  "tribesmen": [
    {
      "match": { "name": "Andaria" },
      "level": 50,
      "title": "Skilled",
      "profession": "Warrior",
      "tribe": "Wildwolf",
      "attrs": { "Per": 23, "Agi": 29, "Phy": 27, "End": 26, "Str": 23 },
      "skills": {
        "Lumberjack":  { "current": 21, "cap": 84 },
        "Miner":       { "current": 30, "cap": 89 },
        "Gatherer":    { "current": 19, "cap": 91 },
        "Farmer":      { "current": 19, "cap": 84 },
        "Weaver":      { "current": 16, "cap": 94 },
        "Potter":      { "current": 16, "cap": 93 },
        "Carpenter":   { "current": 48, "cap": 80 },
        "Tanner":      { "current": 20, "cap": 89 },
        "Kiln Worker": { "current": 21, "cap": 79 },
        "Craftsman":   { "current": 14, "cap": 77 },
        "Alchemist":   { "current": 41, "cap": 84 },
        "Cook":        { "current": 18, "cap": 79 },
        "Blacksmith":  { "current": 41, "cap": 88 },
        "Armorer":     { "current": 20, "cap": 76 }
      },
      "weapons": {
        "Spear":       { "current": 11,  "cap": 99 },
        "Blade":       { "current": 34,  "cap": 117 },
        "Shield":      { "current": 21,  "cap": 92 },
        "Bow":         { "current": 45,  "cap": 99 },
        "Dual-blade":  { "current": 115, "cap": 115 },
        "Gauntlets":   { "current": 47,  "cap": 100 },
        "Great Sword": { "current": 43,  "cap": 115 },
        "Hammer":      { "current": 38,  "cap": 117 },
        "Spiked Whip": { "current": 13,  "cap": 75 }
      }
    }
  ]
}
```
