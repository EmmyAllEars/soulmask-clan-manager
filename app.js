/* Soulmask Clan Manager — vanilla JS app
 * Persistence: localStorage key 'soulmaskClan_v1'
 * Initial bootstrap: data/default_roster.json + data/talents.json
 */

// === CONSTANTS ===
const APP_VERSION = '0.4.0';
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
let state = {
  roster: [],          // array of tribesman objects
  talents: [],         // catalog of all talents (loaded from talents.json)
  groups: [],          // user-defined group names
  tags: [],            // user-defined tag names
  selectedId: null,    // for profile view
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
    version: 1,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}
function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
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
  const saved = loadState();
  if (saved && saved.roster && saved.roster.length) {
    state.roster = saved.roster;
    state.groups = saved.groups || [];
    state.tags = saved.tags || [];
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
    saveState();
  } catch (e) {
    console.error('Failed to load defaults:', e);
    state.roster = [];
  }
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

// === UI MAIN ===
const ui = {
  showRoster() {
    document.getElementById('view-roster').classList.add('active');
    document.getElementById('view-profile').classList.remove('active');
    document.getElementById('nav-roster').classList.add('primary');
    document.getElementById('nav-profile').classList.remove('primary');
    refreshNavProfileLabel();
  },
  showProfile(id) {
    state.selectedId = id;
    document.getElementById('view-roster').classList.remove('active');
    document.getElementById('view-profile').classList.add('active');
    document.getElementById('nav-roster').classList.remove('primary');
    document.getElementById('nav-profile').classList.add('primary');
    renderProfile();
    refreshNavProfileLabel();
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
  if (!confirm(`Delete ${t.name}? This cannot be undone.`)) return;
  state.roster = state.roster.filter(x => x.id !== id);
  saveState();
  initFilters();
  ui.showRoster();
  renderRoster();
}
window.onDeleteTribesman = onDeleteTribesman;

// === TRAINING SUGGESTIONS ===
function renderTrainingSuggestions(trainee) {
  const out = [];
  // 1. Cap-raise opportunities
  // For each weapon where trainee.cap < ceiling (125 if class, 100 otherwise)
  // find any tribesman in roster with HIGHER cap for that weapon
  const classW = PROF_CLASS_WEAPONS[trainee.profession] || [];
  for (const w of WEAPONS) {
    const v = (trainee.weapons?.[w]) || {cap:null};
    if (v.cap == null) continue;
    const ceiling = classW.includes(w) ? 125 : 100;
    if (v.cap >= ceiling) continue;
    // find best mentor
    const mentors = state.roster
      .filter(m => m.id !== trainee.id)
      .map(m => ({m, cap: m.weapons?.[w]?.cap}))
      .filter(x => x.cap && x.cap > v.cap)
      .sort((a,b) => b.cap - a.cap);
    if (!mentors.length) continue;
    const top = mentors.slice(0, 3);
    out.push(`<div class="suggestion">
      <div class="head">Raise ${w} cap from ${v.cap} → up to ${Math.min(top[0].cap, ceiling)}</div>
      <div class="why">Mentor candidates: ${top.map(x => `<b>${escapeHtml(x.m.name)}</b> (${x.cap})`).join(', ')}.
      ${classW.includes(w) ? `${w} is a class weapon for ${trainee.profession} — ceiling 125.` : `${w} is off-class — ceiling 100.`}</div>
    </div>`);
  }

  // 2. Talent upgrades — same talent at higher level
  for (const tal of (trainee.talents||[])) {
    if (tal.level >= 3) continue;
    const mentors = state.roster
      .filter(m => m.id !== trainee.id)
      .filter(m => (m.talents||[]).some(mt => mt.name === tal.name && mt.level > tal.level));
    if (mentors.length) {
      out.push(`<div class="suggestion">
        <div class="head">Upgrade talent: ${escapeHtml(tal.name)} (Lv ${tal.level} → up to ${Math.max(...mentors.flatMap(m => m.talents.filter(mt=>mt.name===tal.name).map(mt=>mt.level)))})</div>
        <div class="why">Mentors: ${mentors.map(m => escapeHtml(m.name)).join(', ')}</div>
      </div>`);
    }
  }

  // 3. Talents available to learn — any talent NOT on trainee that other tribesmen have
  // Limit to top 3 most-common across roster (to avoid overwhelming)
  const traineeTalNames = new Set((trainee.talents||[]).map(t => t.name));
  const traineeIsBody = trainee.is_body;
  const posTalsCount = (trainee.talents||[]).filter(t => {
    const m = state.talents.find(x => x.name === t.name);
    return m && m.polarity === 'positive';
  }).length;
  if (posTalsCount < 6) {
    // Group available talents by name -> highest mentor level
    const avail = new Map();
    for (const m of state.roster) {
      if (m.id === trainee.id) continue;
      for (const t of (m.talents||[])) {
        const meta = state.talents.find(x => x.name === t.name);
        if (!meta || meta.polarity !== 'positive') continue;
        if (traineeTalNames.has(t.name)) continue;
        const cur = avail.get(t.name) || {topLevel:0, mentors:[]};
        if (t.level > cur.topLevel) cur.topLevel = t.level;
        cur.mentors.push(m.name);
        avail.set(t.name, cur);
      }
    }
    if (avail.size) {
      const top = [...avail.entries()].sort((a,b) => b[1].topLevel - a[1].topLevel).slice(0, 5);
      out.push(`<div class="suggestion">
        <div class="head">${posTalsCount}/6 positive talents — could learn ${avail.size} more from existing roster</div>
        <div class="why">Top candidates: ${top.map(([n,d]) => `<b>${escapeHtml(n)}</b> (max Lv ${d.topLevel}, from ${d.mentors.slice(0,2).map(escapeHtml).join('/')})`).join(' · ')}</div>
      </div>`);
    }
  }

  if (!out.length) return '<p class="muted">No training opportunities found in current roster.</p>';
  return out.join('');
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
    roster: state.roster, groups: state.groups, tags: state.tags, version: 1,
    exported: new Date().toISOString()
  }, null, 2));
}
function importJSON(text) {
  try {
    const data = JSON.parse(text);
    if (!data.roster) return alert('Invalid backup file: no roster.');
    if (!confirm(`Restore ${data.roster.length} tribesmen? This will REPLACE the current state.`)) return;
    state.roster = data.roster;
    state.groups = data.groups || [];
    state.tags = data.tags || [];
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
