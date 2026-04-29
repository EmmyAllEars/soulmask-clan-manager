/* Soulmask Clan Manager — vanilla JS app
 * Persistence: localStorage key 'soulmaskClan_v1'
 * Initial bootstrap: data/default_roster.json + data/talents.json
 *
 * Type definitions live in types.js. JSDoc references in this file
 * (e.g. {Tribesman}, {TrainingPlan}) resolve against those typedefs
 * via jsconfig.json. To turn on strict checking, add `// @ts-check`
 * to the top of this file or set `checkJs: true` in jsconfig.json.
 */

// === CONSTANTS ===
const APP_VERSION = '1.0.0';
const REPO_URL = 'https://github.com/EmmyAllEars/soulmask-clan-manager';
const STORAGE_KEY = 'soulmaskClan_v1';
const THEME_KEY = 'soulmaskClan_theme';
const DEFAULT_ROSTER_URL = 'data/default_roster.json';
const TALENTS_URL = 'data/talents.json';
const ICON_DIR = 'icons/';

const SKILLS = [
  'Lumberjack','Miner','Gatherer','Farmer',
  'Weaver','Potter','Carpenter','Tanner','Kiln Worker',
  'Craftsman','Alchemist','Cook','Blacksmith','Armorer'
];
const WEAPONS = [
  'Spear','Shield','Dual-blade','Great Sword','Spiked Whip',
  'Blade','Bow','Gauntlets','Hammer'
];
const ATTRS = ['Per','Agi','Phy','End','Str'];
const ATTR_NAMES = {Per:'Perception', Agi:'Agility', Phy:'Physique', End:'Endurance', Str:'Strength'};
// In-game tooltip text for each attribute, shown on hover in the profile and
// on the roster column headers.
const ATTR_TOOLTIPS = {
  Per: 'Perception boosts Coma resistance by 0.5% per point, increasing crafting output and bow damage by 0.5%, and improving thrown weapon accuracy.',
  Agi: 'Agility boosts Paralyze resistance by 0.5% per point, increasing crafting efficiency, and enhancing Spear, Blade, Dual-blade, Gauntlets, and Spiked Whip damage by 0.5%. Additionally, melee weapon attack speed increases by 0.25%.',
  Phy: 'For every point of Physique, Max HP +10, Max Resilience +1, Chill Resist +0.2, Flame Resist +0.2, and Base HP Recovery Speed +10%; eliminates residual Poison and Radiation in the body more quickly.',
  End: 'For every point of Endurance, Max Stamina +1, Stamina Cost -0.5%.',
  Str: 'For every point of Strength, Max Load +2, Poison Resist +0.2, Collecting Efficiency +0.5%, Great Sword DMG +0.5%, Hammer DMG +0.5%; improves throwing distance.',
};

// Profession alignment for skill highlighting
const PROF_BEST_SKILLS = {
  Laborer: ['Lumberjack','Miner','Gatherer','Farmer'],
  Porter:  ['Weaver','Potter','Carpenter','Tanner','Kiln Worker'],
  Craftsman: ['Craftsman','Alchemist','Cook','Blacksmith','Armorer'],
  Warrior: [], Hunter: [], Guard: [],
};
// In-game restriction: only level-50 tribesmen can be assigned as mentors in
// the Training Ground. Used by the picker pools, suggestion logic, and the
// step renderer's eligible-mentor filter.
const MENTOR_MIN_LEVEL = 50;

// Profession class weapons (cap can train up to 125 in Training Ground)
const PROF_CLASS_WEAPONS = {
  Warrior: ['Dual-blade','Hammer','Blade','Great Sword','Gauntlets'],
  Hunter:  ['Bow','Dual-blade','Blade','Spear','Gauntlets','Spiked Whip'],
  Guard:   ['Shield','Bow','Blade','Great Sword','Spear'],
};

// === STATE ===
const STORAGE_VERSION = 3;

// Training Plan time-estimation constants (see docs/training_plans.md).
// Both base times and material multipliers are placeholders until measured;
// they are exposed in the Calibration panel so Emmy can adjust them.
//
// "Material" is the gear's progression tier (1-5: Beast Hide → Bronze → Iron
// → Steel → Endgame). Soulmask's other gear axes — Quality (I-VI badges)
// and Mod — do NOT affect training duration, so we don't model them here.
const DEFAULT_PLAN_BASE_TIMES_MIN = {
  'cap-raise':   180,  // PLACEHOLDER
  'learn':       212,  // ~3h 32m (Lv 1 acquired, random)
  'upgrade-1-2':  86,  // ~1h 26m
  'upgrade-2-3': 168,  // ~2h 48m
};
const DEFAULT_PLAN_TIER_MULTIPLIERS = {
  1: 1.40,  // Beast Hide — slow
  2: 1.15,
  3: 1.00,
  4: 0.85,
  5: 0.70,  // Endgame — fast
};
const MATERIAL_TIERS = [1, 2, 3, 4, 5];
const PLAN_STEP_TYPES = ['cap-raise','learn','upgrade'];
const PLAN_STEP_LABELS = { 'cap-raise':'Cap Raise', 'learn':'Learn Talent', 'upgrade':'Upgrade Talent' };
const PLAN_STATUSES = ['draft','active','done','abandoned'];
const STEP_STATUSES = ['queued','running','completed','abandoned'];

/** @returns {Calibration} */
function defaultCalibration() {
  return {
    baseTimes: { ...DEFAULT_PLAN_BASE_TIMES_MIN },
    tierMultipliers: { ...DEFAULT_PLAN_TIER_MULTIPLIERS },
  };
}

/** @type {AppState} */
let state = {
  roster: [],          // array of tribesman objects
  talents: [],         // catalog of all talents (loaded from talents.json)
  groups: [],          // user-defined group names
  tags: [],            // user-defined tag names
  plans: [],           // training plans (see docs/training_plans.md)
  calibration: defaultCalibration(), // tunable timing constants
  selectedId: null,    // for profile view
  selectedPlanId: null,// for plan editor view
  sort: { column: 'name', dir: 'asc', sub: null }, // alphabetical by default; click to toggle
  lastRosterOrder: [], // ids in last-rendered roster order, for profile prev/next
};

const STRING_SORT_COLUMNS = new Set(['name','title','profession','tribe','trait','location']);

// === STORAGE ===
function saveState() {
  const persist = {
    roster: state.roster,
    groups: state.groups,
    tags: state.tags,
    plans: state.plans,
    calibration: state.calibration,
    version: STORAGE_VERSION,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Forward-migrate a persisted blob (whatever version it was saved at) into the
// current shape. Pure: takes a blob, returns a blob, no side effects.
/**
 * Forward-migrate a persisted blob (whatever version it was saved at)
 * into the current shape. Pure: takes a blob, returns a blob.
 * @param {*} data
 * @returns {*}
 */
function migrateState(data) {
  if (!data || typeof data !== 'object') return data;
  const v = data.version || 1;
  if (v < 2) {
    data.plans = data.plans || [];
    data.version = 2;
  }
  if (v < 3) {
    // v3: talent catalog expanded from 253 → 551 entries (issue #46), with
    // some combined records ("Limb / Torso / Head / Tail Destruction") split
    // into per-part records. Pruning of now-orphaned tribesman talents
    // happens in boot() once the catalog is loaded — this stub just bumps
    // the version field.
    data.version = 3;
  }
  return data;
}

// === BOOT ===
async function boot() {
  // Load talents catalog
  try {
    const r = await fetch(TALENTS_URL);
    state.talents = await r.json();
  } catch (e) {
    console.error('Failed to load talents:', e);
    showAlertModal({ title: 'Failed to load talents', message: 'Could not load talents.json — check the browser console for details.' });
    state.talents = [];
  }

  // Load saved state OR defaults
  const raw = loadState();
  const wasOlder = raw && (raw.version || 1) < STORAGE_VERSION;
  const saved = migrateState(raw);
  if (saved && saved.roster && saved.roster.length) {
    state.roster = saved.roster;
    state.groups = saved.groups || [];
    state.tags = saved.tags || [];
    state.plans = saved.plans || [];
    let normalized = false;
    state.plans.forEach(p => p.steps?.forEach(s => { if (normalizeStep(s)) normalized = true; }));
    const savedTiers = Object.keys(saved.calibration?.tierMultipliers || {});
    const droppedStaleTiers = savedTiers.some(k => !MATERIAL_TIERS.includes(Number(k)));
    state.calibration = mergeCalibration(saved.calibration);
    // v2→v3 catalog migration: reconcile tribesman talent names against the
    // expanded catalog. Two kinds of mismatch are common:
    //   1. Old curated names had a " — [Class Exclusive]" suffix that the
    //      new scrape doesn't. Strip the suffix and retry.
    //   2. Some upstream entries are lowercased ("Accelerate leatherworking").
    //      Fall back to case-insensitive match.
    // If a rename is found, rewrite the talent name in place. Otherwise it's
    // a true orphan (e.g. the combined Destruction entry whose split
    // replacements live under different names) — drop it and log it for the
    // alert. `wasOlder` is captured pre-migrateState so it correctly
    // reflects the on-disk version.
    const dropped = [];
    const renamed = [];
    if (wasOlder && state.talents.length) {
      const knownByName = new Map(state.talents.map(c => [c.name, c]));
      // Index by a normalized key that strips the "— [Class Exclusive]"
      // suffix and unifies em-dash ↔ hyphen-minus so old curated names
      // ("Attack-Defense Resonance — Attack") map to the new catalog
      // ("Attack-Defense Resonance - Attack").
      const normKey = s => s.toLowerCase().replace(/\s+—\s+\[.*$/, '').replace(/—/g, '-').replace(/\s+/g, ' ').trim();
      const knownByNorm = new Map(state.talents.map(c => [normKey(c.name), c]));
      const reconcile = (name) => {
        if (knownByName.has(name)) return name;
        const hit = knownByNorm.get(normKey(name));
        return hit ? hit.name : null;
      };
      for (const t of state.roster) {
        if (!t.talents) continue;
        const kept = [];
        for (const tt of t.talents) {
          const target = reconcile(tt.name);
          if (target === null) {
            dropped.push({ tribesman: t.name, talent: tt.name });
          } else {
            if (target !== tt.name) renamed.push({ tribesman: t.name, from: tt.name, to: target });
            kept.push({ ...tt, name: target });
          }
        }
        t.talents = kept;
      }
    }
    const migrated = dropped.length || renamed.length;
    if (wasOlder || normalized || droppedStaleTiers || migrated) saveState();
    if (migrated) {
      // showAlertModal escapes HTML and only translates \n → <br>, so build
      // the message with plain newlines rather than markup.
      const parts = [];
      if (renamed.length) {
        parts.push(`${renamed.length} renamed (catalog now matches the in-game name without the "— [Class Exclusive]" suffix):\n` +
          renamed.map(r => `• ${r.tribesman}: "${r.from}" → "${r.to}"`).join('\n'));
      }
      if (dropped.length) {
        parts.push(`${dropped.length} dropped — combined entries split into per-part talents (e.g. "Limb / Torso / Head / Tail Destruction" → four separate Destruction talents). Re-add the specific variants from the dropdown:\n` +
          dropped.map(d => `• ${d.tribesman}: "${d.talent}"`).join('\n'));
      }
      showAlertModal({
        title: `Talent catalog updated (253 → 551 entries)`,
        message: parts.join('\n\n'),
      });
    }
  } else {
    await loadDefaults();
  }

  initFilters();
  renderRoster();
  bindUI();
  const v = document.getElementById('app-version');
  if (v) v.textContent = `v${APP_VERSION}`;
  initTheme();
}

async function loadDefaults() {
  try {
    const r = await fetch(DEFAULT_ROSTER_URL);
    const data = await r.json();
    state.roster = data.roster;
    state.groups = [];
    state.tags = [];
    state.plans = [];
    state.calibration = defaultCalibration();
    saveState();
  } catch (e) {
    console.error('Failed to load defaults:', e);
    state.roster = [];
    state.plans = [];
    state.calibration = defaultCalibration();
  }
}

// Merge a persisted (or absent) calibration blob with the current defaults so
// that adding new constants in future versions doesn't strand existing saves.
/**
 * @param {Partial<Calibration>|null|undefined} saved
 * @returns {Calibration}
 */
function mergeCalibration(saved) {
  const def = defaultCalibration();
  if (!saved) return def;
  const tier = { ...def.tierMultipliers };
  for (const t of MATERIAL_TIERS) {
    if (saved.tierMultipliers && saved.tierMultipliers[t] != null) tier[t] = saved.tierMultipliers[t];
  }
  return {
    baseTimes: { ...def.baseTimes, ...(saved.baseTimes || {}) },
    tierMultipliers: tier,
  };
}

// === HELPERS ===
function tierClass(cap) {
  if (cap == null || cap === '') return 'tier-empty';
  if (cap >= 120) return 'tier-mastery';
  if (cap >= 100) return 'tier-specialist';
  if (cap >= 90) return 'tier-iron';
  return 'tier-sub';
}
function fmtSkill(cur, cap) {
  if (cap == null || cap === '') return '—';
  if (cur == null || cur === '') return `${cap}`;
  return `${cur} / ${cap}`;
}
function newId() { return 'T_' + Math.random().toString(36).slice(2,11).toUpperCase(); }
function newPlanId() { return 'P_' + Math.random().toString(36).slice(2,11).toUpperCase(); }
function newStepId() { return 'S_' + Math.random().toString(36).slice(2,11).toUpperCase(); }

const ROMAN_TIERS = { 1:'I', 2:'II', 3:'III', 4:'IV', 5:'V' };
const MATERIAL_NAMES = { 1:'Beast Hide', 2:'Bronze', 3:'Iron', 4:'Steel', 5:'Endgame' };

// Cap ceiling shared by Training Suggestions and Cap Raise plan steps.
/**
 * @param {Profession} profession
 * @param {string} weapon
 * @returns {number} 125 if class weapon, else 100
 */
/**
 * Whether a tribesman is high-enough level to be assigned as a mentor in the
 * Training Ground (in-game requirement: Lv 50).
 * @param {Tribesman|null|undefined} m
 * @returns {boolean}
 */
function isMentorEligible(m) {
  return !!m && (m.level || 0) >= MENTOR_MIN_LEVEL;
}

function weaponCeiling(profession, weapon) {
  const cls = PROF_CLASS_WEAPONS[profession] || [];
  return cls.includes(weapon) ? 125 : 100;
}

// === UI MAIN ===
function setActiveView(viewId, navId) {
  for (const v of ['view-roster','view-profile','view-plans']) {
    document.getElementById(v)?.classList.toggle('active', v === viewId);
  }
  for (const n of ['nav-roster','nav-profile','nav-plans']) {
    document.getElementById(n)?.classList.toggle('primary', n === navId);
  }
}

const ui = {
  showRoster() {
    setActiveView('view-roster', 'nav-roster');
    refreshNavProfileLabel();
    refreshNavPlanLabel();
  },
  showProfile(id) {
    state.selectedId = id;
    setActiveView('view-profile', 'nav-profile');
    renderProfile();
    refreshNavProfileLabel();
    refreshNavPlanLabel();
  },
  showPlans() {
    state.selectedPlanId = null;
    setActiveView('view-plans', 'nav-plans');
    renderPlansList();
    refreshNavProfileLabel();
    refreshNavPlanLabel();
  },
  showPlan(id) {
    state.selectedPlanId = id;
    setActiveView('view-plans', 'nav-plans');
    renderPlanEditor(id);
    refreshNavProfileLabel();
    refreshNavPlanLabel();
  },
  reportBug() { openIssue('bug', '[Bug] '); },
  suggestFeature() { openIssue('enhancement', '[Feature] '); },
  toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  },
};
window.ui = ui;

function refreshNavProfileLabel() {
  const navBtn = document.getElementById('nav-profile');
  if (!navBtn) return;
  const onProfile = document.getElementById('view-profile')?.classList.contains('active');
  if (!onProfile) { navBtn.textContent = 'Profile'; return; }
  const t = state.roster.find(x => x.id === state.selectedId);
  navBtn.textContent = t ? `Profile: ${t.name}` : 'Profile';
}

function refreshNavPlanLabel() {
  const navBtn = document.getElementById('nav-plans');
  if (!navBtn) return;
  const onPlans = document.getElementById('view-plans')?.classList.contains('active');
  if (!onPlans || !state.selectedPlanId) { navBtn.textContent = 'Plans'; return; }
  const p = state.plans.find(x => x.id === state.selectedPlanId);
  navBtn.textContent = p ? `Plan: ${p.name || 'Untitled'}` : 'Plans';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  const sys = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(saved || sys);
}

function buildIssueBody() {
  const activeView = document.querySelector('.view.active');
  const viewName = activeView?.id === 'view-profile' ? 'Profile' : 'Roster';
  const sel = state.selectedId ? state.roster.find(t => t.id === state.selectedId) : null;
  const ctx = sel && viewName === 'Profile' ? ` (tribesman: ${sel.name})` : '';
  return [
    '<!-- Describe the bug or feature here. Page details below help with triage — please leave them. -->',
    '',
    '',
    '---',
    '**Page details (auto-filled):**',
    `- App version: ${APP_VERSION}`,
    `- View: ${viewName}${ctx}`,
    `- Roster size: ${state.roster.length}`,
    `- Talents loaded: ${state.talents.length}`,
    `- User agent: ${navigator.userAgent}`,
    `- Viewport: ${window.innerWidth}×${window.innerHeight}`,
    `- Timestamp: ${new Date().toISOString()}`,
  ].join('\n');
}

function openIssue(label, titlePrefix) {
  const url = `${REPO_URL}/issues/new?` +
    `labels=${encodeURIComponent(label)}` +
    `&title=${encodeURIComponent(titlePrefix)}` +
    `&body=${encodeURIComponent(buildIssueBody())}`;
  window.open(url, '_blank', 'noopener');
}

// === ROSTER VIEW ===
function initFilters() {
  // Tribes
  const tribes = [...new Set(state.roster.map(t => t.tribe).filter(Boolean))].sort();
  const tribeSel = document.getElementById('filter-tribe');
  tribeSel.innerHTML = '<option value="">All tribes</option>' +
    tribes.map(t => `<option>${escapeHtml(t)}</option>`).join('');
  // Groups
  const allGroups = [...new Set(state.roster.flatMap(t => t.groups || []))].sort();
  const groupSel = document.getElementById('filter-group');
  groupSel.innerHTML = '<option value="">All groups</option>' +
    allGroups.map(g => `<option>${escapeHtml(g)}</option>`).join('');
  // Tags
  const allTags = [...new Set(state.roster.flatMap(t => t.tags || []))].sort();
  const tagSel = document.getElementById('filter-tag');
  tagSel.innerHTML = '<option value="">All tags</option>' +
    allTags.map(g => `<option>${escapeHtml(g)}</option>`).join('');
}

function getFilteredRoster() {
  const q = document.getElementById('filter-name').value.toLowerCase();
  const p = document.getElementById('filter-prof').value;
  const tr = document.getElementById('filter-tribe').value;
  const g = document.getElementById('filter-group').value;
  const tg = document.getElementById('filter-tag').value;
  return state.roster.filter(t => {
    if (q && !t.name.toLowerCase().includes(q)) return false;
    if (p && t.profession !== p) return false;
    if (tr && t.tribe !== tr) return false;
    if (g && !(t.groups || []).includes(g)) return false;
    if (tg && !(t.tags || []).includes(tg)) return false;
    return true;
  });
}

function getSortedFiltered() {
  const list = getFilteredRoster();
  if (!state.sort.column) return list;
  return [...list].sort(compareTribesmen);
}

function compareTribesmen(a, b) {
  const c = state.sort.column;
  const dir = state.sort.dir === 'asc' ? 1 : -1;
  let av, bv;
  let isString = false;

  if (STRING_SORT_COLUMNS.has(c)) {
    av = (a[c] || '').toLowerCase();
    bv = (b[c] || '').toLowerCase();
    isString = true;
  } else if (c === 'level') {
    av = a.level; bv = b.level;
  } else if (c.startsWith('attr:')) {
    const k = c.slice(5);
    av = a.attrs?.[k]; bv = b.attrs?.[k];
  } else if (c.startsWith('skill:')) {
    const k = c.slice(6);
    av = a.skills?.[k]?.[state.sort.sub];
    bv = b.skills?.[k]?.[state.sort.sub];
  } else if (c.startsWith('weapon:')) {
    const k = c.slice(7);
    av = a.weapons?.[k]?.cap;
    bv = b.weapons?.[k]?.cap;
  } else if (c === 'groups')  { av = (a.groups || []).length; bv = (b.groups || []).length; }
  else if (c === 'tags')      { av = (a.tags || []).length; bv = (b.tags || []).length; }
  else if (c === 'talents')   { av = (a.talents || []).length; bv = (b.talents || []).length; }

  /* Empty values always sort to the end regardless of direction */
  const aEmpty = av == null || av === '';
  const bEmpty = bv == null || bv === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (isString) return av.localeCompare(bv) * dir;
  return (av - bv) * dir;
}

function sortBy(ev, column) {
  if (ev) ev.preventDefault();
  const isSkill = column.startsWith('skill:');
  /* Shift-click on a skill column toggles to sorting by current instead of cap.
     Weapons only have cap so shift has no effect there. */
  const desiredSub = isSkill ? (ev?.shiftKey ? 'current' : 'cap') : null;

  if (state.sort.column === column && state.sort.sub === desiredSub) {
    /* Same column+sub: flip direction, or clear after the second toggle */
    const isString = STRING_SORT_COLUMNS.has(column);
    const initialDir = isString ? 'asc' : 'desc';
    if (state.sort.dir === initialDir) {
      state.sort.dir = initialDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sort = { column: null, dir: null, sub: null };
    }
  } else {
    state.sort.column = column;
    state.sort.sub = desiredSub;
    state.sort.dir = STRING_SORT_COLUMNS.has(column) ? 'asc' : 'desc';
  }
  renderRoster();
}
window.sortBy = sortBy;

function sortIndicator(column) {
  if (state.sort.column !== column) return '';
  const arrow = state.sort.dir === 'asc' ? '↑' : '↓';
  const subTag = state.sort.sub === 'current' ? 'ᶜ' : '';
  return ` <span class="sort-ind">${arrow}${subTag}</span>`;
}

function thSort(label, col, extraClass = '', tip = '') {
  const cls = `sortable${extraClass ? ' ' + extraClass : ''}${tip ? ' has-help' : ''}`;
  const tipHtml = tip ? `<span class="help-tip" role="tooltip">${escapeHtml(tip)}</span>` : '';
  return `<th class="${cls}" onclick="sortBy(event,'${col}')">${escapeHtml(label)}${sortIndicator(col)}${tipHtml}</th>`;
}

const PROFESSIONS = ['Craftsman','Porter','Laborer','Warrior','Hunter','Guard'];

function renderRoster() {
  const list = getSortedFiltered();
  state.lastRosterOrder = list.map(t => t.id);
  const wrap = document.getElementById('roster-table-wrap');
  let html = '<table class="roster editable"><thead><tr>';
  html += thSort('Name', 'name') + thSort('Lvl', 'level') + thSort('Title', 'title')
        + thSort('Profession', 'profession') + thSort('Tribe', 'tribe')
        + thSort('Trait', 'trait') + thSort('Location', 'location');
  for (const s of SKILLS) html += thSort(s, `skill:${s}`, '', `${s}\nClick to sort by cap. Shift-click to sort by current.`);
  for (const a of ATTRS)  html += thSort(a, `attr:${a}`, '', `${ATTR_NAMES[a]}\n${ATTR_TOOLTIPS[a]}`);
  for (const w of WEAPONS) html += thSort(w, `weapon:${w}`, 'weapon-col');
  html += thSort('Groups', 'groups') + thSort('Tags', 'tags') + thSort('Talents', 'talents');
  html += '</tr></thead><tbody>';
  for (const t of list) {
    const id = t.id;
    html += `<tr data-id="${id}">`;
    html += `<td class="name-cell">
      <input class="cell-input name-input" value="${escapeHtml(t.name)}" oninput="updFromRoster('${id}','name',this.value)">
      <button class="row-go" title="Open profile" onclick="ui.showProfile('${id}')">→</button>
    </td>`;
    html += `<td><input class="cell-input num" type="number" value="${t.level ?? ''}" oninput="updFromRoster('${id}','level',this.value===''?null:+this.value)"></td>`;
    html += `<td><input class="cell-input" value="${escapeHtml(t.title || '')}" oninput="updFromRoster('${id}','title',this.value)"></td>`;
    html += `<td><select class="cell-input" onchange="updFromRoster('${id}','profession',this.value,{rerender:true})">
      <option value=""${t.profession ? '' : ' selected'}></option>
      ${PROFESSIONS.map(p => `<option${p === t.profession ? ' selected' : ''}>${p}</option>`).join('')}
    </select></td>`;
    html += `<td><input class="cell-input" value="${escapeHtml(t.tribe || '')}" oninput="updFromRoster('${id}','tribe',this.value)"></td>`;
    html += `<td><input class="cell-input" value="${escapeHtml(t.trait || '')}" oninput="updFromRoster('${id}','trait',this.value)"></td>`;
    html += `<td><input class="cell-input" value="${escapeHtml(t.location || '')}" oninput="updFromRoster('${id}','location',this.value)"></td>`;
    const aligned = PROF_BEST_SKILLS[t.profession] || [];
    for (const s of SKILLS) {
      const v = (t.skills?.[s]) || {current:null, cap:null};
      const cls = tierClass(v.cap);
      const al = aligned.includes(s) ? ' aligned-skill' : '';
      html += `<td class="skill-cell ${cls}${al}"><div class="cur-cap">
        <input class="cell-input num-tiny" type="number" value="${v.current ?? ''}" oninput="updSkillFromRoster('${id}','${s}','current',this)">
        <span class="sep">/</span>
        <input class="cell-input num-tiny" type="number" value="${v.cap ?? ''}" oninput="updSkillFromRoster('${id}','${s}','cap',this)">
      </div></td>`;
    }
    for (const a of ATTRS) {
      const v = t.attrs?.[a];
      html += `<td><input class="cell-input num" type="number" value="${v ?? ''}" oninput="updAttrFromRoster('${id}','${a}',this.value===''?null:+this.value)"></td>`;
    }
    const classW = PROF_CLASS_WEAPONS[t.profession] || [];
    for (const w of WEAPONS) {
      const v = (t.weapons?.[w]) || {current:null, cap:null};
      const cls = tierClass(v.cap);
      const al = classW.includes(w) ? ' aligned-skill' : '';
      html += `<td class="weapon-cell ${cls}${al}"><div class="cur-cap">
        <input class="cell-input num-tiny" type="number" value="${v.current ?? ''}" oninput="updWeaponFromRoster('${id}','${w}','current',this)">
        <span class="sep">/</span>
        <input class="cell-input num-tiny" type="number" value="${v.cap ?? ''}" oninput="updWeaponFromRoster('${id}','${w}','cap',this)">
      </div></td>`;
    }
    html += `<td><input class="cell-input list-input" value="${escapeHtml((t.groups || []).join(', '))}" placeholder="comma-separated" oninput="updListFromRoster('${id}','groups',this.value)" title="Comma-separated. Edit here, or use the profile for chip-style management."></td>`;
    html += `<td><input class="cell-input list-input" value="${escapeHtml((t.tags || []).join(', '))}" placeholder="comma-separated" oninput="updListFromRoster('${id}','tags',this.value)" title="Comma-separated. Edit here, or use the profile for chip-style management."></td>`;
    html += `<td>${renderTalentIconRow(t.talents)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// === PROFILE VIEW ===
function renderProfile() {
  const t = state.roster.find(x => x.id === state.selectedId);
  if (!t) { document.getElementById('profile-content').innerHTML = '<p class="muted">Tribesman not found.</p>'; return; }

  const aligned = PROF_BEST_SKILLS[t.profession] || [];
  const classW = PROF_CLASS_WEAPONS[t.profession] || [];

  /* Prev/Next walks the same filtered+sorted view as the roster screen. */
  const order = (state.lastRosterOrder && state.lastRosterOrder.length)
    ? state.lastRosterOrder
    : state.roster.map(x => x.id);
  const idx = order.indexOf(t.id);
  const prevId = idx > 0 ? order[idx - 1] : null;
  const nextId = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  const pos = idx >= 0 ? `${idx + 1} of ${order.length}` : '';

  let html = `<div class="profile-header">
    <button class="prof-nav" ${prevId ? `onclick="ui.showProfile('${prevId}')"` : 'disabled'} title="Previous tribesman">← Prev</button>
    <button class="prof-nav" ${nextId ? `onclick="ui.showProfile('${nextId}')"` : 'disabled'} title="Next tribesman">Next →</button>
    <span class="prof-pos muted">${pos}</span>
    <h2>${escapeHtml(t.name)}</h2>
    <span class="meta">LV ${t.level ?? '—'} · ${escapeHtml(t.title || '')} ${escapeHtml(t.profession || '')} · ${escapeHtml(t.tribe || '')} ${t.trait ? '· '+escapeHtml(t.trait) : ''}</span>
    <span class="grow" style="flex:1"></span>
    <button onclick="onSuggestPlan('${t.id}')" title="Build a draft plan from this tribesman's Training Suggestions">Suggest plan</button>
    <button onclick="onDuplicateTribesman('${t.id}')" title="Create an editable copy with a new id">Duplicate</button>
    <button onclick="onDeleteTribesman('${t.id}')" class="btn-danger-strong">Delete tribesman</button>
  </div>`;
  html += '<div class="profile">';

  // Identity card
  html += `<div class="card">
    <h3>Identity</h3>
    <div class="field"><label>Name</label><input value="${escapeHtml(t.name)}" oninput="upd('${t.id}','name',this.value)"></div>
    <div class="field"><label>Level</label><input type="number" value="${t.level ?? ''}" oninput="upd('${t.id}','level',+this.value||null)"></div>
    <div class="field"><label>Title</label>
      <select onchange="upd('${t.id}','title',this.value)">
        <option ${t.title===''?'selected':''}></option>
        <option ${t.title==='Novice'?'selected':''}>Novice</option>
        <option ${t.title==='Skilled'?'selected':''}>Skilled</option>
        <option ${t.title==='Master'?'selected':''}>Master</option>
      </select></div>
    <div class="field"><label>Profession</label>
      <select onchange="upd('${t.id}','profession',this.value); renderProfile(); renderRoster();">
        <option></option>
        <option ${t.profession==='Laborer'?'selected':''}>Laborer</option>
        <option ${t.profession==='Porter'?'selected':''}>Porter</option>
        <option ${t.profession==='Craftsman'?'selected':''}>Craftsman</option>
        <option ${t.profession==='Warrior'?'selected':''}>Warrior</option>
        <option ${t.profession==='Hunter'?'selected':''}>Hunter</option>
        <option ${t.profession==='Guard'?'selected':''}>Guard</option>
      </select></div>
    <div class="field"><label>Tribe</label><input value="${escapeHtml(t.tribe||'')}" oninput="upd('${t.id}','tribe',this.value)"></div>
    <div class="field"><label>Trait</label><input value="${escapeHtml(t.trait||'')}" oninput="upd('${t.id}','trait',this.value)"></div>
    <div class="field"><label>Location</label><input value="${escapeHtml(t.location||'')}" oninput="upd('${t.id}','location',this.value)"></div>
    <div class="field">
      <label><input type="checkbox" ${t.is_body?'checked':''} onchange="upd('${t.id}','is_body',this.checked)" style="width:auto;margin-right:6px;">Player body (uses tribesman caps as your character)</label>
    </div>
  </div>`;

  // Attributes card
  html += `<div class="card">
    <h3>Attributes</h3>`;
  for (const a of ATTRS) {
    html += `<div class="field"><label class="has-help">${a} — ${ATTR_NAMES[a]}<span class="help-marker" tabindex="0">?</span>
      <span class="help-tip" role="tooltip">${escapeHtml(ATTR_TOOLTIPS[a])}</span>
    </label>
      <input type="number" value="${t.attrs?.[a] ?? ''}" oninput="updAttr('${t.id}','${a}',+this.value||null)"></div>`;
  }
  html += '</div>';

  // Work skills card
  html += `<div class="card full-row"><h3>Work Skills (current / cap)</h3>`;
  for (const s of SKILLS) {
    const v = (t.skills?.[s]) || {current:null, cap:null};
    const isAligned = aligned.includes(s);
    const tier = tierClass(v.cap);
    const fillW = v.cap ? Math.min(100, ((v.current||0)/Math.max(v.cap,1))*100) : 0;
    html += `<div class="skill-row">
      <div class="label ${isAligned?'aligned':''}">${s}</div>
      <input type="number" value="${v.current ?? ''}" placeholder="curr" oninput="updSkill('${t.id}','${s}','current',this)">
      <input type="number" value="${v.cap ?? ''}" placeholder="cap" oninput="updSkill('${t.id}','${s}','cap',this)">
      <div class="bar"><div class="fill ${tier}" style="width:${fillW}%"></div></div>
    </div>`;
  }
  html += '</div>';

  // Weapon caps card
  html += `<div class="card full-row"><h3>Weapon Proficiency Caps</h3>`;
  for (const w of WEAPONS) {
    const v = (t.weapons?.[w]) || {current:null, cap:null};
    const isClass = classW.includes(w);
    const tier = tierClass(v.cap);
    const fillW = v.cap ? Math.min(100, ((v.current||0)/Math.max(v.cap,1))*100) : 0;
    html += `<div class="skill-row">
      <div class="label ${isClass?'aligned':''}">${w}${isClass?' (class)':''}</div>
      <input type="number" value="${v.current ?? ''}" placeholder="curr" oninput="updWeapon('${t.id}','${w}','current',this)">
      <input type="number" value="${v.cap ?? ''}" placeholder="cap" oninput="updWeapon('${t.id}','${w}','cap',this)">
      <div class="bar"><div class="fill ${tier}" style="width:${fillW}%"></div></div>
    </div>`;
  }
  html += '</div>';

  // Talents
  html += `<div class="card full-row">
    <h3>Talents (${(t.talents||[]).filter(tt => state.talents.find(x => x.name === tt.name)?.polarity === 'positive').length}/6 positive max)</h3>
    <div class="talents-grid" id="talents-grid"></div>
    <div class="add-talent-row">
      <input id="talent-input" type="text" placeholder="Search talent name…" autocomplete="off">
      <select id="talent-level"><option value="1">Lv I</option><option value="2">Lv II</option><option value="3" selected>Lv III</option></select>
      <button onclick="onConfirmAddTalent('${t.id}')">Add</button>
    </div>
    <div id="talent-dropdown" style="position:relative"></div>
  </div>`;

  // Groups + Tags
  html += `<div class="card">
    <h3>Groups (workstation assignments)</h3>
    <div class="tag-list">${(t.groups||[]).map(g => `<span class="chip group">${escapeHtml(g)} <span class="x" onclick="rmFromList('${t.id}','groups','${escapeHtml(g)}')">×</span></span>`).join('') || '<span class="muted">No groups assigned</span>'}</div>
    <div class="add-chip-row">
      <select id="group-select"><option value="">— pick existing —</option>${[...new Set(state.roster.flatMap(x=>x.groups||[]))].sort().map(g=>`<option>${escapeHtml(g)}</option>`).join('')}</select>
      <input id="group-input" type="text" placeholder="or new group name…">
      <button onclick="addToList('${t.id}','groups')">Add</button>
    </div>
  </div>`;

  html += `<div class="card">
    <h3>Tags</h3>
    <div class="tag-list">${(t.tags||[]).map(g => `<span class="chip tag">${escapeHtml(g)} <span class="x" onclick="rmFromList('${t.id}','tags','${escapeHtml(g)}')">×</span></span>`).join('') || '<span class="muted">No tags</span>'}</div>
    <div class="add-chip-row">
      <select id="tag-select"><option value="">— pick existing —</option>${[...new Set(state.roster.flatMap(x=>x.tags||[]))].sort().map(g=>`<option>${escapeHtml(g)}</option>`).join('')}</select>
      <input id="tag-input" type="text" placeholder="or new tag…">
      <button onclick="addToList('${t.id}','tags')">Add</button>
    </div>
  </div>`;

  html += `<div class="card full-row">
    <h3>Notes</h3>
    <div class="field"><textarea oninput="upd('${t.id}','notes',this.value)">${escapeHtml(t.notes||'')}</textarea></div>
  </div>`;

  // Training Suggestions
  html += `<div class="card full-row">
    <h3>Training Suggestions</h3>
    ${renderTrainingSuggestions(t)}
  </div>`;

  // Training Plans (this tribesman as trainee or mentor)
  html += `<div class="card full-row">
    <h3>Training Plans</h3>
    ${renderProfileTrainingPlans(t)}
  </div>`;

  html += '</div>';
  document.getElementById('profile-content').innerHTML = html;

  renderTalentList(t);
  bindTalentAutocomplete(t);
}

// Map a talent's polarity to a CSS modifier class. Five buckets:
// positive (default, no class), negative (red), preference (purple/pink),
// origin (amber), title (blue/grey). See style.css for the borders.
function polarityClass(meta) {
  if (!meta) return '';
  switch (meta.polarity) {
    case 'negative':   return 'negative';
    case 'preference': return 'preference';
    case 'origin':     return 'origin';
    case 'title':      return 'title';
    default:           return '';
  }
}

// Compact icon row for the roster's "Talents" column. Each icon hovers to
// reveal the same name/effect tooltip the profile pills use.
function renderTalentIconRow(talents) {
  const tals = talents || [];
  if (!tals.length) return '<span class="muted small">—</span>';
  return `<div class="talent-icon-row">${tals.map(tal => {
    const meta = state.talents.find(x => x.name === tal.name);
    const effect = (meta && meta.effect) ? meta.effect : '';
    const cls = polarityClass(meta);
    const lv = tal.level ? ` · Lv ${tal.level}` : '';
    return `<span class="talent-icon-mini ${cls}" tabindex="0">
      <img src="${ICON_DIR}${tal.icon}" alt="${escapeHtml(tal.name)}" onerror="this.style.opacity=0.2">
      <div class="talent-tip" role="tooltip">
        <div class="tip-name">${escapeHtml(tal.name)}${escapeHtml(lv)}</div>
        ${effect ? `<div class="tip-effect">${escapeHtml(effect)}</div>` : ''}
      </div>
    </span>`;
  }).join('')}</div>`;
}

function renderTalentList(t) {
  const grid = document.getElementById('talents-grid');
  const tals = t.talents || [];
  if (!tals.length) { grid.innerHTML = '<span class="muted">No talents recorded yet.</span>'; return; }
  grid.innerHTML = tals.map((tal,i) => {
    const meta = state.talents.find(x => x.name === tal.name);
    const cls = polarityClass(meta);
    const effect = (meta && meta.effect) ? meta.effect : '';
    return `<div class="talent-pill ${cls}">
      <img src="${ICON_DIR}${tal.icon}" alt="${escapeHtml(tal.name)}" onerror="this.style.opacity=0.2">
      <div class="info">
        <div class="name">${escapeHtml(tal.name)}</div>
        <div class="effect">${escapeHtml(effect)}</div>
      </div>
      <span class="lvl">${'I'.repeat(tal.level||1)}</span>
      <button class="remove" onclick="rmTalent('${t.id}',${i})" title="Remove">×</button>
      <div class="talent-tip" role="tooltip">
        <div class="tip-name">${escapeHtml(tal.name)}</div>
        ${effect ? `<div class="tip-effect">${escapeHtml(effect)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function bindTalentAutocomplete(t) {
  const input = document.getElementById('talent-input');
  const dropdown = document.getElementById('talent-dropdown');
  let active = -1;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { dropdown.innerHTML = ''; return; }
    const matches = state.talents
      .filter(x => x.name.toLowerCase().includes(q) || (x.effect||'').toLowerCase().includes(q))
      .slice(0, 30);
    dropdown.innerHTML = `<div class="talent-dropdown">` + matches.map((m,i) =>
      `<div class="opt" data-name="${escapeHtml(m.name)}" data-icon="${escapeHtml(m.icon)}">
        <img src="${ICON_DIR}${m.icon}" onerror="this.style.opacity=0.2">
        <div class="info"><div class="n">${escapeHtml(m.name)}</div><div class="e">${escapeHtml(m.effect||'')}</div><div class="cat">${escapeHtml(m.category)} · ${m.polarity}</div></div>
      </div>`).join('') + '</div>';
    dropdown.querySelectorAll('.opt').forEach(el => {
      el.addEventListener('click', () => {
        input.value = el.dataset.name;
        input.dataset.icon = el.dataset.icon;
        dropdown.innerHTML = '';
      });
    });
  });
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.innerHTML = '';
  });
}

async function onConfirmAddTalent(id) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  const name = document.getElementById('talent-input').value.trim();
  if (!name) return;
  const meta = state.talents.find(x => x.name === name);
  if (!meta) { showAlertModal({ title: 'Talent not found', message: `"${name}" isn't in the talent catalog. Pick from the autocomplete or check the spelling.` }); return; }
  const level = +document.getElementById('talent-level').value;
  // Enforce 6 positive talents max
  if (meta.polarity === 'positive') {
    const posCount = (t.talents||[]).filter(tt => {
      const m = state.talents.find(x => x.name === tt.name);
      return m && m.polarity === 'positive';
    }).length;
    if (posCount >= 6) {
      const ok = await showConfirmModal({
        title: 'Talent slot limit',
        message: `${t.name} already has 6 positive talents (the in-game max). Add anyway?`,
        confirmLabel: 'Add anyway',
      });
      if (!ok) return;
    }
  }
  if (!t.talents) t.talents = [];
  // Replace existing if same name. Origin talents can coexist at multiple
  // levels (the in-game model allows this), so for those we dedupe by
  // (name, level) instead of by name alone.
  const isOrigin = meta.polarity === 'origin';
  const existing = t.talents.findIndex(tt =>
    tt.name === name && (!isOrigin || tt.level === level)
  );
  const entry = { name, level, icon: meta.icon };
  if (existing >= 0) t.talents[existing] = entry;
  else t.talents.push(entry);
  saveState();
  document.getElementById('talent-input').value = '';
  renderProfile();
  renderRoster();
}
window.onConfirmAddTalent = onConfirmAddTalent;

function rmTalent(id, idx) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.talents.splice(idx, 1);
  saveState();
  renderProfile();
  renderRoster();
}
window.rmTalent = rmTalent;

function upd(id, field, val) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t[field] = val;
  saveState();
  renderRoster();
  if (field === 'name') refreshNavProfileLabel();
}
function updAttr(id, attr, val) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.attrs = t.attrs || {};
  t.attrs[attr] = val;
  saveState();
  renderRoster();
}
function updSkill(id, skill, field, inputEl) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.skills = t.skills || {};
  t.skills[skill] = t.skills[skill] || {current:null, cap:null};
  const val = inputEl.value === '' ? null : +inputEl.value;
  t.skills[skill][field] = val;
  saveState();
  updateProfileBar(inputEl, t.skills[skill]);
}
function updWeapon(id, weapon, field, inputEl) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.weapons = t.weapons || {};
  t.weapons[weapon] = t.weapons[weapon] || {current:null, cap:null};
  const val = inputEl.value === '' ? null : +inputEl.value;
  t.weapons[weapon][field] = val;
  saveState();
  updateProfileBar(inputEl, t.weapons[weapon]);
}

/* Update the .bar inside a .skill-row in place — avoids re-rendering the whole
   profile per keystroke (which scrolls the page back to the top). */
function updateProfileBar(inputEl, v) {
  const row = inputEl.closest('.skill-row');
  if (!row) return;
  const fill = row.querySelector('.bar .fill');
  if (!fill) return;
  const fillW = v.cap ? Math.min(100, ((v.current || 0) / Math.max(v.cap, 1)) * 100) : 0;
  fill.style.width = fillW + '%';
  fill.className = 'fill ' + tierClass(v.cap);
}

window.upd = upd;
window.updAttr = updAttr;
window.updSkill = updSkill;
window.updWeapon = updWeapon;

// Roster-side updates: save without re-rendering the table (would steal focus).
// Pass {rerender: true} when the change affects column highlighting (profession).
function updFromRoster(id, field, val, opts = {}) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t[field] = val;
  saveState();
  if (opts.rerender) renderRoster();
  else if (field === 'tribe') initFilters();
  if (field === 'name') refreshNavProfileLabel();
}
function updAttrFromRoster(id, attr, val) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.attrs = t.attrs || {};
  t.attrs[attr] = val;
  saveState();
}
window.updFromRoster = updFromRoster;
window.updAttrFromRoster = updAttrFromRoster;

function updSkillFromRoster(id, skill, field, inputEl) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.skills = t.skills || {};
  t.skills[skill] = t.skills[skill] || {current:null, cap:null};
  const val = inputEl.value === '' ? null : +inputEl.value;
  t.skills[skill][field] = val;
  saveState();
  if (field === 'cap') {
    const td = inputEl.closest('td');
    if (td) {
      const aligned = (PROF_BEST_SKILLS[t.profession] || []).includes(skill);
      td.className = `skill-cell ${tierClass(val)}${aligned ? ' aligned-skill' : ''}`;
    }
  }
}

function updWeaponFromRoster(id, weapon, field, inputEl) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.weapons = t.weapons || {};
  t.weapons[weapon] = t.weapons[weapon] || {current:null, cap:null};
  const val = inputEl.value === '' ? null : +inputEl.value;
  t.weapons[weapon][field] = val;
  saveState();
  if (field === 'cap') {
    const td = inputEl.closest('td');
    if (td) {
      const aligned = (PROF_CLASS_WEAPONS[t.profession] || []).includes(weapon);
      td.className = `weapon-cell ${tierClass(val)}${aligned ? ' aligned-skill' : ''}`;
    }
  }
}

// Comma-separated inline editor for groups/tags. The profile keeps its
// chip+button rich UI; this is the dense-grid alternative.
function updListFromRoster(id, listKey, csv) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  // Parse: split on commas, trim, drop empties, dedupe (case-insensitive).
  const seen = new Set();
  const items = csv.split(',').map(s => s.trim()).filter(s => {
    if (!s) return false;
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  t[listKey] = items;
  saveState();
  // Refresh the relevant filter dropdown so newly-typed groups/tags appear in
  // the toolbar without a full re-render of the table (which would steal focus
  // from the input the user is still editing).
  initFilters();
}

window.updSkillFromRoster = updSkillFromRoster;
window.updWeaponFromRoster = updWeaponFromRoster;
window.updListFromRoster = updListFromRoster;

function addToList(id, listKey) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  const sel = document.getElementById(listKey === 'groups' ? 'group-select' : 'tag-select');
  const inp = document.getElementById(listKey === 'groups' ? 'group-input' : 'tag-input');
  let val = inp.value.trim() || sel.value;
  if (!val) return;
  if (!t[listKey]) t[listKey] = [];
  if (!t[listKey].includes(val)) t[listKey].push(val);
  saveState();
  renderProfile();
  renderRoster();
  initFilters();
}
function rmFromList(id, listKey, val) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t[listKey] = (t[listKey] || []).filter(v => v !== val);
  saveState();
  renderProfile();
  renderRoster();
  initFilters();
}
window.addToList = addToList;
window.rmFromList = rmFromList;

async function onDeleteTribesman(id) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;

  // Plans that need cleanup: cascade-delete the ones where this tribesman is
  // the trainee; orphan-flag the steps where they're a mentor in someone
  // else's plan (the step keeps mentorId, but the renderer detects the
  // dangling reference and surfaces a warning).
  const traineeOf = state.plans.filter(p => p.traineeId === id);
  const mentorStepCount = state.plans
    .filter(p => p.traineeId !== id)
    .reduce((n, p) => n + p.steps.filter(s => s.mentorId === id).length, 0);

  const lines = ['This cannot be undone.'];
  if (traineeOf.length) lines.push(`• ${traineeOf.length} plan${traineeOf.length === 1 ? '' : 's'} where ${t.name} is the trainee will also be deleted.`);
  if (mentorStepCount) lines.push(`• ${mentorStepCount} step${mentorStepCount === 1 ? '' : 's'} in other plans use ${t.name} as mentor; those steps will be flagged "mentor missing" but kept.`);

  const ok = await showConfirmModal({
    title: `Delete ${t.name}?`,
    message: lines.join('\n'),
    confirmLabel: 'Delete tribesman',
    danger: true,
  });
  if (!ok) return;

  state.roster = state.roster.filter(x => x.id !== id);
  if (traineeOf.length) {
    const ids = new Set(traineeOf.map(p => p.id));
    state.plans = state.plans.filter(p => !ids.has(p.id));
    if (state.selectedPlanId && ids.has(state.selectedPlanId)) state.selectedPlanId = null;
  }
  saveState();
  initFilters();
  ui.showRoster();
  renderRoster();
}
window.onDeleteTribesman = onDeleteTribesman;

// === TRAINING SUGGESTIONS ===
const PROFESSION_EXCLUSIVE_TAGS = new Set(['Craftsman','Porter','Hunter','Warrior','Guard','Laborer']);

/* Talent names carry exclusivity inline: "Foo — [Craftsman Exclusive]",
   "Bar — [Wildwolf Exclusive]". Profession tags gate by trainee.profession;
   anything else is treated as a tribe lock against trainee.tribe. */
/**
 * @param {string} talentName
 * @param {Tribesman} trainee
 * @returns {boolean}
 */
function isLearnableBy(talentName, trainee) {
  const m = talentName.match(/\[([^\]]+) Exclusive\]/);
  if (!m) return true;
  const tag = m[1];
  if (PROFESSION_EXCLUSIVE_TAGS.has(tag)) return trainee.profession === tag;
  return trainee.tribe === tag;
}

// Pure: derive the list of training suggestions for a trainee. Each entry
// carries enough metadata for the "+ Add to plan" button to seed a draft step.
/**
 * Pure: derive the list of training suggestions for a trainee. Each entry
 * carries enough metadata for "+ Add to plan" to seed a draft step.
 * @param {Tribesman} trainee
 * @returns {TrainingSuggestion[]}
 */
function getTrainingSuggestions(trainee) {
  const out = [];
  const classW = PROF_CLASS_WEAPONS[trainee.profession] || [];

  // 1. Cap-raise opportunities
  for (const w of WEAPONS) {
    const v = (trainee.weapons?.[w]) || {cap:null};
    if (v.cap == null) continue;
    const ceiling = classW.includes(w) ? 125 : 100;
    if (v.cap >= ceiling) continue;
    const mentors = state.roster
      .filter(m => m.id !== trainee.id)
      .map(m => ({m, cap: m.weapons?.[w]?.cap}))
      .filter(x => x.cap && x.cap > v.cap)
      .sort((a,b) => b.cap - a.cap);
    if (!mentors.length) continue;
    const top = mentors.slice(0, 3);
    out.push({
      type: 'cap-raise',
      weapon: w,
      currentCap: v.cap,
      targetCap: Math.min(top[0].cap, ceiling),
      ceiling,
      mentorIds: top.map(x => x.m.id),
      head: `Raise ${w} cap from ${v.cap} → up to ${Math.min(top[0].cap, ceiling)}`,
      why: `Mentor candidates: ${top.map(x => `<b>${escapeHtml(x.m.name)}</b> (${x.cap})`).join(', ')}.
        ${classW.includes(w) ? `${w} is a class weapon for ${trainee.profession} — ceiling 125.` : `${w} is off-class — ceiling 100.`}`,
    });
  }

  // 2. Talent upgrades — same talent at higher level
  for (const tal of (trainee.talents||[])) {
    if (tal.level >= 3) continue;
    const mentors = state.roster
      .filter(m => m.id !== trainee.id)
      .filter(m => (m.talents||[]).some(mt => mt.name === tal.name && mt.level > tal.level));
    if (!mentors.length) continue;
    const topLevel = Math.max(...mentors.flatMap(m => m.talents.filter(mt=>mt.name===tal.name).map(mt=>mt.level)));
    out.push({
      type: 'upgrade',
      talent: tal.name,
      currentLevel: tal.level,
      targetLevel: Math.min(3, topLevel),
      mentorIds: mentors.map(m => m.id),
      head: `Upgrade talent: ${escapeHtml(tal.name)} (Lv ${tal.level} → up to ${topLevel})`,
      why: `Mentors: ${mentors.map(m => escapeHtml(m.name)).join(', ')}`,
    });
  }

  // 3. Talents available to learn
  const traineeTalNames = new Set((trainee.talents||[]).map(t => t.name));
  const posTalsCount = (trainee.talents||[]).filter(t => {
    const m = talentMeta(t.name);
    return m && m.polarity === 'positive';
  }).length;
  if (posTalsCount < 6) {
    const avail = new Map();
    for (const m of state.roster) {
      if (m.id === trainee.id) continue;
      for (const t of (m.talents||[])) {
        const meta = talentMeta(t.name);
        if (!meta || meta.polarity !== 'positive') continue;
        if (traineeTalNames.has(t.name)) continue;
        if (!isLearnableBy(t.name, trainee)) continue;
        const cur = avail.get(t.name) || {topLevel:0, mentorIds:[], mentorNames:[]};
        if (t.level > cur.topLevel) cur.topLevel = t.level;
        cur.mentorIds.push(m.id);
        cur.mentorNames.push(m.name);
        avail.set(t.name, cur);
      }
    }
    if (avail.size) {
      const top = [...avail.entries()].sort((a,b) => b[1].topLevel - a[1].topLevel).slice(0, 5);
      // Aggregate mentor IDs from all top candidates so the "Add to plan"
      // path can pre-fill any of them as a learn-step mentor.
      const allMentorIds = [...new Set(top.flatMap(([,d]) => d.mentorIds))];
      out.push({
        type: 'learn',
        mentorIds: allMentorIds,
        availableCount: avail.size,
        positiveCount: posTalsCount,
        head: `${posTalsCount}/6 positive talents — could learn ${avail.size} more from existing roster`,
        why: `Top candidates: ${top.map(([n,d]) => `<b>${escapeHtml(n)}</b> (max Lv ${d.topLevel}, from ${d.mentorNames.slice(0,2).map(escapeHtml).join('/')})`).join(' · ')}`,
      });
    }
  }

  return out;
}

// Returns the list of draft/active plans whose steps already cover this
// suggestion. Match rules per step type:
//   cap-raise: same trainee + step.weapon === suggestion.weapon
//   upgrade:   same trainee + step.talent === suggestion.talent
//   learn:     same trainee + any learn step at all (Learn is random in-game,
//              so a queued Learn session is a queued Learn session — we can't
//              be more specific without modeling outcome targeting).
// Excludes steps already completed/abandoned: they're done work.
/**
 * @param {Tribesman} trainee
 * @param {TrainingSuggestion} suggestion
 * @returns {TrainingPlan[]}
 */
function plansContainingSuggestion(trainee, suggestion) {
  return state.plans.filter(p => {
    if (p.traineeId !== trainee.id) return false;
    if (p.status !== 'draft' && p.status !== 'active') return false;
    return p.steps.some(s => {
      if (s.status === 'completed' || s.status === 'abandoned') return false;
      if (s.type !== suggestion.type) return false;
      if (s.type === 'cap-raise') return s.weapon === suggestion.weapon;
      if (s.type === 'upgrade')   return s.talent === suggestion.talent;
      if (s.type === 'learn')     return true; // any learn step counts
      return false;
    });
  });
}

function renderTrainingSuggestions(trainee) {
  const suggestions = getTrainingSuggestions(trainee);
  if (!suggestions.length) {
    return '<p class="muted">No training opportunities found in current roster.</p>';
  }
  return suggestions.map((s, i) => {
    const inPlans = plansContainingSuggestion(trainee, s);
    let badge = '';
    if (inPlans.length === 1) {
      const p = inPlans[0];
      badge = `<a class="suggestion-in-plan" href="javascript:void(0)" onclick="ui.showPlan('${p.id}')" title="Open plan">✓ in plan: ${escapeHtml(p.name || 'Untitled')}</a>`;
    } else if (inPlans.length > 1) {
      badge = `<span class="suggestion-in-plan" title="${escapeHtml(inPlans.map(p => p.name || 'Untitled').join(', '))}">✓ in ${inPlans.length} plans</span>`;
    }
    return `<div class="suggestion${inPlans.length ? ' is-planned' : ''}">
      <div class="head">${s.head}</div>
      <div class="why">${s.why}</div>
      ${badge}
      <button class="small suggestion-add" onclick="onAddSuggestionToPlan('${trainee.id}', ${i})">+ Add to plan</button>
    </div>`;
  }).join('');
}

// === IMPORT / EXPORT ===
function exportCSV() {
  const headers = ['id','name','level','title','profession','tribe','trait','location','is_body','notes'];
  for (const s of SKILLS) { headers.push(`skill_${s}_cur`); headers.push(`skill_${s}_cap`); }
  for (const w of WEAPONS) { headers.push(`weapon_${w}_cur`); headers.push(`weapon_${w}_cap`); }
  for (const a of ATTRS) headers.push(`attr_${a}`);
  headers.push('groups','tags','talents');

  const rows = [headers.map(csvEscape).join(',')];
  for (const t of state.roster) {
    const r = [t.id, t.name, t.level, t.title, t.profession, t.tribe, t.trait, t.location, t.is_body, t.notes];
    for (const s of SKILLS) {
      const v = t.skills?.[s] || {};
      r.push(v.current ?? ''); r.push(v.cap ?? '');
    }
    for (const w of WEAPONS) {
      const v = t.weapons?.[w] || {};
      r.push(v.current ?? ''); r.push(v.cap ?? '');
    }
    for (const a of ATTRS) r.push(t.attrs?.[a] ?? '');
    r.push((t.groups||[]).join('|'));
    r.push((t.tags||[]).join('|'));
    r.push((t.talents||[]).map(tt => `${tt.name}@${tt.level}`).join('|'));
    rows.push(r.map(csvEscape).join(','));
  }
  downloadFile('clan_roster.csv', 'text/csv', rows.join('\n'));
}
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
async function importCSV(text) {
  // Simple CSV parser handling quoted fields
  const rows = parseCSV(text);
  if (rows.length < 2) { showAlertModal({ title: 'CSV is empty', message: 'No rows to import.' }); return; }
  const headers = rows[0];
  const newRoster = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    const obj = {};
    headers.forEach((h, idx) => obj[h] = r[idx]);
    const t = {
      id: obj.id || newId(),
      name: obj.name || '',
      level: numOrNull(obj.level),
      title: obj.title || '',
      profession: obj.profession || '',
      tribe: obj.tribe || '',
      trait: obj.trait || '',
      location: obj.location || '',
      is_body: obj.is_body === 'true',
      notes: obj.notes || '',
      skills: {}, weapons: {}, attrs: {},
      groups: obj.groups ? obj.groups.split('|').filter(Boolean) : [],
      tags: obj.tags ? obj.tags.split('|').filter(Boolean) : [],
      talents: [],
    };
    for (const s of SKILLS) {
      t.skills[s] = { current: numOrNull(obj[`skill_${s}_cur`]), cap: numOrNull(obj[`skill_${s}_cap`]) };
    }
    for (const w of WEAPONS) {
      t.weapons[w] = { current: numOrNull(obj[`weapon_${w}_cur`]), cap: numOrNull(obj[`weapon_${w}_cap`]) };
    }
    for (const a of ATTRS) t.attrs[a] = numOrNull(obj[`attr_${a}`]);
    if (obj.talents) {
      t.talents = obj.talents.split('|').filter(Boolean).map(s => {
        const [n, l] = s.split('@');
        const meta = state.talents.find(x => x.name === n);
        return { name: n, level: +l || 1, icon: meta ? meta.icon : null };
      });
    }
    newRoster.push(t);
  }
  const ok = await showConfirmModal({
    title: 'Replace current roster?',
    message: `Import ${newRoster.length} tribesmen? Your current roster will be replaced.`,
    confirmLabel: 'Replace roster',
    danger: true,
  });
  if (!ok) return;
  state.roster = newRoster;
  saveState();
  initFilters();
  renderRoster();
  ui.showRoster();
}
function numOrNull(v) { if (v === '' || v == null) return null; const n = +v; return isNaN(n) ? null : n; }
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {} // skip
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function exportJSON() {
  downloadFile('clan_backup.json', 'application/json', JSON.stringify({
    roster: state.roster,
    groups: state.groups,
    tags: state.tags,
    plans: state.plans,
    version: STORAGE_VERSION,
    exported: new Date().toISOString()
  }, null, 2));
}
async function importJSON(text) {
  try {
    const data = migrateState(JSON.parse(text));
    if (!data.roster) {
      await showConfirmModal({ title: 'Invalid backup file', message: 'The selected file has no roster array.', confirmLabel: 'OK', cancelLabel: '' });
      return;
    }
    const ok = await showConfirmModal({
      title: 'Replace current state?',
      message: `Restore ${data.roster.length} tribesmen from this backup? Your current roster, plans, and calibration will be replaced.`,
      confirmLabel: 'Restore backup',
      danger: true,
    });
    if (!ok) return;
    state.roster = data.roster;
    state.groups = data.groups || [];
    state.tags = data.tags || [];
    state.plans = data.plans || [];
    state.plans.forEach(p => p.steps?.forEach(normalizeStep));
    state.calibration = mergeCalibration(data.calibration);
    saveState();
    initFilters();
    renderRoster();
    ui.showRoster();
  } catch (e) { showAlertModal({ title: 'Failed to parse JSON', message: e.message }); }
}

function downloadFile(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// === TRAINING PLANS ===
// Per-tribesman ordered list of training-ground sessions. See
// docs/training_plans.md for the full design.

/** @param {string} id @returns {TrainingPlan|undefined} */
function findPlan(id) { return state.plans.find(p => p.id === id); }
/** @param {TrainingPlan|undefined|null} plan @param {string} stepId @returns {TrainingStep|undefined} */
function findStep(plan, stepId) { return plan?.steps.find(s => s.id === stepId); }
/** @param {string} id @returns {Tribesman|undefined} */
function findTribesman(id) { return state.roster.find(t => t.id === id); }
/** @param {string} name @returns {TalentMeta|undefined} */
function talentMeta(name) { return state.talents.find(x => x.name === name); }

// --- Time estimation -------------------------------------------------------

/** @param {TrainingStep} step @returns {string} key into Calibration.baseTimes */
function stepBaseKey(step) {
  if (step.type === 'cap-raise') return 'cap-raise';
  if (step.type === 'learn') return 'learn';
  // upgrade: which level transition?
  const target = step.targetLevel || 2;
  return target <= 2 ? 'upgrade-1-2' : 'upgrade-2-3';
}

/** @param {TrainingStep|null|undefined} step @returns {number} minutes */
function estimateStepMin(step) {
  if (!step) return 0;
  const base = state.calibration.baseTimes[stepBaseKey(step)];
  const mult = state.calibration.tierMultipliers[step.material] ?? 1;
  if (base == null) return 0;
  return Math.round(base * mult);
}

/** @param {TrainingPlan|null|undefined} plan @returns {number} sum of step estimates in minutes */
function estimatePlanMin(plan) {
  if (!plan) return 0;
  return plan.steps.reduce((sum, s) => sum + estimateStepMin(s), 0);
}

/** @param {number|null|undefined} min @returns {string} */
function fmtMinutes(min) {
  if (!min || min < 1) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

// --- Plan CRUD -------------------------------------------------------------

/** @param {string} traineeId @param {string} [name] @returns {TrainingPlan} */
function createPlan(traineeId, name) {
  const trainee = findTribesman(traineeId);
  const plan = {
    id: newPlanId(),
    name: name || `${trainee?.name || 'Unnamed'} — new plan`,
    traineeId,
    status: 'draft',
    createdAt: new Date().toISOString(),
    notes: '',
    steps: [],
  };
  state.plans.push(plan);
  saveState();
  return plan;
}

/** @param {string} id */
function deletePlan(id) {
  const idx = state.plans.findIndex(p => p.id === id);
  if (idx < 0) return;
  state.plans.splice(idx, 1);
  if (state.selectedPlanId === id) state.selectedPlanId = null;
  saveState();
}

/** @param {string} id @returns {TrainingPlan|null} */
function duplicatePlan(id) {
  const src = findPlan(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newPlanId();
  copy.name = `${src.name} (copy)`;
  copy.status = 'draft';
  copy.createdAt = new Date().toISOString();
  copy.steps = copy.steps.map(s => ({ ...s, id: newStepId(), status: 'queued', startedAt: null, completedAt: null, actualDurationMin: null, appliedAt: null }));
  state.plans.push(copy);
  saveState();
  return copy;
}

// --- Step CRUD -------------------------------------------------------------

/** @param {StepType} type @returns {TrainingStep} */
function newStep(type) {
  return {
    id: newStepId(),
    type,
    mentorId: null,
    weapon: null,
    talent: null,
    targetCap: null,
    targetLevel: null,
    material: 3,         // gear material tier 1-5; Iron is mid-range default
    status: 'queued',
    startedAt: null,
    completedAt: null,
    actualDurationMin: null,
    appliedAt: null,     // ISO date when the step's outcome was pushed to the trainee
    note: '',
  };
}

// Forward-migrate legacy steps that used `gearTier` (1-6, with quality
// conflated into the same axis). New code uses `material` (1-5).
// Returns true if it changed anything, so the caller can re-save.
/**
 * @param {TrainingStep & {gearTier?: number}} s
 * @returns {boolean} true if the step was changed (caller can re-save)
 */
function normalizeStep(s) {
  if (s.material == null) {
    const legacy = s.gearTier != null ? Number(s.gearTier) : 3;
    s.material = Math.min(5, Math.max(1, legacy));
    delete s.gearTier;
    return true;
  }
  if ('gearTier' in s) { delete s.gearTier; return true; }
  return false;
}

/** @param {string} planId @param {StepType} type @returns {TrainingStep|null} */
function addStep(planId, type) {
  const plan = findPlan(planId);
  if (!plan) return null;
  const s = newStep(type);
  plan.steps.push(s);
  saveState();
  return s;
}

/** @param {string} planId @param {string} stepId */
function removeStep(planId, stepId) {
  const plan = findPlan(planId);
  if (!plan) return;
  plan.steps = plan.steps.filter(s => s.id !== stepId);
  saveState();
}

/** @param {string} planId @param {string} stepId @param {-1|1} dir */
function moveStep(planId, stepId, dir) {
  const plan = findPlan(planId);
  if (!plan) return;
  const i = plan.steps.findIndex(s => s.id === stepId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= plan.steps.length) return;
  [plan.steps[i], plan.steps[j]] = [plan.steps[j], plan.steps[i]];
  saveState();
}

// --- Inline-edit handlers (exposed on window for inline onclick/oninput) ---

window.planFieldUpd = function(id, field, value) {
  const p = findPlan(id);
  if (!p) return;
  p[field] = value;
  saveState();
  refreshNavPlanLabel();
};

// Fields that don't affect any derived display — saving them mustn't trigger
// a re-render (which would kill text-input focus mid-typing). Other fields
// (mentor, weapon, target, material) DO need re-render to refresh durations
// and filtered dropdowns.
const STEP_FIELDS_NO_RERENDER = new Set(['note']);

window.stepFieldUpd = function(planId, stepId, field, value) {
  const plan = findPlan(planId);
  const s = findStep(plan, stepId);
  if (!s) return;
  // Coerce numeric fields
  if (field === 'material' || field === 'targetCap' || field === 'targetLevel') {
    s[field] = value === '' ? null : Number(value);
  } else if (field === 'mentorId' || field === 'weapon' || field === 'talent') {
    s[field] = value || null;
  } else {
    s[field] = value;
  }
  saveState();
  // Re-render the editor so derived fields (estimated time, dropdown defaults)
  // update — except for fields where the user is mid-typing (note).
  if (STEP_FIELDS_NO_RERENDER.has(field)) return;
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

// --- Goal-first step pickers ----------------------------------------------
// Each step type has a pool helper (what goals are available?) and a picker
// (two-step modal flow: pick goal, then pick mentor when there are multiple
// candidates). All three pickers share the same shape — see openLearnTalentPicker
// as the reference implementation.
//
// "Projected state" lets a picker reflect the trainee's expected state at the
// point in the plan where this step would land — so a user can queue an
// Upgrade for a talent that an earlier Learn step in the same plan will
// produce, before they've actually learned it. Only forward-looking steps
// (queued/running, no appliedAt) are projected; completed-and-applied steps
// are already in trainee.* and don't need re-projection; abandoned steps are
// skipped.

/**
 * @param {TrainingPlan} plan
 * @param {TrainingStep} [beforeStep] - if set, project up to but not including this step's index
 * @returns {Tribesman|null} a deep clone of the trainee with the plan's prior steps applied
 */
function projectTraineeState(plan, beforeStep) {
  const real = findTribesman(plan.traineeId);
  if (!real) return null;
  /** @type {Tribesman} */
  const projected = JSON.parse(JSON.stringify(real));
  const stopAt = beforeStep ? plan.steps.indexOf(beforeStep) : plan.steps.length;
  for (let i = 0; i < (stopAt < 0 ? plan.steps.length : stopAt); i++) {
    const s = plan.steps[i];
    if (s.status === 'abandoned' || s.appliedAt) continue;
    if (s.type === 'cap-raise' && s.weapon && s.targetCap != null) {
      projected.weapons = projected.weapons || {};
      projected.weapons[s.weapon] = projected.weapons[s.weapon] || { current: null, cap: null };
      const cur = projected.weapons[s.weapon].cap ?? 0;
      if (s.targetCap > cur) projected.weapons[s.weapon].cap = s.targetCap;
    } else if (s.type === 'upgrade' && s.talent && s.targetLevel != null) {
      projected.talents = projected.talents || [];
      const tal = projected.talents.find(t => t.name === s.talent);
      if (tal && s.targetLevel > (tal.level || 0)) tal.level = s.targetLevel;
    } else if (s.type === 'learn' && s.talent) {
      projected.talents = projected.talents || [];
      if (!projected.talents.some(t => t.name === s.talent)) {
        const meta = talentMeta(s.talent);
        projected.talents.push({ name: s.talent, level: 1, icon: meta?.icon || '' });
      }
    }
  }
  return projected;
}

/**
 * @param {Tribesman} trainee
 * @returns {Array<{weapon: string, currentCap: number, ceiling: number, achievableCap: number, mentors: Array<{id: string, name: string, cap: number}>}>}
 */
function getCapRaisePool(trainee) {
  if (!trainee) return [];
  const classW = PROF_CLASS_WEAPONS[trainee.profession] || [];
  const out = [];
  for (const w of WEAPONS) {
    const cur = trainee.weapons?.[w]?.cap;
    if (cur == null) continue;
    const ceiling = classW.includes(w) ? 125 : 100;
    if (cur >= ceiling) continue;
    const mentors = state.roster
      .filter(m => m.id !== trainee.id)
      .map(m => ({ id: m.id, name: m.name, level: m.level || 0, cap: m.weapons?.[w]?.cap, eligible: isMentorEligible(m) }))
      .filter(x => x.cap && x.cap > cur)
      // Eligible (level-50) mentors first; within each group, highest cap first.
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.cap - a.cap || a.name.localeCompare(b.name));
    if (!mentors.length) continue;
    // achievableCap reflects what the BEST eligible mentor can train up to —
    // if no mentor is currently eligible, fall back to the top sub-50 mentor's
    // cap (as an "after you level them" preview).
    const topEligible = mentors.find(m => m.eligible) || mentors[0];
    out.push({ weapon: w, currentCap: cur, ceiling, achievableCap: Math.min(topEligible.cap, ceiling), mentors });
  }
  // Order by gap (biggest improvement first) so the most impactful goals are at the top.
  return out.sort((a, b) => (b.achievableCap - b.currentCap) - (a.achievableCap - a.currentCap));
}

/**
 * @param {Tribesman} trainee
 * @returns {Array<{talent: string, currentLevel: number, achievableLevel: number, mentors: Array<{id: string, name: string, level: number}>}>}
 */
function getUpgradePool(trainee) {
  if (!trainee) return [];
  const out = [];
  for (const tal of (trainee.talents || [])) {
    if ((tal.level || 0) >= 3) continue;
    const mentors = state.roster
      .filter(m => m.id !== trainee.id)
      .map(m => {
        const mt = (m.talents || []).find(x => x.name === tal.name);
        return mt ? { id: m.id, name: m.name, mentorLevel: m.level || 0, level: mt.level, eligible: isMentorEligible(m) } : null;
      })
      .filter(x => x && x.level > tal.level)
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.level - a.level || a.name.localeCompare(b.name));
    if (!mentors.length) continue;
    const topEligible = mentors.find(m => m.eligible) || mentors[0];
    out.push({ talent: tal.name, currentLevel: tal.level, achievableLevel: Math.min(topEligible.level, 3), mentors });
  }
  return out.sort((a, b) => a.talent.localeCompare(b.talent));
}

/**
 * @param {TrainingPlan} plan
 * @param {TrainingStep} [existingStep]
 * @returns {Promise<TrainingStep|null>}
 */
async function openCapRaisePicker(plan, existingStep) {
  const trainee = findTribesman(plan.traineeId);
  if (!trainee) return null;
  // Project the trainee through any prior steps in the plan so cap raises
  // already queued earlier in the plan don't reappear here.
  const projected = projectTraineeState(plan, existingStep) || trainee;
  const pool = getCapRaisePool(projected);
  if (!pool.length) {
    await showAlertModal({
      title: 'No cap-raise opportunities',
      message: `${trainee.name}'s weapon caps are at ceiling, or no mentor in the roster has a higher cap on a weapon they could train.`,
    });
    return null;
  }

  const weaponChoice = await showPickerModal({
    title: 'Pick a weapon to raise',
    message: `For ${trainee.name}. Sorted by improvement potential.`,
    options: pool.map(p => {
      const ready = p.mentors.filter(m => m.eligible).length;
      const total = p.mentors.length;
      const mentorTxt = ready === total ? `${total} mentor${total === 1 ? '' : 's'}` : `${ready}/${total} mentor${total === 1 ? '' : 's'} ready (others need Lv ${MENTOR_MIN_LEVEL})`;
      return {
        value: p.weapon,
        label: p.weapon,
        sublabel: `${p.currentCap} → up to ${p.achievableCap} (ceiling ${p.ceiling}) · ${mentorTxt}`,
      };
    }),
  });
  if (!weaponChoice) return null;
  const entry = pool.find(p => p.weapon === weaponChoice);
  if (!entry) return null;

  let mentorId;
  if (entry.mentors.length === 1) {
    mentorId = entry.mentors[0].id;
  } else {
    const choice = await showPickerModal({
      title: `Pick a mentor for ${entry.weapon}`,
      options: entry.mentors.map(m => ({
        value: m.id,
        label: m.eligible ? m.name : `${m.name}  (Lv ${m.level} — ⚠ needs Lv ${MENTOR_MIN_LEVEL})`,
        sublabel: `${entry.weapon} cap ${m.cap}` + (m.eligible ? '' : ` · level them up first`),
      })),
    });
    if (!choice) return null;
    mentorId = choice;
  }

  const mentorCap = state.roster.find(t => t.id === mentorId)?.weapons?.[entry.weapon]?.cap || entry.achievableCap;
  const step = existingStep || newStep('cap-raise');
  step.weapon = entry.weapon;
  step.mentorId = mentorId;
  step.targetCap = Math.min(mentorCap, entry.ceiling);
  if (!existingStep) plan.steps.push(step);
  saveState();
  return step;
}

/**
 * @param {TrainingPlan} plan
 * @param {TrainingStep} [existingStep]
 * @returns {Promise<TrainingStep|null>}
 */
async function openUpgradePicker(plan, existingStep) {
  const trainee = findTribesman(plan.traineeId);
  if (!trainee) return null;
  // Project the trainee through any prior steps so a Learn step earlier in
  // the plan can produce a talent that this Upgrade then bumps. Lets the
  // user queue "Learn X then Upgrade X to Lv 2 to Lv 3" without first
  // actually learning X.
  const projected = projectTraineeState(plan, existingStep) || trainee;
  const pool = getUpgradePool(projected);
  if (!pool.length) {
    await showAlertModal({
      title: 'Nothing to upgrade',
      message: `${trainee.name} has no talents below Lv 3 with a higher-level mentor in the roster.`,
    });
    return null;
  }

  const talentChoice = await showPickerModal({
    title: 'Pick a talent to upgrade',
    message: `For ${trainee.name}. One step = one level (sequential).`,
    options: pool.map(p => {
      const ready = p.mentors.filter(m => m.eligible).length;
      const total = p.mentors.length;
      const mentorTxt = ready === total ? `${total} mentor${total === 1 ? '' : 's'}` : `${ready}/${total} mentor${total === 1 ? '' : 's'} ready (others need Lv ${MENTOR_MIN_LEVEL})`;
      return {
        value: p.talent,
        label: p.talent,
        sublabel: `Current Lv ${p.currentLevel} → next Lv ${p.currentLevel + 1} · ${mentorTxt} (best Lv ${p.achievableLevel})`,
      };
    }),
  });
  if (!talentChoice) return null;
  const entry = pool.find(p => p.talent === talentChoice);
  if (!entry) return null;

  let mentorId;
  if (entry.mentors.length === 1) {
    mentorId = entry.mentors[0].id;
  } else {
    const choice = await showPickerModal({
      title: `Pick a mentor for ${entry.talent}`,
      options: entry.mentors.map(m => ({
        value: m.id,
        label: m.eligible ? m.name : `${m.name}  (Lv ${m.mentorLevel} — ⚠ needs Lv ${MENTOR_MIN_LEVEL})`,
        sublabel: `Has talent at Lv ${m.level}` + (m.eligible ? '' : ` · level them up first`),
      })),
    });
    if (!choice) return null;
    mentorId = choice;
  }

  const step = existingStep || newStep('upgrade');
  step.talent = entry.talent;
  step.mentorId = mentorId;
  step.targetLevel = entry.currentLevel + 1;
  if (!existingStep) plan.steps.push(step);
  saveState();
  return step;
}

/**
 * Two-step picker for Learn steps: pick a talent first (every learnable
 * talent in the trainee's mentor pool, deduped), then pick the mentor
 * (auto-skipped if exactly one mentor offers the talent). Used both when
 * adding a fresh Learn step and when changing the target on an existing one.
 *
 * @param {TrainingPlan} plan
 * @param {TrainingStep} [existingStep] update in place if provided
 * @returns {Promise<TrainingStep|null>} the created/updated step, or null on cancel
 */
async function openLearnTalentPicker(plan, existingStep) {
  const trainee = findTribesman(plan.traineeId);
  if (!trainee) return null;
  // Project so previously-queued Learn steps drop their target talents from
  // the pool — no point offering to learn the same thing twice.
  const projected = projectTraineeState(plan, existingStep) || trainee;
  const pool = getLearnTalentPool(projected);
  if (!pool.length) {
    await showAlertModal({
      title: 'No learnable talents',
      message: `No mentors in the current roster have a positive talent ${trainee.name} could learn.`,
    });
    return null;
  }

  const talentChoice = await showPickerModal({
    title: 'Pick a talent to learn',
    message: `For ${trainee.name}. Each option shows mentor readiness — entries with all mentors below Lv ${MENTOR_MIN_LEVEL} need levelling first.`,
    options: pool.map(t => {
      const ready = t.mentors.filter(m => m.eligible).length;
      const total = t.mentors.length;
      const mentorTxt = ready === total ? `${total} mentor${total === 1 ? '' : 's'}` : `${ready}/${total} mentor${total === 1 ? '' : 's'} ready`;
      return {
        value: t.name,
        label: t.name,
        sublabel: `${mentorTxt} · ${t.effect || 'no effect data'}`,
      };
    }),
  });
  if (!talentChoice) return null;

  const entry = pool.find(t => t.name === talentChoice);
  if (!entry) return null;

  let mentorId;
  if (entry.mentors.length === 1) {
    mentorId = entry.mentors[0].id;
  } else {
    const choice = await showPickerModal({
      title: `Pick a mentor for ${entry.name}`,
      message: `${entry.mentors.length} mentors can teach this talent. Mentors flagged ⚠ are below Lv ${MENTOR_MIN_LEVEL} and need to be levelled before they can train anyone.`,
      options: entry.mentors.map(m => ({
        value: m.id,
        label: m.eligible ? m.name : `${m.name}  (Lv ${m.mentorLevel} — ⚠ needs Lv ${MENTOR_MIN_LEVEL})`,
        sublabel: `Has talent at Lv ${m.level}` + (m.eligible ? '' : ` · level them up first`),
      })),
    });
    if (!choice) return null;
    mentorId = choice;
  }

  const step = existingStep || newStep('learn');
  step.talent = entry.name;
  step.mentorId = mentorId;
  if (!existingStep) plan.steps.push(step);
  saveState();
  return step;
}

window.onAddStep = async function(planId, type) {
  const plan = findPlan(planId);
  if (!plan) return;
  let step = null;
  if (type === 'cap-raise')   step = await openCapRaisePicker(plan);
  else if (type === 'upgrade') step = await openUpgradePicker(plan);
  else if (type === 'learn')   step = await openLearnTalentPicker(plan);
  else                          step = addStep(planId, type);
  if (!step) return;
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

// "Change target" handlers re-open the same picker for an existing step so
// the user can swap the goal without nuking and re-adding.
async function changeStepTarget(planId, stepId) {
  const plan = findPlan(planId);
  const step = findStep(plan, stepId);
  if (!plan || !step) return;
  if (step.type === 'cap-raise')   await openCapRaisePicker(plan, step);
  else if (step.type === 'upgrade') await openUpgradePicker(plan, step);
  else if (step.type === 'learn')   await openLearnTalentPicker(plan, step);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
}
window.onChangeStepTarget = changeStepTarget;
window.onChangeLearnTarget = changeStepTarget; // legacy alias

window.onRemoveStep = async function(planId, stepId) {
  const ok = await showConfirmModal({
    title: 'Remove this step?',
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  removeStep(planId, stepId);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onMoveStep = function(planId, stepId, dir) {
  moveStep(planId, stepId, dir);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

// Manual re-trigger for the Learn-step outcome modal — used when the user
// cancelled the original picker but later wants to record the outcome.
window.onApplyStepOutcome = async function(planId, stepId) {
  const plan = findPlan(planId);
  const s = findStep(plan, stepId);
  if (!s || s.appliedAt) return;
  await applyStepOutcomeToTrainee(plan, s);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onSetStepStatus = async function(planId, stepId, status) {
  const plan = findPlan(planId);
  const s = findStep(plan, stepId);
  if (!s) return;
  const wasCompleted = !!s.completedAt;
  s.status = status;
  if (status === 'running' && !s.startedAt) s.startedAt = new Date().toISOString();
  if (status === 'completed' && !s.completedAt) s.completedAt = new Date().toISOString();
  saveState();

  // First-time transition into completed: apply the step's outcome to the
  // trainee's data (cap raise → bump weapon cap; upgrade → bump talent level;
  // learn → ask the user which talent the random Learn produced).
  if (status === 'completed' && !wasCompleted && !s.appliedAt) {
    await applyStepOutcomeToTrainee(plan, s);
  }

  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

/**
 * @param {TrainingPlan} plan
 * @param {TrainingStep} step
 */
async function applyStepOutcomeToTrainee(plan, step) {
  const trainee = findTribesman(plan.traineeId);
  if (!trainee) return;

  if (step.type === 'cap-raise' && step.weapon && step.targetCap != null) {
    trainee.weapons = trainee.weapons || {};
    trainee.weapons[step.weapon] = trainee.weapons[step.weapon] || { current: null, cap: null };
    const cur = trainee.weapons[step.weapon].cap ?? 0;
    if (step.targetCap > cur) {
      trainee.weapons[step.weapon].cap = step.targetCap;
      step.appliedAt = new Date().toISOString();
      saveState();
    }
    return;
  }

  if (step.type === 'upgrade' && step.talent && step.targetLevel != null) {
    trainee.talents = trainee.talents || [];
    const tal = trainee.talents.find(t => t.name === step.talent);
    if (tal && step.targetLevel > (tal.level || 0)) {
      tal.level = step.targetLevel;
      step.appliedAt = new Date().toISOString();
      saveState();
    }
    return;
  }

  if (step.type === 'learn') {
    // Learn produces a random talent in-game; ask which one landed. Options
    // are the mentor's eligible-at-time-of-completion talents (positive,
    // not already on trainee, learnable by trainee).
    const mentor = findTribesman(step.mentorId);
    const knownNames = new Set((trainee.talents || []).map(t => t.name));
    const candidates = (mentor?.talents || []).filter(t => {
      const meta = talentMeta(t.name);
      return meta && meta.polarity === 'positive'
        && !knownNames.has(t.name)
        && isLearnableBy(t.name, trainee);
    });

    if (!candidates.length) {
      await showAlertModal({
        title: 'No outcome to record',
        message: mentor
          ? `${mentor.name} has no learnable talents for ${trainee.name} right now. The step is marked complete; add the talent manually if needed.`
          : `Mentor is missing for this step. The step is marked complete; add the learned talent manually on ${trainee.name}'s profile.`,
      });
      return;
    }

    // Promote the targeted talent to the top so the most likely outcome is the
    // first option — the user often just clicks it.
    const ordered = candidates.slice().sort((a, b) => {
      if (a.name === step.talent) return -1;
      if (b.name === step.talent) return 1;
      return 0;
    });

    const pick = await showPickerModal({
      title: `Which talent did ${trainee.name} learn?`,
      message: step.talent
        ? `You targeted "${step.talent}". Confirm if it landed, or pick the actual roll.`
        : 'Learn produces a random talent in-game; pick the one that actually landed.',
      options: ordered.map(t => {
        const meta = talentMeta(t.name);
        const isTarget = t.name === step.talent;
        return {
          value: t.name,
          label: isTarget ? `${t.name}  ★` : t.name,
          sublabel: (isTarget ? '(targeted) · ' : '') + (meta?.effect || ''),
        };
      }),
    });

    if (!pick) return; // user cancelled — leave appliedAt unset so they can retry by re-marking complete

    trainee.talents = trainee.talents || [];
    if (!trainee.talents.some(t => t.name === pick)) {
      const meta = talentMeta(pick);
      trainee.talents.push({
        name: pick,
        level: 1,
        icon: meta?.icon || '',
      });
    }
    step.appliedAt = new Date().toISOString();
    saveState();
  }
}

window.onSetPlanStatus = function(planId, status) {
  const p = findPlan(planId);
  if (!p) return;
  p.status = status;
  saveState();
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onCreatePlan = async function() {
  if (!state.roster.length) {
    await showConfirmModal({ title: 'No tribesmen yet', message: 'Add a tribesman first via "+ Add Tribesman" in the topbar.', confirmLabel: 'OK', cancelLabel: '' });
    return;
  }
  // Roster picker, alphabetical: each tribesman is a clickable card.
  const sorted = [...state.roster].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const trainee = await showPickerModal({
    title: 'New plan — pick trainee',
    options: sorted.map(t => ({
      value: t,
      label: t.name,
      sublabel: [t.title, t.profession, t.tribe].filter(Boolean).join(' · '),
    })),
  });
  if (!trainee) return;
  const name = await showInputModal({
    title: 'Plan name',
    defaultValue: `${trainee.name} — new plan`,
    confirmLabel: 'Create plan',
  });
  if (name === null) return;
  const p = createPlan(trainee.id, name || `${trainee.name} — new plan`);
  ui.showPlan(p.id);
};

window.onDeletePlan = async function(id) {
  const p = findPlan(id);
  if (!p) return;
  const ok = await showConfirmModal({
    title: 'Delete plan?',
    message: `"${p.name}" will be deleted. This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  deletePlan(id);
  ui.showPlans();
};

window.onDuplicatePlan = function(id) {
  const copy = duplicatePlan(id);
  if (copy) ui.showPlan(copy.id);
};

window.onCalibrate = function(group, key, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return;
  state.calibration[group][key] = n;
  saveState();
  if (state.selectedPlanId) renderPlanEditor(state.selectedPlanId);
  else renderPlansList();
};

window.onResetCalibration = async function() {
  const ok = await showConfirmModal({
    title: 'Reset calibration?',
    message: 'All base times and material multipliers will return to placeholder defaults. Any custom values you tuned will be lost.',
    confirmLabel: 'Reset to defaults',
  });
  if (!ok) return;
  state.calibration = defaultCalibration();
  saveState();
  if (state.selectedPlanId) renderPlanEditor(state.selectedPlanId);
  else renderPlansList();
};

// --- Suggestion → Plan handoff ---------------------------------------------

// Convert a structured Training Suggestion into a fresh TrainingStep with as
// many fields pre-filled as the suggestion lets us. Mentor defaults to the
// top candidate; user can swap it in the plan editor.
/** @param {TrainingSuggestion} suggestion @returns {TrainingStep} */
/**
 * For a trainee, returns the deduped pool of positive talents the trainee
 * doesn't have and can legally learn, with every mentor that offers each one.
 * Mentors per-talent are sorted highest-mentor-level first as a mastery signal
 * (Learn always lands at Lv 1 in-game regardless of mentor level).
 * @param {Tribesman} trainee
 * @returns {Array<{name: string, effect: string, icon: string, mentors: Array<{id: string, name: string, level: number}>}>}
 */
function getLearnTalentPool(trainee) {
  if (!trainee) return [];
  const knownNames = new Set((trainee.talents || []).map(t => t.name));
  /** @type {Map<string, {name: string, effect: string, icon: string, mentors: Array<{id: string, name: string, mentorLevel: number, level: number, eligible: boolean}>}>} */
  const acc = new Map();
  for (const m of state.roster) {
    if (m.id === trainee.id) continue;
    for (const t of (m.talents || [])) {
      const meta = talentMeta(t.name);
      if (!meta || meta.polarity !== 'positive') continue;
      if (knownNames.has(t.name)) continue;
      if (!isLearnableBy(t.name, trainee)) continue;
      let entry = acc.get(t.name);
      if (!entry) {
        entry = { name: t.name, effect: meta.effect || '', icon: meta.icon || t.icon || '', mentors: [] };
        acc.set(t.name, entry);
      }
      entry.mentors.push({ id: m.id, name: m.name, mentorLevel: m.level || 0, level: t.level, eligible: isMentorEligible(m) });
    }
  }
  const out = [...acc.values()];
  for (const e of out) e.mentors.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.level - a.level || a.name.localeCompare(b.name));
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * @param {TrainingSuggestion} suggestion
 * @param {Tribesman} [trainee] - required to seed Learn target talent
 * @returns {TrainingStep}
 */
function suggestionToStep(suggestion, trainee) {
  const step = newStep(suggestion.type);
  step.mentorId = suggestion.mentorIds?.[0] || null;
  if (suggestion.type === 'cap-raise') {
    step.weapon = suggestion.weapon;
    step.targetCap = suggestion.targetCap;
  } else if (suggestion.type === 'upgrade') {
    step.talent = suggestion.talent;
    step.targetLevel = suggestion.targetLevel;
  } else if (suggestion.type === 'learn' && trainee) {
    // Pick a default target from the pool: highest top-mentor level, then
    // alphabetical. User can swap via "Change target" in the editor.
    const pool = getLearnTalentPool(trainee);
    if (pool.length) {
      const top = pool.slice().sort((a, b) =>
        (b.mentors[0]?.level || 0) - (a.mentors[0]?.level || 0)
        || a.name.localeCompare(b.name)
      )[0];
      step.talent = top.name;
      step.mentorId = top.mentors[0].id;
    }
  }
  return step;
}

// One-click materialize the trainee's Training Suggestions into a draft
// plan. Ordering rationale (per #21): cap raises gate weapon power and so
// front-load the most leverage, learns broaden the talent pool, upgrades
// polish what's already there. Capped at 5 steps so the plan stays
// scannable; user can extend manually.
const SUGGEST_PLAN_STEP_BUDGET = 5;

/** @param {string} traineeId @returns {TrainingPlan|null} */
function suggestPlanFor(traineeId) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return null;
  const suggestions = getTrainingSuggestions(trainee);
  if (!suggestions.length) return null;

  // Sort cap-raises by gap descending (biggest improvement first); learns
  // and upgrades retain their natural order from getTrainingSuggestions.
  const capRaises = suggestions
    .filter(s => s.type === 'cap-raise')
    .slice()
    .sort((a, b) => (b.targetCap - b.currentCap) - (a.targetCap - a.currentCap));
  const learns = suggestions.filter(s => s.type === 'learn');
  const upgrades = suggestions.filter(s => s.type === 'upgrade');
  const ordered = [...capRaises, ...learns, ...upgrades].slice(0, SUGGEST_PLAN_STEP_BUDGET);

  const plan = createPlan(traineeId, `${trainee.name} — suggested plan`);
  for (const s of ordered) plan.steps.push(suggestionToStep(s, trainee));
  saveState();
  return plan;
}

window.onSuggestPlan = function(traineeId) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return;
  const suggestions = getTrainingSuggestions(trainee);
  if (!suggestions.length) {
    showAlertModal({
      title: 'No training opportunities',
      message: `${trainee.name} has nothing trainable from the current roster — caps maxed and talents already learned.`,
    });
    return;
  }
  const plan = suggestPlanFor(traineeId);
  if (plan) ui.showPlan(plan.id);
};

// Picker dialog: "add to existing plan" or "start a new plan". Renders into
// the existing modal scaffolding (#modal-bg / #modal). Plain DOM, no framework.
window.onAddSuggestionToPlan = async function(traineeId, suggestionIndex) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return;
  const suggestion = getTrainingSuggestions(trainee)[suggestionIndex];
  if (!suggestion) return;

  const existing = state.plans.filter(p =>
    p.traineeId === traineeId && (p.status === 'draft' || p.status === 'active')
  );

  // Build a picker: each existing plan is a card; "Start a new plan" is its own
  // card at the bottom. Single click → resolves immediately, no radios + tiny
  // dropdown to wrestle with.
  const NEW_PLAN_SENTINEL = '__new__';
  const options = [
    ...existing.map(p => ({
      value: p.id,
      label: `Add to: ${p.name || 'Untitled'}`,
      sublabel: `${p.steps.length} step${p.steps.length === 1 ? '' : 's'} · ${p.status}`,
    })),
    {
      value: NEW_PLAN_SENTINEL,
      label: 'Start a new plan',
      sublabel: existing.length ? 'Create a separate plan for this step' : '',
    },
  ];

  const choice = await showPickerModal({
    title: 'Add to plan',
    message: suggestion.head,
    options,
  });
  if (!choice) return;

  let plan;
  if (choice === NEW_PLAN_SENTINEL) {
    const name = await showInputModal({
      title: 'New plan name',
      defaultValue: `${trainee.name} — ${PLAN_STEP_LABELS[suggestion.type]}`,
      confirmLabel: 'Create plan',
    });
    if (name === null) return; // user cancelled the second step; abort cleanly
    plan = createPlan(traineeId, name || `${trainee.name} — new plan`);
  } else {
    plan = findPlan(choice);
    if (!plan) return;
  }

  // Learn suggestion is the lumped "you could learn N more talents" entry —
  // route it through the talent-first picker so the user picks a specific
  // target rather than getting an empty Learn step.
  if (suggestion.type === 'learn') {
    const step = await openLearnTalentPicker(plan);
    if (!step) return;
  } else {
    plan.steps.push(suggestionToStep(suggestion, trainee));
    saveState();
  }
  ui.showPlan(plan.id);
};

// --- Renderers -------------------------------------------------------------

function renderPlansList() {
  const mount = document.getElementById('plans-content');
  if (!mount) return;
  const plans = state.plans;
  let html = `<div class="plans-header">
    <h2>Training Plans</h2>
    <button class="primary" onclick="onCreatePlan()">+ New Plan</button>
  </div>`;

  if (!plans.length) {
    html += `<p class="muted">No plans yet. Click <b>+ New Plan</b> to commit a multi-step training agenda for a tribesman.</p>`;
  } else {
    // Mentor-commitment count: tribesmen mentoring in active plans
    const mentorActive = new Map();
    for (const p of plans) {
      if (p.status !== 'active' && p.status !== 'draft') continue;
      for (const s of p.steps) {
        if (!s.mentorId) continue;
        if (s.status === 'completed' || s.status === 'abandoned') continue;
        mentorActive.set(s.mentorId, (mentorActive.get(s.mentorId) || 0) + 1);
      }
    }

    html += `<table class="plans-table"><thead><tr>
      <th>Plan</th><th>Trainee</th><th>Mentors</th><th>Status</th><th>Steps</th><th>Est. time</th><th>Created</th><th></th>
    </tr></thead><tbody>`;

    for (const p of plans) {
      const trainee = findTribesman(p.traineeId);
      const mentorIds = [...new Set(p.steps.map(s => s.mentorId).filter(Boolean))];
      const mentors = mentorIds
        .map(id => findTribesman(id))
        .filter(Boolean)
        .map(m => escapeHtml(m.name))
        .join(', ');
      const completed = p.steps.filter(s => s.status === 'completed').length;
      const created = p.createdAt?.slice(0, 10) || '—';
      html += `<tr onclick="ui.showPlan('${p.id}')">
        <td><b>${escapeHtml(p.name || 'Untitled')}</b></td>
        <td>${trainee ? escapeHtml(trainee.name) : '<span class="muted">missing</span>'}</td>
        <td>${mentors || '<span class="muted">—</span>'}</td>
        <td><span class="plan-status plan-status-${p.status}">${p.status}</span></td>
        <td>${completed}/${p.steps.length}</td>
        <td>${fmtMinutes(estimatePlanMin(p))}</td>
        <td>${created}</td>
        <td><button onclick="event.stopPropagation();onDeletePlan('${p.id}')" class="danger small">Delete</button></td>
      </tr>`;
    }

    html += `</tbody></table>`;

    if (mentorActive.size) {
      const items = [...mentorActive.entries()]
        .filter(([,n]) => n > 1)
        .sort((a,b) => b[1] - a[1])
        .map(([id,n]) => {
          const m = findTribesman(id);
          return `<li><b>${escapeHtml(m?.name || 'unknown')}</b> is mentor in ${n} active step${n===1?'':'s'}</li>`;
        });
      if (items.length) {
        html += `<div class="plans-warnings"><h3>Mentor commitments</h3>
          <p class="muted">Training Ground only allows one session per mentor at a time.</p>
          <ul>${items.join('')}</ul></div>`;
      }
    }
  }

  html += renderCalibrationPanel();
  mount.innerHTML = html;
}

function renderPlanEditor(id) {
  const mount = document.getElementById('plans-content');
  if (!mount) return;
  const p = findPlan(id);
  if (!p) { renderPlansList(); return; }
  const trainee = findTribesman(p.traineeId);
  const completed = p.steps.filter(s => s.status === 'completed').length;
  const total = estimatePlanMin(p);

  let html = `<div class="plans-header">
    <button class="linklike" onclick="ui.showPlans()">← All plans</button>
  </div>`;

  html += `<div class="card full-row plan-editor-head">
    <div class="plan-name-row">
      <input class="plan-name-input" value="${escapeHtml(p.name || '')}"
        oninput="planFieldUpd('${p.id}','name',this.value)" placeholder="Plan name…">
      <span class="plan-status plan-status-${p.status}">${p.status}</span>
    </div>
    <div class="plan-meta">
      <span>Trainee: <b>${trainee ? escapeHtml(trainee.name) : '<span class="muted">missing</span>'}</b></span>
      <span>Created: ${p.createdAt?.slice(0,10) || '—'}</span>
      <span>Progress: <b>${completed}/${p.steps.length}</b></span>
      <span>Estimated: <b>${fmtMinutes(total)}</b></span>
    </div>
    <div class="plan-actions">
      <button onclick="onSetPlanStatus('${p.id}','active')">Mark Active</button>
      <button onclick="onSetPlanStatus('${p.id}','done')">Mark Complete</button>
      <button onclick="onSetPlanStatus('${p.id}','abandoned')">Abandon</button>
      <button onclick="onDuplicatePlan('${p.id}')">Duplicate</button>
      <button class="danger" onclick="onDeletePlan('${p.id}')">Delete</button>
    </div>
    <div class="field"><label>Notes</label>
      <textarea oninput="planFieldUpd('${p.id}','notes',this.value)" placeholder="Long-form notes…">${escapeHtml(p.notes || '')}</textarea>
    </div>
  </div>`;

  // Steps
  html += `<div class="card full-row plan-steps">
    <h3>Steps</h3>`;
  if (!p.steps.length) {
    html += `<p class="muted">No steps yet. Add one below.</p>`;
  } else {
    html += p.steps.map((s, i) => renderPlanStep(p, s, i)).join('');
  }
  html += `<div class="add-step-row">
    <span class="muted">Add step:</span>
    <button onclick="onAddStep('${p.id}','cap-raise')">+ Cap Raise</button>
    <button onclick="onAddStep('${p.id}','learn')">+ Learn Talent</button>
    <button onclick="onAddStep('${p.id}','upgrade')">+ Upgrade Talent</button>
  </div>`;
  html += `</div>`;

  html += renderCalibrationPanel();
  mount.innerHTML = html;
}

function renderPlanStep(plan, step, index) {
  const trainee = findTribesman(plan.traineeId);
  const isLast = index === plan.steps.length - 1;
  const isFirst = index === 0;
  const dur = fmtMinutes(estimateStepMin(step));
  const label = PLAN_STEP_LABELS[step.type] || step.type;
  const mentorMissing = step.mentorId && !findTribesman(step.mentorId);
  const assignedMentor = step.mentorId ? findTribesman(step.mentorId) : null;
  const mentorTooLow = !!assignedMentor && !isMentorEligible(assignedMentor);

  // Build mentor candidates per step type
  const mentors = state.roster.filter(m => m.id !== plan.traineeId);
  let eligibleMentors = mentors;
  if (step.type === 'cap-raise' && step.weapon && trainee) {
    const traineeCap = trainee.weapons?.[step.weapon]?.cap ?? 0;
    eligibleMentors = mentors.filter(m => (m.weapons?.[step.weapon]?.cap || 0) > traineeCap);
  } else if (step.type === 'upgrade' && step.talent) {
    eligibleMentors = mentors.filter(m =>
      (m.talents || []).some(t => t.name === step.talent && t.level > (
        (trainee?.talents || []).find(tt => tt.name === step.talent)?.level || 0
      ))
    );
  } else if (step.type === 'learn' && trainee) {
    if (step.talent) {
      // Once a target is set, only mentors who actually have that talent are
      // valid for this step. Lets the user swap mentor without abandoning the
      // target.
      eligibleMentors = mentors.filter(m =>
        (m.talents || []).some(t => t.name === step.talent)
      );
    } else {
      // No target picked yet — fall back to "any mentor who could teach
      // anything". Rare since the picker is now the entry point for Learn.
      const knownNames = new Set((trainee.talents || []).map(t => t.name));
      eligibleMentors = mentors.filter(m =>
        (m.talents || []).some(t => {
          const meta = talentMeta(t.name);
          return meta && meta.polarity === 'positive'
            && !knownNames.has(t.name)
            && isLearnableBy(t.name, trainee);
        })
      );
    }
  }

  // Sort eligible (Lv MENTOR_MIN_LEVEL+) candidates first; sub-level mentors
  // stay in the list with a "(Lv X — needs Lv 50)" suffix so they can still be
  // picked but the constraint is visible at a glance.
  const sortedMentors = eligibleMentors.slice().sort((a, b) =>
    Number(isMentorEligible(b)) - Number(isMentorEligible(a))
    || (a.name || '').localeCompare(b.name || '')
  );
  const mentorOpts = [`<option value="">— pick mentor —</option>`]
    .concat(sortedMentors.map(m => {
      let detail = '';
      if (step.type === 'cap-raise' && step.weapon) detail = ` (${step.weapon} ${m.weapons?.[step.weapon]?.cap || '—'})`;
      else if (step.type === 'upgrade' && step.talent) {
        const t = (m.talents||[]).find(tt => tt.name === step.talent);
        detail = t ? ` (Lv ${t.level})` : '';
      }
      const levelSuffix = isMentorEligible(m) ? '' : ` — Lv ${m.level || 0} ⚠ needs Lv ${MENTOR_MIN_LEVEL}`;
      return `<option value="${m.id}" ${m.id === step.mentorId ? 'selected' : ''}>${escapeHtml(m.name)}${escapeHtml(detail)}${escapeHtml(levelSuffix)}</option>`;
    })).join('');

  // Type-specific subject pickers
  const mentor = step.mentorId ? findTribesman(step.mentorId) : null;

  let subject = '';
  if (step.type === 'cap-raise') {
    const ceiling = trainee && step.weapon ? weaponCeiling(trainee.profession, step.weapon) : null;
    const traineeCap = trainee && step.weapon ? (trainee.weapons?.[step.weapon]?.cap ?? '—') : '—';
    const mentorCap = mentor && step.weapon ? (mentor.weapons?.[step.weapon]?.cap ?? null) : null;
    subject = `<label>Weapon</label>
      <select onchange="stepFieldUpd('${plan.id}','${step.id}','weapon',this.value)">
        <option value="">— pick weapon —</option>
        ${WEAPONS.map(w => `<option value="${w}" ${w === step.weapon ? 'selected' : ''}>${w}</option>`).join('')}
      </select>
      <label>Target cap</label>
      <input type="number" min="1" max="125" value="${step.targetCap ?? ''}"
        placeholder="${ceiling ?? ''}"
        oninput="stepFieldUpd('${plan.id}','${step.id}','targetCap',this.value)">
      ${step.weapon ? `<span class="muted small">trainee ${traineeCap} → ceiling ${ceiling}${mentorCap ? ` · mentor ${mentorCap}` : ''}</span>` : ''}`;
  } else if (step.type === 'upgrade') {
    const traineeTalents = (trainee?.talents || []).filter(t => (t.level || 0) < 3);
    // Show the picked talent's icon + tooltip (with the mentor's level for context)
    let upgradePreview = '';
    if (step.talent) {
      const traineeT = (trainee?.talents || []).find(t => t.name === step.talent);
      const mentorT = (mentor?.talents || []).find(t => t.name === step.talent);
      if (traineeT) {
        const meta = talentMeta(step.talent);
        const previewTalent = { ...traineeT, icon: traineeT.icon || meta?.icon };
        const mentorLvl = mentorT ? `mentor Lv ${mentorT.level}` : (mentor ? 'mentor doesn\'t have this talent' : '');
        upgradePreview = `<div class="plan-step-talent-preview">
          ${renderTalentIconRow([previewTalent])}
          <span class="muted small">trainee Lv ${traineeT.level}${mentorLvl ? ' · ' + mentorLvl : ''}</span>
        </div>`;
      }
    }
    subject = `<label>Talent</label>
      <select onchange="stepFieldUpd('${plan.id}','${step.id}','talent',this.value)">
        <option value="">— pick talent —</option>
        ${traineeTalents.map(t => `<option value="${escapeHtml(t.name)}" ${t.name === step.talent ? 'selected' : ''}>${escapeHtml(t.name)} (Lv ${t.level})</option>`).join('')}
      </select>
      <label>Target Lv</label>
      <select onchange="stepFieldUpd('${plan.id}','${step.id}','targetLevel',this.value)">
        ${[2,3].map(lv => `<option value="${lv}" ${lv === step.targetLevel ? 'selected' : ''}>Lv ${lv}</option>`).join('')}
      </select>
      ${upgradePreview}`;
  } else if (step.type === 'learn') {
    // Targeted Learn: show the goal talent prominently, plus the other
    // talents the mentor's pool might roll instead (Learn is random in-game).
    if (!step.talent) {
      // Legacy / unset — let user open the picker.
      subject = `<span class="muted small">No target talent picked yet.</span>
        <button class="small" onclick="onChangeStepTarget('${plan.id}','${step.id}')">Pick a target</button>`;
    } else {
      const targetMeta = talentMeta(step.talent);
      const targetIcon = renderTalentIconRow([{ name: step.talent, level: 1, icon: targetMeta?.icon }]);
      let othersHtml = '';
      if (mentor && trainee) {
        const knownNames = new Set((trainee.talents || []).map(t => t.name));
        const others = (mentor.talents || []).filter(t => {
          if (t.name === step.talent) return false;
          const tm = talentMeta(t.name);
          return tm && tm.polarity === 'positive'
            && !knownNames.has(t.name)
            && isLearnableBy(t.name, trainee);
        });
        if (others.length) {
          othersHtml = `<div class="learn-other-outcomes">
            <span class="muted small">Other possible rolls (${others.length}) from this mentor:</span>
            ${renderTalentIconRow(others)}
          </div>`;
        }
      }
      subject = `<div class="plan-step-talent-preview">
          ${targetIcon}
          <span class="muted small"><b>Target:</b> ${escapeHtml(step.talent)} · all rolls land at Lv I</span>
          <button class="small" onclick="onChangeStepTarget('${plan.id}','${step.id}')">Change target</button>
        </div>
        ${othersHtml}`;
    }
  }

  const statusBtns = STEP_STATUSES.map(st =>
    `<button class="${step.status === st ? 'primary small' : 'small'}" onclick="onSetStepStatus('${plan.id}','${step.id}','${st}')">${st}</button>`
  ).join('');

  // Step's outcome state: applied (pushed to trainee), pending (completed
  // but Learn-cancel-without-pick), or untouched.
  const applied = !!step.appliedAt;
  const pendingApply = step.status === 'completed' && !applied;
  const applyBtn = step.type === 'learn' && pendingApply
    ? `<button class="small" onclick="onApplyStepOutcome('${plan.id}','${step.id}')" title="Re-prompt for the talent that was learned">Apply outcome</button>`
    : '';

  return `<div class="plan-step plan-step-${step.type} status-${step.status}${mentorMissing ? ' mentor-missing' : ''}${mentorTooLow ? ' mentor-too-low' : ''}${applied ? ' applied' : ''}">
    <div class="plan-step-head">
      <span class="step-num">#${index + 1}</span>
      <span class="step-type">${label}</span>
      <span class="step-dur">${dur}</span>
      ${mentorMissing ? '<span class="step-warn">⚠ mentor missing</span>' : ''}
      ${mentorTooLow ? `<span class="step-warn" title="${escapeHtml(assignedMentor.name)} is Lv ${assignedMentor.level || 0}; mentors must be Lv ${MENTOR_MIN_LEVEL} to train.">⚠ mentor needs Lv ${MENTOR_MIN_LEVEL}</span>` : ''}
      ${applied ? '<span class="step-applied" title="Outcome pushed to trainee">✓ applied</span>' : ''}
      ${applyBtn}
      <span class="grow"></span>
      <button class="small" onclick="onMoveStep('${plan.id}','${step.id}',-1)" ${isFirst ? 'disabled' : ''}>↑</button>
      <button class="small" onclick="onMoveStep('${plan.id}','${step.id}',1)" ${isLast ? 'disabled' : ''}>↓</button>
      <button class="small danger" onclick="onRemoveStep('${plan.id}','${step.id}')">×</button>
    </div>
    <div class="plan-step-body">
      <div class="plan-step-fields">
        <label>Mentor</label>
        <select onchange="stepFieldUpd('${plan.id}','${step.id}','mentorId',this.value)">${mentorOpts}</select>
        ${subject}
        <label>Material</label>
        <select onchange="stepFieldUpd('${plan.id}','${step.id}','material',this.value)">
          ${MATERIAL_TIERS.map(t => `<option value="${t}" ${t === step.material ? 'selected' : ''}>${MATERIAL_NAMES[t]} (Tier ${ROMAN_TIERS[t]} ×${state.calibration.tierMultipliers[t]})</option>`).join('')}
        </select>
      </div>
      <div class="plan-step-status">
        <div class="status-pills">${statusBtns}</div>
        <input type="text" placeholder="Step note…" value="${escapeHtml(step.note || '')}"
          oninput="stepFieldUpd('${plan.id}','${step.id}','note',this.value)">
      </div>
    </div>
  </div>`;
}

// Profile-side Plans card: surfaces both directions (this tribesman as trainee
// and as mentor). Q6 warning fires when they're trainee on >1 active plan
// (Training Ground only allows one trainee session at a time).
function renderProfileTrainingPlans(tribesman) {
  const asTrainee = state.plans.filter(p => p.traineeId === tribesman.id);
  const asMentor = state.plans.filter(p =>
    p.traineeId !== tribesman.id &&
    p.steps.some(s => s.mentorId === tribesman.id)
  );

  const activeTraineeCount = asTrainee.filter(p =>
    p.status === 'active' || p.status === 'draft'
  ).filter(p => p.steps.some(s => s.status !== 'completed' && s.status !== 'abandoned')).length;

  let html = '';

  if (activeTraineeCount > 1) {
    html += `<div class="profile-plans-warning">
      ⚠ ${escapeHtml(tribesman.name)} is the trainee on ${activeTraineeCount} active plans —
      the Training Ground only allows one trainee session at a time.
    </div>`;
  }

  html += `<div class="profile-plans-actions">
    <button class="small" onclick="onCreatePlanForTribesman('${tribesman.id}')">+ New plan for ${escapeHtml(tribesman.name)}</button>
  </div>`;

  if (!asTrainee.length && !asMentor.length) {
    html += `<p class="muted">No plans reference ${escapeHtml(tribesman.name)} yet. Use <b>+ Add to plan</b> on a Training Suggestion above to commit one.</p>`;
    return html;
  }

  if (asTrainee.length) {
    html += `<h4 class="profile-plans-h">As trainee</h4><ul class="profile-plans-list">${
      asTrainee.map(p => renderProfilePlanRow(p, 'trainee', tribesman.id)).join('')
    }</ul>`;
  }
  if (asMentor.length) {
    html += `<h4 class="profile-plans-h">As mentor</h4><ul class="profile-plans-list">${
      asMentor.map(p => renderProfilePlanRow(p, 'mentor', tribesman.id)).join('')
    }</ul>`;
  }

  return html;
}

function renderProfilePlanRow(plan, role, tribesmanId) {
  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const total = estimatePlanMin(plan);
  const trainee = findTribesman(plan.traineeId);
  let detail = '';
  if (role === 'mentor') {
    const mySteps = plan.steps.filter(s => s.mentorId === tribesmanId);
    detail = ` — mentoring ${mySteps.length} step${mySteps.length === 1 ? '' : 's'} for ${trainee ? escapeHtml(trainee.name) : '<span class="muted">missing</span>'}`;
  }
  return `<li>
    <a href="javascript:void(0)" onclick="ui.showPlan('${plan.id}')"><b>${escapeHtml(plan.name || 'Untitled')}</b></a>
    <span class="plan-status plan-status-${plan.status}">${plan.status}</span>
    <span class="muted small">${completed}/${plan.steps.length} steps · ${fmtMinutes(total)}${detail}</span>
  </li>`;
}

window.onCreatePlanForTribesman = async function(traineeId) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return;
  const name = await showInputModal({
    title: 'New plan',
    message: `For ${trainee.name}.`,
    defaultValue: `${trainee.name} — new plan`,
    confirmLabel: 'Create plan',
  });
  if (name === null) return;
  const p = createPlan(traineeId, name || `${trainee.name} — new plan`);
  ui.showPlan(p.id);
};

function renderCalibrationPanel() {
  const c = state.calibration;
  const baseRows = Object.entries(c.baseTimes).map(([k, v]) =>
    `<tr><td>${k}</td><td><input type="number" min="1" value="${v}" oninput="onCalibrate('baseTimes','${k}',this.value)"> min</td></tr>`
  ).join('');
  const tierRows = MATERIAL_TIERS.map(t =>
    `<tr><td>${MATERIAL_NAMES[t]} <span class="muted small">(${ROMAN_TIERS[t]})</span></td>
      <td><input type="number" min="0.1" step="0.05" value="${c.tierMultipliers[t] ?? 1}" oninput="onCalibrate('tierMultipliers','${t}',this.value)">×</td></tr>`
  ).join('');
  return `<details class="calibration-panel">
    <summary>Calibration constants <span class="muted small">(edit if your timings differ)</span></summary>
    <div class="calibration-grid">
      <div>
        <h4>Base times</h4>
        <table><tbody>${baseRows}</tbody></table>
      </div>
      <div>
        <h4>Material multiplier</h4>
        <table><tbody>${tierRows}</tbody></table>
      </div>
    </div>
    <p class="muted small">Material tier (Beast Hide → Endgame) affects training duration. Quality (the I-VI badges) and Mod do not — confirmed in-game. All values here are placeholders until measured. See <code>docs/training_plans.md</code>.</p>
    <button class="small" onclick="onResetCalibration()">Reset to defaults</button>
  </details>`;
}

// === ADD TRIBESMAN ===
async function addTribesman() {
  const name = await showInputModal({
    title: 'New tribesman',
    placeholder: 'Tribesman name…',
    confirmLabel: 'Add',
  });
  if (!name) return;
  const t = {
    id: newId(), name, level: null, title: '', profession: '', tribe: '',
    trait: '', location: '', is_body: false,
    skills: Object.fromEntries(SKILLS.map(s => [s, {current:null, cap:null}])),
    weapons: Object.fromEntries(WEAPONS.map(w => [w, {current:null, cap:null}])),
    attrs: Object.fromEntries(ATTRS.map(a => [a, null])),
    talents: [], groups: [], tags: [], notes: '',
  };
  state.roster.push(t);
  saveState();
  initFilters();
  renderRoster();
  ui.showProfile(t.id);
}

// Deep-clone a tribesman with a fresh id. Resets is_body (the body flag is
// tied to the original character corpse in-game) but keeps talents, skills,
// weapons, attrs, groups, tags, and notes — that's the whole point of
// duplication: planning "what if I built another one like this".
/** @param {string} id @returns {Tribesman|null} */
function duplicateTribesman(id) {
  const src = state.roster.find(t => t.id === id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newId();
  copy.name = `${src.name} (copy)`;
  copy.is_body = false;
  state.roster.push(copy);
  saveState();
  initFilters();
  return copy;
}

window.onDuplicateTribesman = function(id) {
  const copy = duplicateTribesman(id);
  if (!copy) return;
  renderRoster();
  ui.showProfile(copy.id);
};

// === BIND UI ===
function bindUI() {
  document.getElementById('nav-roster').addEventListener('click', () => ui.showRoster());
  document.getElementById('nav-profile').addEventListener('click', () => {
    if (state.selectedId) ui.showProfile(state.selectedId);
    else if (state.roster.length) ui.showProfile(state.roster[0].id);
  });
  document.getElementById('nav-plans').addEventListener('click', () => {
    if (state.selectedPlanId && state.plans.some(p => p.id === state.selectedPlanId)) {
      ui.showPlan(state.selectedPlanId);
    } else {
      ui.showPlans();
    }
  });
  document.getElementById('add-btn').addEventListener('click', addTribesman);
  for (const f of ['filter-name','filter-prof','filter-tribe','filter-group','filter-tag']) {
    document.getElementById(f).addEventListener('input', renderRoster);
    document.getElementById(f).addEventListener('change', renderRoster);
  }
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('export-json').addEventListener('click', exportJSON);
  document.getElementById('reset-defaults').addEventListener('click', async () => {
    const ok = await showConfirmModal({
      title: 'Reset to default roster?',
      message: 'Your current roster, plans, calibration, and any other local data will be wiped and replaced with the bootstrap roster. This cannot be undone — back up first if you want to keep anything.',
      confirmLabel: 'Wipe and reset',
      danger: true,
    });
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    await loadDefaults();
    initFilters();
    renderRoster();
    ui.showRoster();
  });
  let importMode = null;
  document.getElementById('import-csv').addEventListener('click', () => {
    importMode = 'csv';
    document.getElementById('file-input').click();
  });
  document.getElementById('import-json').addEventListener('click', () => {
    importMode = 'json';
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (importMode === 'csv') importCSV(ev.target.result);
      else importJSON(ev.target.result);
    };
    reader.readAsText(f);
    e.target.value = '';
  });
}

// === UTILITY ===
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// === MODAL HELPERS ===
// Promise-based wrappers around the existing #modal-bg / #modal scaffolding,
// so we don't need to use the browser's native prompt/confirm/alert. Each
// helper returns a Promise that resolves with the user's choice (or null on
// cancel) — let `await` handle the flow at the call site.

let __modalResolve = null;

function _openModal(html, opts = {}) {
  return new Promise(resolve => {
    __modalResolve = (val) => {
      __modalResolve = null;
      resolve(val);
      document.getElementById('modal-bg').classList.remove('active');
      document.getElementById('modal').innerHTML = '';
      document.removeEventListener('keydown', _modalKeydown);
    };
    document.getElementById('modal').innerHTML = html;
    document.getElementById('modal-bg').classList.add('active');
    document.addEventListener('keydown', _modalKeydown);
    if (typeof opts.afterOpen === 'function') opts.afterOpen();
  });
}
window.__resolveModal = (val) => { if (__modalResolve) __modalResolve(val); };

function _modalKeydown(ev) {
  if (ev.key === 'Escape') { ev.preventDefault(); window.__resolveModal(null); }
  if (ev.key === 'Enter') {
    const submit = document.querySelector('#modal .modal-submit');
    const target = ev.target;
    // Don't intercept Enter inside textareas or buttons (button has its own handler).
    if (target?.tagName === 'TEXTAREA' || target?.tagName === 'BUTTON') return;
    if (submit) { ev.preventDefault(); submit.click(); }
  }
}

function showInputModal({title, message = '', defaultValue = '', placeholder = '', confirmLabel = 'OK', cancelLabel = 'Cancel'}) {
  const html = `
    <h3>${escapeHtml(title)}</h3>
    ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
    <div class="field">
      <input id="modal-input" type="text" value="${escapeHtml(defaultValue)}" placeholder="${escapeHtml(placeholder)}">
    </div>
    <div class="actions">
      <button onclick="__resolveModal(null)">${escapeHtml(cancelLabel)}</button>
      <button class="primary modal-submit" onclick="__resolveModal(document.getElementById('modal-input').value)">${escapeHtml(confirmLabel)}</button>
    </div>`;
  return _openModal(html, {
    afterOpen: () => {
      const input = document.getElementById('modal-input');
      input?.focus();
      input?.select();
    },
  });
}

// Renders a vertical list of clickable item-buttons. Each option:
//   { value, label, sublabel?, danger? }
// Clicking an item resolves the promise immediately with the value.
function showPickerModal({title, message = '', options, cancelLabel = 'Cancel'}) {
  // Stash by index so we don't have to JSON-serialize values into onclick attributes.
  window.__modalPickerOptions = options;
  const itemsHtml = options.map((o, i) => `
    <button class="modal-picker-item${o.danger ? ' danger' : ''}" onclick="__resolveModal(window.__modalPickerOptions[${i}].value)">
      <span class="modal-picker-label">${escapeHtml(o.label)}</span>
      ${o.sublabel ? `<span class="modal-picker-sub muted small">${escapeHtml(o.sublabel)}</span>` : ''}
    </button>`).join('');
  const html = `
    <h3>${escapeHtml(title)}</h3>
    ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
    <div class="modal-picker-list">${itemsHtml}</div>
    <div class="actions">
      <button onclick="__resolveModal(null)">${escapeHtml(cancelLabel)}</button>
    </div>`;
  return _openModal(html);
}

function showConfirmModal({title, message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false}) {
  const msgHtml = message ? `<div class="modal-confirm-msg">${escapeHtml(message).replace(/\n/g, '<br>')}</div>` : '';
  const cancelBtn = cancelLabel ? `<button onclick="__resolveModal(false)">${escapeHtml(cancelLabel)}</button>` : '';
  const html = `
    <h3>${escapeHtml(title)}</h3>
    ${msgHtml}
    <div class="actions">
      ${cancelBtn}
      <button class="${danger ? 'danger' : 'primary'} modal-submit" onclick="__resolveModal(true)">${escapeHtml(confirmLabel)}</button>
    </div>`;
  return _openModal(html);
}

// Single-button informational modal — replacement for alert().
function showAlertModal({title, message = '', confirmLabel = 'OK'}) {
  return showConfirmModal({ title, message, confirmLabel, cancelLabel: '' });
}

// Boot the app
boot();
