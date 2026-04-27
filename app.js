/* Soulmask Clan Manager — vanilla JS app
 * Persistence: localStorage key 'soulmaskClan_v1'
 * Initial bootstrap: data/default_roster.json + data/talents.json
 */

// === CONSTANTS ===
const APP_VERSION = '0.5.0';
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

// Profession alignment for skill highlighting
const PROF_BEST_SKILLS = {
  Laborer: ['Lumberjack','Miner','Gatherer','Farmer'],
  Porter:  ['Weaver','Potter','Carpenter','Tanner','Kiln Worker'],
  Craftsman: ['Craftsman','Alchemist','Cook','Blacksmith','Armorer'],
  Warrior: [], Hunter: [], Guard: [],
};
// Profession class weapons (cap can train up to 125 in Training Ground)
const PROF_CLASS_WEAPONS = {
  Warrior: ['Dual-blade','Hammer','Blade','Great Sword','Gauntlets'],
  Hunter:  ['Bow','Dual-blade','Blade','Spear','Gauntlets','Spiked Whip'],
  Guard:   ['Shield','Bow','Blade','Great Sword','Spear'],
};

// === STATE ===
const STORAGE_VERSION = 2;

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

function defaultCalibration() {
  return {
    baseTimes: { ...DEFAULT_PLAN_BASE_TIMES_MIN },
    tierMultipliers: { ...DEFAULT_PLAN_TIER_MULTIPLIERS },
  };
}

let state = {
  roster: [],          // array of tribesman objects
  talents: [],         // catalog of all talents (loaded from talents.json)
  groups: [],          // user-defined group names
  tags: [],            // user-defined tag names
  plans: [],           // training plans (see docs/training_plans.md)
  calibration: defaultCalibration(), // tunable timing constants
  selectedId: null,    // for profile view
  selectedPlanId: null,// for plan editor view
  sort: { column: null, dir: null, sub: null }, // null = default order
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
function migrateState(data) {
  if (!data || typeof data !== 'object') return data;
  const v = data.version || 1;
  if (v < 2) {
    data.plans = data.plans || [];
    data.version = 2;
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
    alert('Failed to load talents.json. Check console.');
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
    if (wasOlder || normalized || droppedStaleTiers) saveState();
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

function thSort(label, col, extraClass = '') {
  const cls = `sortable${extraClass ? ' ' + extraClass : ''}`;
  return `<th class="${cls}" onclick="sortBy(event,'${col}')">${escapeHtml(label)}${sortIndicator(col)}</th>`;
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
  for (const s of SKILLS) html += thSort(s, `skill:${s}`);
  for (const a of ATTRS)  html += thSort(a, `attr:${a}`);
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
      const v = (t.weapons?.[w]) || {cap:null};
      const cls = tierClass(v.cap);
      const al = classW.includes(w) ? ' aligned-skill' : '';
      html += `<td class="weapon-cell ${cls}${al}">
        <input class="cell-input num-tiny" type="number" value="${v.cap ?? ''}" oninput="updWeaponFromRoster('${id}','${w}',this)">
      </td>`;
    }
    html += `<td>${(t.groups || []).map(g => `<span class="chip group">${escapeHtml(g)}</span>`).join('')}</td>`;
    html += `<td>${(t.tags || []).map(g => `<span class="chip tag">${escapeHtml(g)}</span>`).join('')}</td>`;
    html += `<td>${(t.talents || []).length}</td>`;
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
    html += `<div class="field"><label>${a} — ${ATTR_NAMES[a]}</label>
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
    <h3>Talents (${(t.talents||[]).length}/6 positive max)</h3>
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

function renderTalentList(t) {
  const grid = document.getElementById('talents-grid');
  const tals = t.talents || [];
  if (!tals.length) { grid.innerHTML = '<span class="muted">No talents recorded yet.</span>'; return; }
  grid.innerHTML = tals.map((tal,i) => {
    const meta = state.talents.find(x => x.name === tal.name);
    const isNeg = meta && meta.polarity === 'negative';
    const effect = (meta && meta.effect) ? meta.effect : '';
    return `<div class="talent-pill ${isNeg?'negative':''}">
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

function onConfirmAddTalent(id) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  const name = document.getElementById('talent-input').value.trim();
  if (!name) return;
  const meta = state.talents.find(x => x.name === name);
  if (!meta) { alert(`Talent "${name}" not found in catalog.`); return; }
  const level = +document.getElementById('talent-level').value;
  // Enforce 6 positive talents max
  if (meta.polarity === 'positive') {
    const posCount = (t.talents||[]).filter(tt => {
      const m = state.talents.find(x => x.name === tt.name);
      return m && m.polarity === 'positive';
    }).length;
    if (posCount >= 6) {
      if (!confirm(`${t.name} already has 6 positive talents (max). Add anyway?`)) return;
    }
  }
  if (!t.talents) t.talents = [];
  // Replace existing if same name
  const existing = t.talents.findIndex(tt => tt.name === name);
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

function updWeaponFromRoster(id, weapon, inputEl) {
  const t = state.roster.find(x => x.id === id);
  if (!t) return;
  t.weapons = t.weapons || {};
  t.weapons[weapon] = t.weapons[weapon] || {current:null, cap:null};
  const val = inputEl.value === '' ? null : +inputEl.value;
  t.weapons[weapon].cap = val;
  saveState();
  const td = inputEl.closest('td');
  if (td) {
    const aligned = (PROF_CLASS_WEAPONS[t.profession] || []).includes(weapon);
    td.className = `weapon-cell ${tierClass(val)}${aligned ? ' aligned-skill' : ''}`;
  }
}
window.updSkillFromRoster = updSkillFromRoster;
window.updWeaponFromRoster = updWeaponFromRoster;

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

function onDeleteTribesman(id) {
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

  let warn = `Delete ${t.name}? This cannot be undone.`;
  if (traineeOf.length || mentorStepCount) {
    warn += '\n\n';
    if (traineeOf.length) warn += `· ${traineeOf.length} plan${traineeOf.length === 1 ? '' : 's'} where ${t.name} is the trainee will also be deleted.\n`;
    if (mentorStepCount) warn += `· ${mentorStepCount} step${mentorStepCount === 1 ? '' : 's'} in other plans use ${t.name} as mentor; those steps will be flagged "mentor missing" but kept.\n`;
  }
  if (!confirm(warn)) return;

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
function isLearnableBy(talentName, trainee) {
  const m = talentName.match(/\[([^\]]+) Exclusive\]/);
  if (!m) return true;
  const tag = m[1];
  if (PROFESSION_EXCLUSIVE_TAGS.has(tag)) return trainee.profession === tag;
  return trainee.tribe === tag;
}

// Pure: derive the list of training suggestions for a trainee. Each entry
// carries enough metadata for the "+ Add to plan" button to seed a draft step.
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

function renderTrainingSuggestions(trainee) {
  const suggestions = getTrainingSuggestions(trainee);
  if (!suggestions.length) {
    return '<p class="muted">No training opportunities found in current roster.</p>';
  }
  return suggestions.map((s, i) => `<div class="suggestion">
    <div class="head">${s.head}</div>
    <div class="why">${s.why}</div>
    <button class="small suggestion-add" onclick="onAddSuggestionToPlan('${trainee.id}', ${i})">+ Add to plan</button>
  </div>`).join('');
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
function importCSV(text) {
  // Simple CSV parser handling quoted fields
  const rows = parseCSV(text);
  if (rows.length < 2) return alert('CSV is empty.');
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
  if (!confirm(`Import ${newRoster.length} tribesmen? This will REPLACE the current roster.`)) return;
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
function importJSON(text) {
  try {
    const data = migrateState(JSON.parse(text));
    if (!data.roster) return alert('Invalid backup file: no roster.');
    if (!confirm(`Restore ${data.roster.length} tribesmen? This will REPLACE the current state.`)) return;
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
  } catch (e) { alert('Failed to parse JSON: ' + e.message); }
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

function findPlan(id) { return state.plans.find(p => p.id === id); }
function findStep(plan, stepId) { return plan?.steps.find(s => s.id === stepId); }
function findTribesman(id) { return state.roster.find(t => t.id === id); }
function talentMeta(name) { return state.talents.find(x => x.name === name); }

// --- Time estimation -------------------------------------------------------

function stepBaseKey(step) {
  if (step.type === 'cap-raise') return 'cap-raise';
  if (step.type === 'learn') return 'learn';
  // upgrade: which level transition?
  const target = step.targetLevel || 2;
  return target <= 2 ? 'upgrade-1-2' : 'upgrade-2-3';
}

function estimateStepMin(step) {
  if (!step) return 0;
  const base = state.calibration.baseTimes[stepBaseKey(step)];
  const mult = state.calibration.tierMultipliers[step.material] ?? 1;
  if (base == null) return 0;
  return Math.round(base * mult);
}

function estimatePlanMin(plan) {
  if (!plan) return 0;
  return plan.steps.reduce((sum, s) => sum + estimateStepMin(s), 0);
}

function fmtMinutes(min) {
  if (!min || min < 1) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

// --- Plan CRUD -------------------------------------------------------------

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

function deletePlan(id) {
  const idx = state.plans.findIndex(p => p.id === id);
  if (idx < 0) return;
  state.plans.splice(idx, 1);
  if (state.selectedPlanId === id) state.selectedPlanId = null;
  saveState();
}

function duplicatePlan(id) {
  const src = findPlan(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newPlanId();
  copy.name = `${src.name} (copy)`;
  copy.status = 'draft';
  copy.createdAt = new Date().toISOString();
  copy.steps = copy.steps.map(s => ({ ...s, id: newStepId(), status: 'queued', startedAt: null, completedAt: null, actualDurationMin: null }));
  state.plans.push(copy);
  saveState();
  return copy;
}

// --- Step CRUD -------------------------------------------------------------

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
    note: '',
  };
}

// Forward-migrate legacy steps that used `gearTier` (1-6, with quality
// conflated into the same axis). New code uses `material` (1-5).
// Returns true if it changed anything, so the caller can re-save.
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

function addStep(planId, type) {
  const plan = findPlan(planId);
  if (!plan) return null;
  const s = newStep(type);
  plan.steps.push(s);
  saveState();
  return s;
}

function removeStep(planId, stepId) {
  const plan = findPlan(planId);
  if (!plan) return;
  plan.steps = plan.steps.filter(s => s.id !== stepId);
  saveState();
}

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
  // Re-render the editor so derived fields (estimated time, dropdown defaults) update
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onAddStep = function(planId, type) {
  addStep(planId, type);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onRemoveStep = function(planId, stepId) {
  if (!confirm('Remove this step?')) return;
  removeStep(planId, stepId);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onMoveStep = function(planId, stepId, dir) {
  moveStep(planId, stepId, dir);
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onSetStepStatus = function(planId, stepId, status) {
  const plan = findPlan(planId);
  const s = findStep(plan, stepId);
  if (!s) return;
  s.status = status;
  if (status === 'running' && !s.startedAt) s.startedAt = new Date().toISOString();
  if (status === 'completed' && !s.completedAt) s.completedAt = new Date().toISOString();
  saveState();
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onSetPlanStatus = function(planId, status) {
  const p = findPlan(planId);
  if (!p) return;
  p.status = status;
  saveState();
  if (state.selectedPlanId === planId) renderPlanEditor(planId);
};

window.onCreatePlan = function() {
  if (!state.roster.length) { alert('Add a tribesman first.'); return; }
  // Simple prompt-driven creation: pick trainee, then optional name.
  const names = state.roster.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
  const idx = prompt(`Pick trainee by number:\n${names}`);
  if (!idx) return;
  const n = parseInt(idx, 10);
  if (!Number.isFinite(n) || n < 1 || n > state.roster.length) { alert('Invalid pick.'); return; }
  const trainee = state.roster[n - 1];
  const name = prompt(`Plan name:`, `${trainee.name} — new plan`);
  if (name === null) return;
  const p = createPlan(trainee.id, name || `${trainee.name} — new plan`);
  ui.showPlan(p.id);
};

window.onDeletePlan = function(id) {
  const p = findPlan(id);
  if (!p) return;
  if (!confirm(`Delete plan "${p.name}"?`)) return;
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

window.onResetCalibration = function() {
  if (!confirm('Reset calibration constants to defaults?')) return;
  state.calibration = defaultCalibration();
  saveState();
  if (state.selectedPlanId) renderPlanEditor(state.selectedPlanId);
  else renderPlansList();
};

// --- Suggestion → Plan handoff ---------------------------------------------

// Convert a structured Training Suggestion into a fresh TrainingStep with as
// many fields pre-filled as the suggestion lets us. Mentor defaults to the
// top candidate; user can swap it in the plan editor.
function suggestionToStep(suggestion) {
  const step = newStep(suggestion.type);
  step.mentorId = suggestion.mentorIds?.[0] || null;
  if (suggestion.type === 'cap-raise') {
    step.weapon = suggestion.weapon;
    step.targetCap = suggestion.targetCap;
  } else if (suggestion.type === 'upgrade') {
    step.talent = suggestion.talent;
    step.targetLevel = suggestion.targetLevel;
  }
  // 'learn' has no extra fields beyond mentor (random outcome in-game)
  return step;
}

// Picker dialog: "add to existing plan" or "start a new plan". Renders into
// the existing modal scaffolding (#modal-bg / #modal). Plain DOM, no framework.
window.onAddSuggestionToPlan = function(traineeId, suggestionIndex) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return;
  const suggestions = getTrainingSuggestions(trainee);
  const s = suggestions[suggestionIndex];
  if (!s) return;

  const existing = state.plans.filter(p =>
    p.traineeId === traineeId && (p.status === 'draft' || p.status === 'active')
  );

  const planOptions = existing.map(p =>
    `<option value="${p.id}">${escapeHtml(p.name || 'Untitled')} (${p.steps.length} steps · ${p.status})</option>`
  ).join('');

  const modal = document.getElementById('modal');
  const bg = document.getElementById('modal-bg');
  modal.innerHTML = `<h3>Add to plan</h3>
    <p class="muted small">${s.head}</p>
    ${existing.length ? `
      <div class="field">
        <label><input type="radio" name="add-plan-mode" value="existing" checked> Add to existing plan</label>
        <select id="add-plan-existing">${planOptions}</select>
      </div>
    ` : ''}
    <div class="field">
      <label><input type="radio" name="add-plan-mode" value="new" ${existing.length ? '' : 'checked'}> Start a new plan</label>
      <input id="add-plan-new-name" type="text" placeholder="Plan name…" value="${escapeHtml(trainee.name)} — ${PLAN_STEP_LABELS[s.type]}">
    </div>
    <div class="actions">
      <button onclick="closeAddSuggestionModal()">Cancel</button>
      <button class="primary" onclick="confirmAddSuggestionToPlan('${traineeId}', ${suggestionIndex})">Add step</button>
    </div>`;
  bg.classList.add('active');
};

window.closeAddSuggestionModal = function() {
  document.getElementById('modal-bg').classList.remove('active');
  document.getElementById('modal').innerHTML = '';
};

window.confirmAddSuggestionToPlan = function(traineeId, suggestionIndex) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return closeAddSuggestionModal();
  const suggestion = getTrainingSuggestions(trainee)[suggestionIndex];
  if (!suggestion) return closeAddSuggestionModal();

  const mode = document.querySelector('input[name="add-plan-mode"]:checked')?.value || 'new';
  let plan;
  if (mode === 'existing') {
    const planId = document.getElementById('add-plan-existing')?.value;
    plan = findPlan(planId);
  }
  if (!plan) {
    const name = document.getElementById('add-plan-new-name')?.value?.trim()
      || `${trainee.name} — new plan`;
    plan = createPlan(traineeId, name);
  }

  const step = suggestionToStep(suggestion);
  plan.steps.push(step);
  if (plan.status === 'draft') plan.status = 'draft'; // unchanged
  saveState();
  closeAddSuggestionModal();
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

  const mentorOpts = [`<option value="">— pick mentor —</option>`]
    .concat(eligibleMentors.map(m => {
      let detail = '';
      if (step.type === 'cap-raise' && step.weapon) detail = ` (${step.weapon} ${m.weapons?.[step.weapon]?.cap || '—'})`;
      else if (step.type === 'upgrade' && step.talent) {
        const t = (m.talents||[]).find(tt => tt.name === step.talent);
        detail = t ? ` (Lv ${t.level})` : '';
      }
      return `<option value="${m.id}" ${m.id === step.mentorId ? 'selected' : ''}>${escapeHtml(m.name)}${escapeHtml(detail)}</option>`;
    })).join('');

  // Type-specific subject pickers
  let subject = '';
  if (step.type === 'cap-raise') {
    const ceiling = trainee && step.weapon ? weaponCeiling(trainee.profession, step.weapon) : null;
    const traineeCap = trainee && step.weapon ? (trainee.weapons?.[step.weapon]?.cap ?? '—') : '—';
    subject = `<label>Weapon</label>
      <select onchange="stepFieldUpd('${plan.id}','${step.id}','weapon',this.value)">
        <option value="">— pick weapon —</option>
        ${WEAPONS.map(w => `<option value="${w}" ${w === step.weapon ? 'selected' : ''}>${w}</option>`).join('')}
      </select>
      <label>Target cap</label>
      <input type="number" min="1" max="125" value="${step.targetCap ?? ''}"
        placeholder="${ceiling ?? ''}"
        oninput="stepFieldUpd('${plan.id}','${step.id}','targetCap',this.value)">
      ${step.weapon ? `<span class="muted small">trainee ${traineeCap} → ceiling ${ceiling}</span>` : ''}`;
  } else if (step.type === 'upgrade') {
    const traineeTalents = (trainee?.talents || []).filter(t => (t.level || 0) < 3);
    subject = `<label>Talent</label>
      <select onchange="stepFieldUpd('${plan.id}','${step.id}','talent',this.value)">
        <option value="">— pick talent —</option>
        ${traineeTalents.map(t => `<option value="${escapeHtml(t.name)}" ${t.name === step.talent ? 'selected' : ''}>${escapeHtml(t.name)} (Lv ${t.level})</option>`).join('')}
      </select>
      <label>Target Lv</label>
      <select onchange="stepFieldUpd('${plan.id}','${step.id}','targetLevel',this.value)">
        ${[2,3].map(lv => `<option value="${lv}" ${lv === step.targetLevel ? 'selected' : ''}>Lv ${lv}</option>`).join('')}
      </select>`;
  } else if (step.type === 'learn') {
    subject = `<span class="muted small">Random talent (Lv I) drawn from mentor's eligible positive talents.</span>`;
  }

  const statusBtns = STEP_STATUSES.map(st =>
    `<button class="${step.status === st ? 'primary small' : 'small'}" onclick="onSetStepStatus('${plan.id}','${step.id}','${st}')">${st}</button>`
  ).join('');

  return `<div class="plan-step plan-step-${step.type} status-${step.status}${mentorMissing ? ' mentor-missing' : ''}">
    <div class="plan-step-head">
      <span class="step-num">#${index + 1}</span>
      <span class="step-type">${label}</span>
      <span class="step-dur">${dur}</span>
      ${mentorMissing ? '<span class="step-warn">⚠ mentor missing</span>' : ''}
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

window.onCreatePlanForTribesman = function(traineeId) {
  const trainee = findTribesman(traineeId);
  if (!trainee) return;
  const name = prompt('Plan name:', `${trainee.name} — new plan`);
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
function addTribesman() {
  const name = prompt('New tribesman name:');
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
    if (!confirm('Reset to default roster? This will overwrite all current data (your localStorage will be reset).')) return;
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

// Boot the app
boot();
