# import-world-db — refresh ClanManager from a live Soulmask server

A standalone Node CLI that takes the output of two Soulmask RCON commands plus
your existing `clan_backup.json` and produces an updated `clan_backup.json`
that:

- adds new captures (tribesmen present in the game but missing from your
  roster) as blank skeletons;
- preserves every curated field on existing tribesmen (skills, talents,
  attrs, notes, location, etc.);
- optionally bumps weapon proficiency caps and talent levels using a
  copy-paste of the in-game **Training ground** log;
- flags roster entries that no longer appear in the clan as `is_body: true`
  (configurable; assumes "absent from clan" means "died and was burnt").

The output drops directly into ClanManager's existing **Restore JSON** flow
(`app.js:1313-1348`). No app changes required.

## Why the name `import-world-db`

The original plan was to read `world.db` (the server's SQLite save) directly
and parse out captures. That hit two walls:

1. The interesting data lives in a UE-PropertyTag-serialized BLOB (`actor_data`)
   with Pinyin field names. The Soulmask community has tried and largely
   failed to parse it.
2. Even with the BLOB, ownership isn't expressed cleanly — wild NPCs and
   captured ones share the same blueprint class and the same SQL columns.

The path that actually worked is the game's own RCON output. We kept the
folder name because the (still-useful) Bisect MCP `get_file_download_url` tool
was developed alongside it, and `schema.md` documents the discovery findings
in case someone returns to the BLOB-parser idea.

## Setup (no install needed)

The CLI is plain Node — uses the standard library only. No `npm install`.

```sh
cd tools/import-world-db
node cli.js --help
```

Requires Node 18+. Tested on Node 22.

## End-to-end workflow

You'll need three text files: an `lgo` dump, your current `clan_backup.json`,
and (optionally) a copy-paste of the in-game training log.

### 1. Capture the clan roster via RCON (~30 seconds)

In a Claude session with the [Bisect Hosting Starbase MCP](https://github.com/EmmyAllEars/BisectHosting-Starbase-MCP)
configured, ask Claude to:

```
1. Call mcp__Bisect_Hosting_Starbase__send_command with command="lg" to get the guild UID.
2. Call send_command with command="lgo <guild_uid>".
3. Wait ~3 seconds.
4. Call send_command with command="n" to get page 2 (server retains pagination state per source IP for a few seconds).
5. read_file /WS/Saved/Logs/WS.log tail_bytes=30000.
6. Extract the two RESPONSE: blocks and concatenate them into a single text file.
```

The result is a text dump where each tribesman / vehicle / animal row looks like:

```
|             'Andaria <E>' | AD41LS8M7FDBQV6IHZX9G9NGU |
|       'Craftsman M 1 <Q>' | CEFCV8PYUSZZQHAE5EUFGMQ76 |
|     'Belvani Bone-Broth' | 2P4R766JCAERYBKHNRSX97SLT |
```

Save the concatenated dump to e.g. `/tmp/lgo-full.txt`.

> **Naming convention** (from the Dozenmater clan we tested against):
> `<E>` = Emmy's tribesmen, `<Q>` = her husband's, hyphenated tribe-style
> names = third clanmate's. The CLI's `--owner-suffix E` filter relies on
> this convention; for clans with different naming, leave it off and pass
> additional `--players` names if needed.

### 2. (Optional) Capture the training log

In game, open **Training ground → Training Log**, scroll to cover the period
since your last roster export, and copy the text into a file (e.g.
`/tmp/training.txt`). The CLI looks for two phrasings:

```
... successfully raised the proficiency cap of [<weapon-or-skill>] to Lv.<n> ...
... successfully upgraded the talent [<talent>] Lv.<x> to [<talent>] Lv.<y> ...
```

Other rows ("added a training task", "has been completed", "modified") are
ignored.

### 3. Run the importer

```sh
node cli.js \
  --lgo /tmp/lgo-full.txt \
  --existing /path/to/your/clan_backup.json \
  --out /path/to/clan_backup_merged.json \
  --owner-suffix E \
  --training-log /tmp/training.txt
```

The CLI prints a change report to stderr:

```
=== Merge report ===
  unchanged:    25
  added:        2
     + 2X2B72IRRDP2PLZI6JZ4EU5MV  Gerard
     + 3XK80TAXKJ7JN5XE92HQA5OF5  Boris
  renamed:      0
  marked body:  0
  → final roster size: 27

=== Training-log deltas ===
  events parsed:   13
  weapon bumps:    1
     ⚔ Andaria  Blade: cap 105 → 117
  skill bumps:     0
  talent bumps:    0
```

`--dry-run` skips writing the output and just prints the report.

### 4. Load it in ClanManager

Open ClanManager in the browser and use the existing **Restore JSON** button
(top-right toolbar). Pick the file the CLI wrote.

## All flags

```
--lgo            Path to the lgo text dump (required).
--existing       Path to your current clan_backup.json (required).
--out            Where to write the merged clan_backup.json
                 (required unless --dry-run).
--owner-suffix   Filter lgo to entries whose name ends in " <X>", e.g. E or Q.
                 Default: no filter (every clan-owned thing).
--rename-policy  keep-roster (default) | adopt-lgo
                 keep-roster: don't overwrite roster names with in-game names
                 adopt-lgo:   overwrite. Use when you've renamed a tribesman
                              in-game and want the change reflected.
--no-mark-body   Don't auto-flag tribesmen missing from lgo as is_body=true.
                 Default behavior assumes "missing from lgo" = died and burnt.
--dry-run        Print the report; don't write the output file.
--players        Comma-separated extra player names to filter out (defaults
                 already exclude vehicles, "Cat", "Donkey", "Boar", and the
                 three players in the Dozenmater test clan).
--training-log   Path to a copy-paste of the in-game Training ground log.
                 Applies weapon-cap and talent-level deltas to the merged
                 roster.
```

## What the CLI doesn't do

- Auto-fetch the lgo dump or training log. The MCP commands are simple enough
  that you (or Claude) can run them directly; baking that into the CLI would
  add MCP coupling without much benefit.
- Update `level`, attribute points (Per/Agi/Phy/End/Str), or skill *current*
  values. Those live only in the BLOB.
- Touch the existing roster's `notes`, `groups`, `tags`, `title`, `location`,
  or `tribe`. Those are user-curated.
- Backfill the `<unknown>` profession or `tribe` for new captures. The
  skeletons land empty; you fill them in via the UI.

## Refreshing skills, weapons, and stats from screenshots

`cli.js` plus the training log handle the *roster shape* — who's in the clan,
what their cap is on every weapon you've trained, who's new, who died. But
**level, the 5 attributes (Per/Agi/Phy/End/Str), and every skill `current`
value live only in the BLOB**, which we can't parse. Updating those requires
two screenshots per tribesman: their **Character → Ability** tab and
**Character → Proficiency** tab.

Workflow:

1. In-game, tab through your tribesmen. For each, capture both tabs.
2. Open a fresh Claude session, paste the contents of
   [`EXTRACT_PROMPT.md`](EXTRACT_PROMPT.md), and attach the screenshots.
3. Claude returns a single `clan-screenshot-patch-v1` JSON document. Save it
   to e.g. `/tmp/patch.json`.
4. Apply it:

   ```sh
   node apply-patch.js \
     --patch /tmp/patch.json \
     --existing /path/to/clan_backup.json \
     --out /path/to/clan_backup_patched.json
   ```

5. Load the patched JSON via **Restore JSON** in ClanManager.

The patch tool only touches fields the patch contains. Talents, notes,
groups, tags, location, `is_body` — anything user-curated — is preserved.

> **Validated end-to-end on Andaria.** A single patch produced 28 changes:
> 22 previously-blank skill / weapon `current` values populated, 4 cap
> corrections (the manual entries had drifted), and 2 attribute corrections.

## Files

```
tools/import-world-db/
  cli.js                 - argument parsing + orchestration for the lgo / training-log flow
  parse-lgo.js           - regex parser for lgo output rows
  merge.js               - merge logic (unchanged / added / renamed / marked-body)
  parse-training-log.js  - regex parser for in-game Training ground log events
  apply-training.js      - apply parsed training deltas to a roster
  apply-patch.js         - apply a screenshot-extracted patch to a roster
  EXTRACT_PROMPT.md      - vision prompt to paste into a Claude session for screenshot extraction
  schema.md              - what we learned about world.db, Soulmask BLOBs, and RCON
  README.md              - this file
```
