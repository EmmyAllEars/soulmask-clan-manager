// Parse text copied from Soulmask's in-game "Training ground" log into a list
// of structured events. The log isn't persisted server-side as plain text;
// the user has to copy-paste from the client UI.
//
// Recognized event shapes (pulled from real screenshots — phrasing matches
// the English client circa April 2026):
//
//   <ts> Tribesman <name>, while performing <player>'s training task [Combat
//   Skill Improvement (<mentor>, <student>)], successfully raised the
//   proficiency cap of [<weapon-or-skill>] to Lv.<n> under the instructor's
//   guidance.
//
//   <ts> Tribesman <name>, while performing <player>'s training task [Talent
//   Upgrade (<mentor>, <student>)], successfully upgraded the talent
//   [<talent>] Lv.<x> to [<talent>] Lv.<y> under the instructor's guidance.
//
// We ignore "added a training task", "modified ...", and "has been completed."
// rows — those are workflow noise that doesn't change tribesman state.

"use strict";

// We don't try to parse the timestamp into a Date — we only care about
// applying the latest value per (tribesman, weapon|skill|talent), which the
// caller resolves by sorting events in file order (the in-game UI lists newest
// first, so a later occurrence wins iff we sort by file position descending —
// see applyTrainingDeltas below).
const CAP_RE = /Tribesman\s+([^,]+?),\s+while performing[^]*?successfully raised the proficiency cap of\s+\[([^\]]+)\]\s+to Lv\.(\d+)/i;
const TALENT_RE = /Tribesman\s+([^,]+?),\s+while performing[^]*?successfully upgraded the talent\s+\[([^\]]+)\]\s+Lv\.(\d+)\s+to\s+\[([^\]]+)\]\s+Lv\.(\d+)/i;

/**
 * @typedef {Object} CapEvent
 * @property {"cap"} kind
 * @property {string} tribesman   - student name (suffix stripped)
 * @property {string} target      - the weapon or skill name in [...]
 * @property {number} level       - new cap value
 * @property {number} order       - event index in input file (lower = earlier in file)
 */

/**
 * @typedef {Object} TalentEvent
 * @property {"talent"} kind
 * @property {string} tribesman   - student name (suffix stripped)
 * @property {string} talent      - talent name in [...]
 * @property {number} fromLevel
 * @property {number} toLevel
 * @property {number} order
 */

/** @typedef {CapEvent|TalentEvent} TrainingEvent */

const SUFFIX_RE = /\s*<[A-Z]>\s*$/;
function stripSuffix(name) {
  return name.replace(SUFFIX_RE, "").trim();
}

/**
 * Parse a multi-line dump of training-log events.
 * @param {string} text
 * @returns {TrainingEvent[]}
 */
function parseTrainingLog(text) {
  const events = [];
  // The training log can be split across very long lines or multi-line entries
  // depending on how the user pasted it. Normalize whitespace into single spaces
  // first, then split on the boundary between events. Events tend to start with
  // a date like "Apr 28, 2026," (English client) or a timestamp prefix.
  const normalized = text.replace(/\s+/g, " ");
  // Split on "Apr 28, 2026," / "Mar 02, 2026," / etc.
  const parts = normalized.split(/(?=\b[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)\b)/);
  let order = 0;
  for (const part of parts) {
    if (!part.trim()) continue;
    const cap = CAP_RE.exec(part);
    if (cap) {
      events.push({
        kind: "cap",
        tribesman: stripSuffix(cap[1]),
        target: cap[2].trim(),
        level: parseInt(cap[3], 10),
        order: order++,
      });
      continue;
    }
    const tal = TALENT_RE.exec(part);
    if (tal) {
      // Sanity: name in [..] should match in both halves
      if (tal[2].trim() !== tal[4].trim()) continue;
      events.push({
        kind: "talent",
        tribesman: stripSuffix(tal[1]),
        talent: tal[2].trim(),
        fromLevel: parseInt(tal[3], 10),
        toLevel: parseInt(tal[5], 10),
        order: order++,
      });
    }
  }
  return events;
}

/**
 * Reduce a list of events into per-tribesman target levels.
 * Strategy: order events by their `order` field. Latest wins per
 * (tribesman, target). For talents, we keep the highest `toLevel` we've
 * seen rather than the latest, because partial logs may be missing the
 * most-recent upgrade.
 *
 * @param {TrainingEvent[]} events
 */
function reduceEvents(events) {
  // Map<tribesman, { caps: Map<target, maxLevel>, talents: Map<talent, maxLevel> }>
  const byTribesman = new Map();
  const get = (name) => {
    if (!byTribesman.has(name)) byTribesman.set(name, { caps: new Map(), talents: new Map() });
    return byTribesman.get(name);
  };
  for (const e of events) {
    const t = get(e.tribesman);
    if (e.kind === "cap") {
      const prev = t.caps.get(e.target) ?? 0;
      if (e.level > prev) t.caps.set(e.target, e.level);
    } else {
      const prev = t.talents.get(e.talent) ?? 0;
      if (e.toLevel > prev) t.talents.set(e.talent, e.toLevel);
    }
  }
  return byTribesman;
}

module.exports = { parseTrainingLog, reduceEvents, stripSuffix };
