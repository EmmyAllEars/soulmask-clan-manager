# Soulmask `world.db` schema (discovery findings)

This document is the output of Phase 1 of the importer plan. It captures what we
learned from inspecting a real `world.db` pulled from a Soulmask server running
the `shifting_sands` Egypt DLC build.

**Source DB:** server `c2574836` ("Punhalla Gaming Vegetables"), Soulmask
`docker.io/venturenodellc/soulmask:shifting_sands`, fetched 2026-04-28 via
`get_file_download_url` (the new MCP tool). 42.6 MB / 13,075 rows /
SQLite 3.31.1 / `PRAGMA integrity_check = ok`.

---

## 1. SQL layout — one table

The entire game world is stored in a **single** table. There are no auxiliary
tables, views, triggers, or virtual tables.

```sql
CREATE TABLE actor_table (
  actor_serial   INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id      INTEGER NOT NULL,
  data_version   INTEGER NOT NULL,
  actor_name     TEXT,                -- unique index
  actor_level    TEXT,
  actor_script   TEXT NOT NULL,       -- the Unreal class path
  actor_owner    TEXT,                -- ALWAYS EMPTY in this dump
  actor_transf   TEXT,                -- "x,y,z|pitch,yaw,roll" position+rot
  actor_data     BLOB,                -- the UE-serialized property bag
  actor_time     TEXT
);
CREATE UNIQUE INDEX idx_actor_table_actor_name ON actor_table(actor_name);
CREATE INDEX idx_actor_table_server_id ON actor_table(server_id);
CREATE INDEX idx_actor_table_data_version ON actor_table(data_version);
CREATE INDEX idx_actor_table_actor_level ON actor_table(actor_level);
CREATE INDEX idx_actor_table_actor_script ON actor_table(actor_script);
```

**`actor_owner` is empty for all 13,075 rows.** Ownership is encoded inside
`actor_data`.

`actor_transf` is human-readable: `"x,y,z|pitch,yaw,roll"` decimal floats. Easy
win for `Tribesman.location` mapping.

---

## 2. `actor_script` taxonomy

`actor_script` is the Unreal class path of the row's actor. Distribution in this
dump:

| Bucket                                                                 | Count | Notes                                                           |
| ---------------------------------------------------------------------- | ----- | --------------------------------------------------------------- |
| `BP_BindBGCompActor`                                                   | 2,463 | Per-player "save state" component — inventory, recipes, mask    |
| `BP_DongWu_*` (动物 = animals)                                         | ~3,000+ | Wild fauna (boars, scorpions, fish, etc.)                     |
| `BP_Monster_*` (Egypt DLC)                                             | ~2,500+ | Hostile mobs                                                  |
| `BP_EgyptDLC_TribeM_*` / `BP_EgyptDLC_TribeF_*` / `BP_EgyptDLC_Exiles_*` / `BP_EgyptDLC_SandBandits_*` | ~2,280 | NPC humans (the "tribesmen" pool — wild + capturable)         |
| `BP_EgyptDLC_*_Elite_*` / `*_Boss_*`                                   | ~30    | Higher-tier NPC variants                                       |
| `BP_BGActor_JianZhu_RongQi`                                            | 134   | Container building actors                                       |
| `BP_TribeBoat_*`                                                       | 54    | Tribe boats                                                     |
| `/Script/WS.HPlayerState`                                              | 3     | Human players (one row per player who has logged in)            |
| `BP_GameModeBase_DLC` (`actor_name = 'GAMEMODE'`)                      | 1     | Single global game-mode singleton                               |
| (`actor_name = 'GAME_SETTINGS'`)                                       | 1     | Server settings singleton                                       |
| Various `BP_JianZhu_*` (建筑 = building), `BP_GongZuoTai_*` (workstations) | many  | Player-built structures                                       |

The "tribesman" pool we care about is everything under
`BluePrints/NPC/Human/`. Whether a given row is a *wild* NPC or a *captured /
recruited* one is **not** distinguishable from `actor_script` alone — the same
blueprint class is used for both states. The state lives in `actor_data`.

---

## 3. Player rows (`/Script/WS.HPlayerState`)

Three players exist in this DB:

```
actor_serial  actor_name (Steam ID)  blob_len
12231         76561197961402170      47,997
12294         76561198039989161      67,189
12686         76561197963957472      39,826
```

`actor_name` for `HPlayerState` is the player's **SteamID64**. This is the
canonical player handle.

The player's BLOB starts with property `ZhuRenGuid` (主人 GUID = "master GUID")
of type `StructProperty` — a 16-byte Unreal `FGuid`. This is the player's
internal GUID and is the value that captured tribesmen reference for ownership
(see §5).

Other notable properties seen in the player BLOB:
- `JSBaoGuoComponent` (玩家包裹 = player inventory), `DaoJuList` (道具列表 = item list)
- `EquipedMJNodeClass` (mask node class), `RMJGZ_M_10` (mask appearance variant)
- `KeJiShu` (科技树 = research tree), entries like `KJS_GJ_ShiZhi`, `JianZhu_MaoCaoLou`, `WQ_MuTou`, `ZB_*`
- `LeiJiNoXiu[Lian]` (累积训练 = cumulative training)
- `LastBeiMaJieTime`, `AlreadyKillWorldBoss`
- `BodyData`, `AttrZiDongDian` (属性自动点 = auto-allocated attribute points)
- `MorphName`, face customization

---

## 4. Wild-tribesman BLOB shape

Sample: serial 9259, `BP_EgyptDLC_TribeF_DesertWolf_C`, BLOB 3,953 bytes.
Visible ASCII property names extracted from the BLOB (decoded from Pinyin where
applicable):

| Property in BLOB        | Type           | Pinyin / 中文 / meaning                  | Tribesman field this maps to |
| ----------------------- | -------------- | ----------------------------------------- | ---------------------------- |
| `GangWeiLeiXing`        | EnumProperty   | 岗位类型 = post type                     | (used for guard/worker role) |
| `XunLuoBianHao`         | (Int)          | 巡逻编号 = patrol number                 | —                            |
| `NieLianShuJu`          | StructProperty | 捏脸数据 = face customization            | —                            |
| `MorphName`             | NameProperty   | face morph variant (e.g. `M_DLC_08`)      | —                            |
| `BaseDesaturation`, `EyeColor`, `HairColor`, `MultiBoneScale`, `L_breast`, `Height` | Float/Linear | face/body sliders | —                            |
| `ClanType`              | EnumProperty   | tribe (`CLAN_TYPE_F` etc.)               | `tribe`                      |
| `ZHIYE`                 | EnumProperty   | 职业 = profession (`ZHIYE_SHOULIE` = hunter, etc.) | **`profession`**     |
| `MANREN_BODY_*` (e.g. `_STRONG`) | EnumProperty | body type                          | `trait` (?)                  |
| `huanJingWuQi`          | EnumProperty   | 环境武器 (env weapon: `WUQI_LEIXING_MAO` = spear) | —                  |
| `HSuperAbilitySet`      | ArrayProperty  | abilities/skills set                     | **`talents`** + **`skills`** |
| paths under `Game/Blueprints/GAS/Skill/...`, `_JiuZhiPlus.G...` | ObjectProperty | skill/talent class refs (resolves through `data/talents.json`) | `talents` |
| `_Level`                | Int            | per-skill level                          | (mentor/talent level)        |
| `_Tag`                  | NameProperty   | per-skill tag                            | —                            |
| `MinJie`, `ZhiHui`, `TiZhi`, ...others (5 attribs total) | Int | 敏捷/智慧/体质 = Agi/Wis/Phy/... | **`attrs`** (Per/Agi/Phy/End/Str) |
| `AttributeValueMap`     | MapProperty    | named attribute → value (Health, Food, Water, XinQing) | (resources, not roster) |
| `Health`, `Food`, `Water`, `XinQing` (心情 = mood) | Float | live stat values     | —                            |
| `Total` / `LvSet` / `LeiJiNoXiu...` | Int | cumulative XP / training-level pool | `level`              |
| Large Hex tokens like `AD782C214D842A4FB664D792B3016F02` | (FGuid) | actor / faction / save GUIDs | (used for ownership cross-ref) |
| `BindBGCompActor`       | ObjectProperty | reference to that NPC's bind component   | —                            |
| `MorenDaoJuInit`        | (struct array) | 默认道具初始化 = default-items-init      | —                            |
| `BaoGuoComponent`       | ObjectProperty | (sub-) inventory                         | —                            |

---

## 5. Ownership: tribe vs. owner

`actor_owner` is empty everywhere, so ownership lives inside `actor_data`. We
verified by extracting all 32-char hex GUIDs from each `HPlayerState` BLOB and
cross-referencing against every other actor's BLOB.

| GUID (in HPlayerState BLOB)           | Found in N other actors | Skew                                              |
| ------------------------------------- | ----------------------- | ------------------------------------------------- |
| `75655F1A47D11D4FB61C48A38C704398`    | 568                     | 562 SavageHorn humans + 6 buildings/extras        |
| `E6010F234CCD6B4DDB90BBB6CAC6A755`    | 262                     | DesertWolf + Exiles humans                        |
| `AD782C214D842A4FB664D792B3016F02`    | 11                      | DesertWolf humans                                 |
| `306692464B02BFD9324AD6922C960D0A`    | 5                       | DesertWolf + Exiles                               |
| `DBCC38524BA7014DA64D8D9FFBE0F3FF`    | 3                       | game-mode + 2 humans                              |
| ...                                   | ...                     | ...                                               |

**Interpretation (high confidence):** the high-cardinality GUIDs (568, 262) are
**tribe / faction IDs** — the SavageHorn tribe, the DesertWolf tribe — which
each NPC stores a reference to so the game knows what faction they belong to.
The low-cardinality GUIDs (≤11) are likely **per-player capture markers** — but
note that the tribe-faction GUIDs and the player-personal GUIDs both flow
through the same field (`ZhuRenGuid` or similar). The decisive link is the
exact byte position of the GUID inside the BLOB, which requires walking the UE
property tree to know which property tag the GUID belongs to.

**For the importer, the right path is:**
1. Open each candidate tribesman row.
2. Walk its `actor_data` BLOB as a UE FProperty tag stream.
3. Read the `ZhuRenGuid` (or equivalent ownership) property.
4. Compare against the target player's `ZhuRenGuid` (read from the matching
   `HPlayerState` row's BLOB).
5. If equal → owned by that player → emit a `Tribesman` JSON.

---

## 6. The hard part — `actor_data` is UE PropertyTag-serialized binary

`actor_data` is **not** JSON, MessagePack, Protobuf, or any other portable
format. It's the standard Unreal Engine `FPropertyTag` stream produced by
`UObject::SerializeScriptProperties` (and equivalents for sub-structs and
component data). To read a value you have to walk a stream of variable-length
records that look roughly like:

```
FName   PropertyName       (length-prefixed string)
FName   PropertyType       (e.g. "IntProperty", "FloatProperty", "StructProperty",
                            "EnumProperty", "ArrayProperty", "MapProperty",
                            "NameProperty", "ObjectProperty", "BoolProperty",
                            "ByteProperty")
int32   Size               (bytes of value to follow)
int32   ArrayIndex
[type-specific tag tail]   (e.g. for StructProperty: another FName for inner struct type;
                            for EnumProperty: an FName for the enum type;
                            for ArrayProperty/MapProperty: inner-type FName(s);
                            for BoolProperty: a single byte;
                            for ByteProperty: an FName for the enum)
[Size bytes of value]
```

The stream terminates when it reads `FName == "None"`.

**Property names are Pinyin-romanized Chinese** (the game was developed in
Chinese-first, then Pinyin-tagged for the engine's name table). Many of the
fields we care about (`ZhiYe`, `MinJie`, `HSuperAbilitySet`, `ZhuRenGuid`,
`ClanType`, `XinQing`) are documented above.

### What we need

A minimal UE PropertyTag walker that:
1. Reads `FName` (4-byte signed int length, then ASCII bytes, then `\0`).
   Length zero or negative → end of stream / `None`.
2. Switches on the type FName, parses any type-specific tail, then returns the
   raw value bytes (so we can recurse into structs and arrays).
3. Stops at `None` and returns a `dict` of `{ propname: value }`.

Estimate: ~200-300 lines of clean Python (or Node, since the CLI lives in
Node). There are open-source examples for similar UE games (Palworld's
`palworld-save-tools`, Conan Exiles' DB inspectors) that share the same
underlying parser shape.

---

## 7. Practical caveats

- **No captured tribesmen on this dump.** All 2,280 NPC humans appear to be
  wild — `actor_owner` is empty everywhere, and no obvious "owner =
  player-A's-Guid" cluster is visible at first glance. The `ZhuRenGuid` field
  exists but its value for wild NPCs may be the tribe GUID, not a player's. A
  follow-up dump from a server with confirmed captures will be needed to
  validate the parser.
- **Property names use Pinyin without tone marks**, sometimes truncated, and
  occasionally embed English (`MorphName`, `Health`, `BaoGuoComponent`,
  `BindBGCompActor`). Build the property-name dictionary by inspection, not by
  guessing romanizations.
- **Some properties are deeply nested** (Map of Struct of Array) — the parser
  must support recursion, not just a flat sweep.
- **The GUID byte order on disk** is Unreal's `FGuid` struct (four little-endian
  uint32s, written `A-B-C-D`). The string form we extract via regex matches the
  on-disk hex, so equality checks are byte-for-byte.

---

## 8. RCON path (the actual viable route)

After the BLOB-parser path stalled (community has tried and largely failed; see
the Steam discussion linked in `README.md`), we tested Soulmask's built-in
RCON via the Bisect MCP `send_command` tool. **RCON solves the ownership-link
problem cleanly** — Soulmask exposes commands that produce structured text
output including ownership.

### Output capture pattern

`send_command` only sends; it doesn't return output. The server writes the
response to `/WS/Saved/Logs/WS.log` as `logServerSupervise: Display: RESPONSE:
...` lines. So the call pattern is:

1. `send_command server_id="..." command="..."`
2. Wait ~3-5 seconds
3. `read_file file="/WS/Saved/Logs/WS.log" tail_bytes=4000`
4. Parse the most recent `TRY RUN ADMIN COMMAND` block

### IMPORTANT — corrected syntax (the saraserenity docs were wrong)

The on-server `help` command (paginated; type `n` for next page) shows the
**actual** syntax. The published Soulmask RCON guides (`saraserenity.net`,
various wikis) have the wrong arg shape for several commands — they list
`InOpPlayer <value>` / `InOpGuild <value>` as if `InOpPlayer` is a keyword,
but the real syntax is purely **positional, one arg**:

```
ls  <player_account_or_pawn_uid>          # List_SameBelongingObjs
lgo <guild_name_or_guild_uid>             # List_GuildObjs
lcc [substring]                           # List_AllNPCClass
lap                                       # List_AllPlayers (no args)
lp                                        # List_OnlinePlayers (no args)
lg                                        # List_Guilds (no args)
```

**Each `lgo` invocation paginates** with an interactive prompt:

```
=========QUERY INTERACTIVE MODE========
|  PAGE:   1 of 2                     |
|  Enter any number to goto that page.|
|  Enter n to show next page.         |
|  Enter q to exit interactive mode.  |
=======================================
```

The Bisect MCP `send_command` tool opens a fresh RCON connection per call. The
server still appears to remember the per-source-IP interactive state for a few
seconds — sending `lgo <uid>` and then `n` as separate `send_command` calls
*does* return page 2.

### Confirmed-working commands (no online player needed)

| Command                  | What it returns                                                              |
| ------------------------ | ---------------------------------------------------------------------------- |
| `lap` / `List_AllPlayers`| Steam ID, player name, guild, level, total online seconds, birth             |
| `lg`  / `List_Guilds`    | guild name, **guild UID**, leader name                                       |
| `lp`  / `List_OnlinePlayers` | currently-connected players                                              |
| `dap` / `Dump_AllActorPositions` | writes `WS/Saved/ACTOR_POSI_DATA.log` (text, ~3 MB). **No ownership info** |
| `bk <name>` / `BackupDatabase` | consistent DB snapshot in-game (alternative to stop/start for fetch)    |
| **`lgo <guild_uid>` / `List_GuildObjs`** | **THE BIG ONE** — name + UID for every clan-owned object: tribesmen, vehicles, animals, buildings. Works for the whole guild, no online player required. |

### Requires an online player

`ls <steamid>` (List_SameBelongingObjs) returns `Can't find this character.`
even when the target player has logged in via the Steam client — the lookup
uses an in-memory pawn list that we couldn't reliably populate via the panel
console alone.

**This turned out to not matter:** `lgo <guild_uid>` on the *guild* gives us
everything `ls` would, since all three players in this clan share captures.
Use `lgo` and filter the result by name suffix to get per-player views (see §9
below).

---

## 9. Implementation that landed (RCON-only, no `world.db` parsing required)

The world.db pull from Phase 0 is still useful — we keep the MCP tool for the
day someone writes a UE PropertyTag parser — but **the actual importer is
RCON-only**. Steps:

### Capture (~30 seconds, no game-client login needed)

1. `send_command "lg"` — find the guild UID
2. `send_command "lgo <guild_uid>"` — page 1 of clan-owned objects
3. `send_command "n"` — page 2 (server retains interactive state per source IP for a few seconds)
4. `read_file /WS/Saved/Logs/WS.log tail_bytes=...` — extract the
   `RESPONSE: …` blocks for the two pages and concatenate them.

### Suffix decoding (clan convention)

In our test clan ("Dozenmater") the in-game name suffixes encode owner:

- `<E>` → Emmy
- `<Q>` → husband
- (no suffix, hyphenated tribe-style name, e.g. "Belvani Bone-Broth") → third clanmate
- (no suffix, plain name) → either a player character or non-tribesman entity

This is a **convention, not enforced by the game**. The CLI exposes
`--owner-suffix E` to filter, with sensible auto-exclusion for vehicles
("… Boat", "… Airship"), buildings ("… -Farm"), animals ("Cat", "Donkey",
"Boar"), and player names.

### Merge into existing roster

`tools/import-world-db/cli.js` consumes:
- the `lgo` text dump
- the user's existing `clan_backup.json`

…and produces a merged `clan_backup.json` that:
- **preserves** every existing tribesman entry's curated data (skills, talents,
  attrs, notes, location, etc.) when its UID still appears in `lgo`
- **adds skeletons** (`level: null`, empty skills/weapons/talents/attrs) for new
  captures whose UID isn't yet in the roster
- **flags renames** — by default keeps the roster's name and reports the
  mismatch (configurable via `--rename-policy adopt-lgo`)
- **marks missing UIDs as `is_body: true`** (configurable via `--no-mark-body`),
  on the assumption that a tribesman missing from `lgo` either died or was
  transferred out of the clan

The output JSON drops directly into ClanManager's existing **Restore JSON**
flow ([app.js:1313-1348](../../app.js)). No app changes required.

### Validation against real data

Tested on the Dozenmater clan's actual export (25 hand-curated entries):

| Result | Count | Detail |
| --- | --- | --- |
| unchanged | 25 | every existing entry's curated data preserved |
| added | 2 | Gerard, Boris (post-export captures) |
| renamed | 0 | clean — Fatty Wang already matches in the user's actual JSON |
| marked body | 0 | nobody dropped from clan since last hand-key |

Final roster size: 27 (was 25, +2). Output drops into "Restore JSON" without
errors.

---

## 10. Open follow-ups

- **`bk <name>` / `BackupDatabase` may eliminate the stop/start step** for the
  Phase 0 binary fetch. RCON-triggered backups should be DB-consistent without
  downtime. Worth validating.
- **A full UE PropertyTag parser remains the only path to high-fidelity
  imports** (skill levels, talent ranks, attr distributions auto-filled). If
  someone ever writes one, the field dictionary in §4 is the starting point.
  Reference Palworld's `palworld-save-tools` for a similar parser shape.
- **`Dump_AllActorPositions` is useful for spawn-point mapping** but doesn't
  help with ownership.
- **The CLI doesn't currently auto-fetch the lgo dump.** Today the user runs
  the RCON commands via Claude+MCP and pastes the response into a text file
  before invoking the CLI. A future enhancement: add an `--auto-fetch
  --server-id <id> --guild <guild_uid>` mode that drives the MCP itself. Not
  needed for the seed-and-update workflow.

