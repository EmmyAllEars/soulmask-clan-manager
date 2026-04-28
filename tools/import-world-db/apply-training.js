// Apply parsed training-log deltas to a roster (mutates each tribesman's
// weapons / skills / talents).
//
// The training log uses square-bracketed names like [Blade], [Lumberjack],
// [Throw Dodge]. ClanManager's data model splits these across three buckets:
//   - weapons (9): Spear, Shield, Dual-blade, Great Sword, Spiked Whip, Blade,
//     Bow, Gauntlets, Hammer
//   - skills  (14): Lumberjack, Miner, Gatherer, Farmer, Weaver, Potter,
//     Carpenter, Tanner, Kiln Worker, Craftsman, Alchemist, Cook,
//     Blacksmith, Armorer
//   - talents (~250, see data/talents.json)
//
// The classifier first checks weapons (smallest set, exact match), then
// skills, then falls through to "unknown". Unknown caps are reported but not
// applied — the user reviews them by hand.

"use strict";

const fs = require("fs");
const path = require("path");

const WEAPONS = new Set([
  "Spear", "Shield", "Dual-blade", "Great Sword", "Spiked Whip",
  "Blade", "Bow", "Gauntlets", "Hammer",
]);
const SKILLS = new Set([
  "Lumberjack", "Miner", "Gatherer", "Farmer", "Weaver", "Potter",
  "Carpenter", "Tanner", "Kiln Worker", "Craftsman", "Alchemist",
  "Cook", "Blacksmith", "Armorer",
]);

function loadTalentCatalog(repoRoot) {
  // talents.json sits at <repoRoot>/data/talents.json relative to this tool.
  const p = path.join(repoRoot, "data", "talents.json");
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const arr = Array.isArray(data) ? data : data.talents || [];
    const byName = new Map();
    for (const t of arr) {
      if (t && t.name) byName.set(t.name, t);
    }
    return byName;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} TrainingApplyReport
 * @property {object[]} weaponBumps   - { tribesman, weapon, oldCap, newCap }
 * @property {object[]} skillBumps    - { tribesman, skill, oldCap, newCap }
 * @property {object[]} talentBumps   - { tribesman, talent, oldLevel, newLevel }
 * @property {object[]} talentAdds    - { tribesman, talent, level } when not already on tribesman
 * @property {object[]} unmatchedNames - { tribesman } when no roster entry found
 * @property {object[]} unknownTargets - { tribesman, target, level } cap event whose target isn't a known weapon/skill
 * @property {object[]} unknownTalents - { tribesman, talent } when talent name isn't in the catalog
 */

/**
 * Apply reduced training-log events to a roster (mutates).
 *
 * @param {object[]} roster - Tribesman array
 * @param {Map} reducedEvents - output of parseTrainingLog/reduceEvents
 * @param {Map<string, object>|null} talentCatalog - name → talent meta (for icon lookup)
 * @returns {TrainingApplyReport}
 */
function applyTrainingDeltas(roster, reducedEvents, talentCatalog) {
  const report = {
    weaponBumps: [], skillBumps: [], talentBumps: [], talentAdds: [],
    unmatchedNames: [], unknownTargets: [], unknownTalents: [],
  };

  // Index roster by name (case-insensitive). If duplicates, the first wins.
  const byName = new Map();
  for (const t of roster) {
    const k = t.name.toLowerCase();
    if (!byName.has(k)) byName.set(k, t);
  }

  for (const [tribesmanName, deltas] of reducedEvents) {
    const t = byName.get(tribesmanName.toLowerCase());
    if (!t) {
      report.unmatchedNames.push({ tribesman: tribesmanName });
      continue;
    }

    // Apply weapon/skill caps
    for (const [target, newLevel] of deltas.caps) {
      if (WEAPONS.has(target)) {
        t.weapons = t.weapons || {};
        const cell = t.weapons[target] || { current: null, cap: null };
        const oldCap = cell.cap;
        if (oldCap == null || newLevel > oldCap) {
          t.weapons[target] = { current: cell.current, cap: newLevel };
          report.weaponBumps.push({ tribesman: tribesmanName, weapon: target, oldCap, newCap: newLevel });
        }
      } else if (SKILLS.has(target)) {
        t.skills = t.skills || {};
        const cell = t.skills[target] || { current: null, cap: null };
        const oldCap = cell.cap;
        if (oldCap == null || newLevel > oldCap) {
          t.skills[target] = { current: cell.current, cap: newLevel };
          report.skillBumps.push({ tribesman: tribesmanName, skill: target, oldCap, newCap: newLevel });
        }
      } else {
        report.unknownTargets.push({ tribesman: tribesmanName, target, level: newLevel });
      }
    }

    // Apply talent levels
    for (const [talentName, newLevel] of deltas.talents) {
      t.talents = t.talents || [];
      const existing = t.talents.find((x) => x.name === talentName);
      if (existing) {
        if (newLevel > (existing.level || 0)) {
          report.talentBumps.push({ tribesman: tribesmanName, talent: talentName, oldLevel: existing.level, newLevel });
          existing.level = newLevel;
        }
      } else {
        // Need an icon — look it up in the catalog if available
        const meta = talentCatalog ? talentCatalog.get(talentName) : null;
        if (!meta) {
          report.unknownTalents.push({ tribesman: tribesmanName, talent: talentName });
          continue;
        }
        t.talents.push({ name: talentName, level: newLevel, icon: meta.icon || "" });
        report.talentAdds.push({ tribesman: tribesmanName, talent: talentName, level: newLevel });
      }
    }
  }

  return report;
}

module.exports = { applyTrainingDeltas, loadTalentCatalog, WEAPONS, SKILLS };
