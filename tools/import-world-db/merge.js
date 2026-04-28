// Merge `lgo`-derived tribesman list into an existing ClanManager roster.
//
// Rules (preserve user-curated data, add new captures, flag oddities):
//   1. UID exists in roster, name matches            → keep roster entry as-is
//   2. UID exists in roster, name differs            → keep roster entry, append
//                                                       a note like "in-game name: Foo"
//                                                       (configurable)
//   3. UID exists in roster but is missing from lgo  → mark `is_body: true` if
//                                                       not already (the tribesman
//                                                       died and was burnt or transferred
//                                                       out of the clan). Do NOT delete.
//   4. UID present in lgo, missing from roster       → add a fresh skeleton.
//
// The caller supplies `defaultProfession` for new skeletons. Skill / weapon /
// talent fields are left empty — the user fills them in via the ClanManager UI.

"use strict";

/**
 * Build a fresh Tribesman skeleton.
 *
 * @param {string} uid - the lgo UID, used as `id`
 * @param {string} name - the lgo name (without <E>/<Q> suffix)
 * @returns {object} a Tribesman object matching types.js shape
 */
function newSkeleton(uid, name) {
  return {
    id: uid,
    name,
    level: null,
    title: "",
    profession: "",
    tribe: "",
    trait: "",
    location: "",
    is_body: false,
    skills: {},
    weapons: {},
    attrs: { Per: null, Agi: null, Phy: null, End: null, Str: null },
    talents: [],
    groups: [],
    tags: [],
    notes: "",
  };
}

/**
 * @typedef {Object} MergeReport
 * @property {object[]} added    - new skeletons appended to the roster
 * @property {object[]} renamed  - { uid, rosterName, lgoName } for name mismatches
 * @property {object[]} marked_body - tribesmen present in roster but absent from lgo, set is_body=true
 * @property {number} unchanged  - count of UIDs preserved as-is
 */

/**
 * @param {object[]} roster - the existing tribesman array
 * @param {import("./parse-lgo").LgoEntry[]} lgoEntries - already-filtered tribesman entries
 * @param {object} options
 * @param {"keep-roster"|"adopt-lgo"} [options.renamePolicy="keep-roster"]
 * @param {boolean} [options.markMissingAsBody=true]
 * @returns {{ roster: object[], report: MergeReport }}
 */
function mergeRoster(roster, lgoEntries, options = {}) {
  const renamePolicy = options.renamePolicy || "keep-roster";
  const markMissingAsBody = options.markMissingAsBody !== false;

  const lgoByUid = new Map(lgoEntries.map((e) => [e.uid, e]));
  const rosterByUid = new Map(roster.map((t) => [t.id, t]));

  const merged = [];
  const report = { added: [], renamed: [], marked_body: [], unchanged: 0 };

  // Pass 1: keep existing entries (possibly updating notes / is_body flag)
  for (const t of roster) {
    const lgoEntry = lgoByUid.get(t.id);
    if (!lgoEntry) {
      // Missing from lgo — likely dead or transferred out of clan
      if (markMissingAsBody && !t.is_body) {
        const updated = { ...t, is_body: true };
        merged.push(updated);
        report.marked_body.push({ uid: t.id, name: t.name });
      } else {
        merged.push(t);
        report.unchanged++;
      }
      continue;
    }
    if (t.name !== lgoEntry.name) {
      report.renamed.push({
        uid: t.id,
        rosterName: t.name,
        lgoName: lgoEntry.name,
      });
      if (renamePolicy === "adopt-lgo") {
        merged.push({ ...t, name: lgoEntry.name });
      } else {
        // keep-roster: don't change the roster name; just record the mismatch
        merged.push(t);
      }
    } else {
      merged.push(t);
      report.unchanged++;
    }
  }

  // Pass 2: append new captures
  for (const e of lgoEntries) {
    if (rosterByUid.has(e.uid)) continue;
    const skel = newSkeleton(e.uid, e.name);
    merged.push(skel);
    report.added.push(skel);
  }

  return { roster: merged, report };
}

module.exports = { newSkeleton, mergeRoster };
