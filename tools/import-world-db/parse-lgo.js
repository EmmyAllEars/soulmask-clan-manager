// Parse the text output of Soulmask's `lgo <guild_uid>` RCON command into a
// list of { name, uid, suffix } records.
//
// Each row in the output looks like:
//   |             'Andaria <E>' | AD41LS8M7FDBQV6IHZX9G9NGU |
// or:
//   |          'Hunter N 1 <Q>' | 9GM5T6GTESKAMTNH72KLACG6W |
// or:
//   |    'Belvani Bone‑Broth' | 2P4R766JCAERYBKHNRSX97SLT |
//
// The header row and the interactive-mode footer block are ignored.
// Pages 1 and 2 of a paginated lgo response can be concatenated as input.
//
// `<E>` and `<Q>` suffixes encode owner-shorthand on this server:
//   <E> → Emmy's tribesmen
//   <Q> → husband's tribesmen
//   (no suffix, hyphenated tribe-style name) → third clanmate's tribesmen
//   (no suffix, also includes player names + vehicles + animals)
// The CLI consumer is responsible for filtering by suffix.

"use strict";

const ROW_RE = /^\|\s*'([^']+)'\s*\|\s*([A-Z0-9]{20,})\s*\|\s*$/;
const SUFFIX_RE = /\s*<([A-Z])>\s*$/;

/**
 * @typedef {Object} LgoEntry
 * @property {string} rawName  - exact name as printed (e.g. "Andaria <E>", "Hunter N 1 <Q>")
 * @property {string} name     - rawName with the trailing suffix (and surrounding whitespace) stripped
 * @property {string|null} suffix  - "E", "Q", or null if absent
 * @property {string} uid      - the 25-ish-char alphanumeric UID
 */

/**
 * Parse a multi-line lgo response into entries.
 * @param {string} text - the raw RCON output
 * @returns {LgoEntry[]}
 */
function parseLgo(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const rawName = m[1].trim();
    const uid = m[2];
    if (rawName === "Name") continue; // header row
    const suffixMatch = SUFFIX_RE.exec(rawName);
    const suffix = suffixMatch ? suffixMatch[1] : null;
    const name = suffix ? rawName.replace(SUFFIX_RE, "").trim() : rawName;
    entries.push({ rawName, name, suffix, uid });
  }
  return entries;
}

/**
 * Filter entries that look like *tribesmen*, excluding vehicles, buildings,
 * pets, and player characters.
 *
 * Heuristics — based on what `lgo` returns for the test clan ("Dozenmater"):
 *  - Vehicles end with "Boat" or "Airship"
 *  - "Cat", "Donkey", "Boar" — animals owned by the clan (mounts/livestock)
 *  - Names that contain "-Farm" — buildings (e.g. "Creas Marrow-Farm")
 *  - Player human names match the playerNames set (passed in)
 *  - Items like "Emmy's MaoXian" — possessive pet/object
 *  - Everything else: tribesman
 *
 * @param {LgoEntry[]} entries
 * @param {string[]} playerNames  - names from `lap` (List_AllPlayers) to exclude
 * @returns {LgoEntry[]}
 */
function filterTribesmen(entries, playerNames = []) {
  const playerSet = new Set(playerNames.map((n) => n.toLowerCase()));
  const animalNames = new Set(["cat", "donkey", "boar", "horse", "ostrich"]);
  return entries.filter((e) => {
    const lower = e.name.toLowerCase();
    if (playerSet.has(lower)) return false;
    if (lower.endsWith(" boat") || lower.endsWith(" airship")) return false;
    if (lower.includes("-farm")) return false;
    if (animalNames.has(lower)) return false;
    if (lower.endsWith("'s maoxian")) return false; // "Emmy's MaoXian" pet
    return true;
  });
}

module.exports = { parseLgo, filterTribesmen };
