import * as api from './api.js';
import { startParticles } from './particles.js';
import { startRealtime } from './realtime.js';
import * as S from './schedule.js';

const VERSION = '3';
const T = window.homeosTheme;
const Q = new URLSearchParams(location.search);
const PREVIEW = T.isPreview ? Q.get('preview') : null; // local screenshots only
const $app = document.getElementById('app');
const K = { profiles: 'homeos-profiles', queue: 'homeos-queue', rows: 'homeos-rows', loc: 'homeos-kitchen-loc', later: 'homeos-partner-later', stores: 'homeos-store-memory', choreTab: 'homeos-chore-tab', lists: 'homeos-task-lists', who: 'homeos-chore-who', debug: 'homeos-debug' };
const TABLES = ['grocery_items', 'staples', 'pantry_items', 'tasks', 'task_events'];
// What each table pulls. History (task_events) is add-only: the most recent stretch is enough on a phone.
const TABLE_Q = {
  task_events: 'task_events?select=*&order=at.desc&limit=800'
};
const tableQuery = (t) => TABLE_Q[t] || `${t}?select=*&deleted_at=is.null&order=created_at.asc`;

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (PREVIEW) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

const emptyRows = () => ({ grocery_items: [], staples: [], pantry_items: [], tasks: [], task_events: [] });
const state = {
  profiles: ls.get(K.profiles, []),
  rows: { ...emptyRows(), ...ls.get(K.rows, {}) },
  queue: ls.get(K.queue, []),
  storeMemory: ls.get(K.stores, {}), // item name -> store it was last bought at
  members: [], // household user IDs (so a chore can be assigned before the partner signs in)
  member: true,
  fetched: false,
  flushing: false,
  netFail: false,
  error: null
};
// Screen-only state (not synced).
const ui = { sheet: null, edit: false, newGroup: null, loc: ls.get(K.loc, 'fridge'), choreTab: ls.get(K.choreTab, 'chores'), who: ls.get(K.who, 'all'), showLater: false, showDone: false, howto: null, taskCat: 'House', resetCount: null };

/* ---------- constants ---------- */
const STORES = [['costco', 'Costco'], ['wegmans', 'Wegmans'], ['publix', 'Publix'], ['harris_teeter', 'Harris Teeter']];
const storeName = (k) => (STORES.find((s) => s[0] === k) || [null, 'Unsorted'])[1];
const LOCS = [['fridge', 'Fridge'], ['freezer', 'Freezer'], ['pantry', 'Pantry'], ['garage_freezer', 'Garage freezer']];
const locName = (k) => (LOCS.find((l) => l[0] === k) || [null, k])[1];
const LOC_SOON = null; // a location that's shown but not usable yet (none right now)
const LOC_SHORT = { garage_freezer: 'Garage' }; // fits the tab bar
const COSTCO_GROUPS = ['Fridge', 'Freezer', 'Pantry', 'Household', 'Kids', 'Other'];

/* ---------- local preview (screenshots only, sample data, no network) ---------- */
if (PREVIEW) {
  api.setPreviewSession(PREVIEW === 'signin' ? null : { user: { id: 'me' } });
  state.profiles = [{ user_id: 'me', display_name: 'Sam' }];
  if (Q.get('partner') === '1') state.profiles.push({ user_id: 'p', display_name: 'Riley' });
  state.queue = [];
  state.fetched = true;
  const r = (name, o = {}) => ({ id: 'x' + Math.random().toString(36).slice(2), name, ...o });
  const now = new Date().toISOString();
  const eggs = r('Eggs', { location: 'fridge', status: 'out' }), milk = r('Milk', { location: 'fridge', status: 'out' });
  state.rows = {
    grocery_items: [
      r('Paper towels'), r('Birthday candles'),
      r('Eggs', { store: 'costco', note: '2 dozen' }), r('Bananas', { store: 'costco' }), r('Coffee beans', { store: 'costco' }),
      r('Sourdough bread', { store: 'wegmans' }), r('Fresh basil', { store: 'wegmans' }),
      r('Milk', { store: 'costco', checked_at: now, pantry_item_id: milk.id }), r('Yogurt', { checked_at: now }), r('Apples', { checked_at: now })
    ].filter((g) => !(g.name === 'Eggs' && Q.get('preview') === 'kitchen')),
    staples: [
      r('Eggs', { list: 'costco', category: 'Fridge', store: 'costco' }), r('Shredded cheese', { list: 'costco', category: 'Fridge', store: 'costco' }), r('Butter', { list: 'costco', category: 'Fridge', store: 'costco' }),
      r('Frozen berries', { list: 'costco', category: 'Freezer', store: 'costco' }), r('Chicken thighs', { list: 'costco', category: 'Freezer', store: 'costco' }),
      r('Coffee beans', { list: 'costco', category: 'Pantry', store: 'costco' }), r('Olive oil', { list: 'costco', category: 'Pantry', store: 'costco' }),
      r('Milk', { list: 'staples', store: 'costco' }), r('Bananas', { list: 'staples', store: 'costco' }), r('Bread', { list: 'staples', store: 'wegmans' }), r('Dish soap', { list: 'staples' })
    ],
    pantry_items: [milk, eggs, r('Butter', { location: 'fridge', status: 'low' }), r('Shredded cheese', { location: 'fridge', status: 'have' }),
      r('Yogurt', { location: 'fridge', status: 'have' }), r('Hot sauce', { location: 'fridge', status: 'have' }),
      r('Frozen peas', { location: 'freezer', status: 'have' }), r('Rice', { location: 'pantry', status: 'low' })]
  };
  const today = S.localToday(T.now());
  const ch = (title, o) => ({ id: 'c' + Math.random().toString(36).slice(2), kind: 'chore', title, active: true, repeat_mode: 'after', every: 1, unit: 'week', week_of_month: null, weekday: null, months: null, assignee: null, priority: false, howto: null, ...o });
  const filt = ch('Change the air filter', { repeat_mode: 'fixed', unit: 'month', week_of_month: 4, assignee: 'me', due_date: S.addDays(today, -6), howto: 'Turn off the unit at the switch.\nSlide the old filter out; note the arrow.\nSlide the new one in, arrow toward the unit.' });
  state.rows.tasks = [
    ch('Wipe down the fridge', { every: 2, due_date: S.addDays(today, -2) }), filt,
    ch('Water the plants', { every: 3, unit: 'day', due_date: S.addDays(today, -1) }),
    ch('Take out recycling', { repeat_mode: 'fixed', every: 2, weekday: 2, assignee: 'p', due_date: S.addDays(today, 2) }),
    ch('Clean the bathrooms', { due_date: S.addDays(today, 4) }), ch('Wash the bedding', { due_date: S.addDays(today, 5) }),
    ch('Clean the gutters', { repeat_mode: 'fixed', every: 6, unit: 'month', week_of_month: 2, months: [4, 10], due_date: S.addDays(today, 60) }),
    ch('Test smoke alarms', { repeat_mode: 'fixed', every: 3, unit: 'month', week_of_month: 1, months: [3, 6, 9, 12], due_date: S.addDays(today, 25) }),
    { id: 't1', kind: 'task', title: 'Fix the squeaky door', category: 'House', priority: true, due_date: S.addDays(today, 2), active: true, repeat_mode: 'once' },
    { id: 't2', kind: 'task', title: 'Call about the gutters', category: 'House', priority: true, active: true, repeat_mode: 'once' },
    { id: 't3', kind: 'task', title: 'Hang the hallway shelf', category: 'House', active: true, repeat_mode: 'once' },
    { id: 't4', kind: 'task', title: 'Sign the field trip form', category: 'Kids', due_date: S.addDays(today, 3), active: true, repeat_mode: 'once' },
    { id: 't5', kind: 'task', title: 'Order winter boots', category: 'Kids', active: true, repeat_mode: 'once' },
    { id: 't6', kind: 'task', title: 'Return the library books', category: 'Errands', due_date: S.addDays(today, 5), active: true, repeat_mode: 'once' }
  ];
  state.rows.task_events = [
    { id: 'e1', task_id: filt.id, kind: 'done', due_date: S.addDays(today, -34), at: S.addDays(today, -34) + 'T15:00:00Z', by_user: 'me' },
    { id: 'e2', task_id: filt.id, kind: 'skip', due_date: S.addDays(today, -62), at: S.addDays(today, -62) + 'T15:00:00Z', by_user: 'me' }
  ];
  state.members = ['me', 'p'];
  if (Q.get('tab')) ui.choreTab = Q.get('tab');
  if (Q.get('howto')) ui.howto = filt.id;
  if (Q.get('edit')) ui.sheet = { type: 'chore', id: filt.id };
  if (Q.get('sheet')) ui.sheet = { type: 'addfrom', tab: Q.get('sheet') };
  if (Q.get('preview') === 'kitchen') state.rows.grocery_items = state.rows.grocery_items.filter((g) => g.name !== 'Eggs');
}

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = {
  home: '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.5 9.6V20h13V9.6"/><path d="M10 20v-5.5h4V20"/>',
  set: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  ppl: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.6c2.3.1 3.9 1.6 4.5 4.4"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  chev: '<path d="M9 5.5 15.5 12 9 18.5"/>',
  arr: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  cart: '<path d="M3 4.5h2.4l2.1 10.2h10.4l2-7.4H6.6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  box: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M4 10h16M8 6.8v.4M8 13v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chore: '<path d="M5 12.5 9 16.5 19 6.5"/><path d="M5 19.5h14"/>',
  q: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.4M12 16.8v.1"/>',
  flag: '<path d="M6 20.5V4.5M6 5h10.5l-2 3.8 2 3.8H6"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>'
};
const ic = (k, c = 'i') => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
const norm = (s) => String(s || '').trim().toLowerCase();
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const THEMES = {
  blush: { name: 'Blush', group: 'Cozy', long: 'Cozy, blush and plum', sw: ['#FBEFF1', '#4A2141', '#EE9CB7'] },
  roast: { name: 'Roast', group: 'Cozy', long: 'Cozy, hojicha and oat', sw: ['#4A3F38', '#D9D1C3', '#00DDE8'] },
  night: { name: 'Night Shift', group: 'Dense', long: 'Night Shift', sw: ['#272D3F', '#DDD8CB', '#1FE6A0'] }
};
const swatch = (a) => `<span class="sw" aria-hidden="true">${a.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
const cozy = () => T.apply().theme !== 'night';

const myId = () => api.getSession()?.user?.id;
const profileOf = (id) => state.profiles.find((p) => p.user_id === id);
const myName = () => (profileOf(myId())?.display_name || '').trim();
const partner = () => state.profiles.find((p) => p.user_id !== myId() && (p.display_name || '').trim());
const installed = () => (PREVIEW ? Q.get('installed') !== '0' : matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

function greeting() {
  const h = T.now().getHours();
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
}
const today = () => T.now().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/* ---------- rows: live views over the local copy ---------- */
const live = (t) => state.rows[t].filter((r) => !r.deleted_at);
const groceryOpen = () => live('grocery_items').filter((g) => !g.checked_at);
const groceryDone = () => live('grocery_items').filter((g) => g.checked_at).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)));
const onGrocery = (name, pantryId) => groceryOpen().find((g) => (pantryId && g.pantry_item_id === pantryId) || norm(g.name) === norm(name));
const pantry = () => live('pantry_items');
const outNotListed = () => pantry().filter((p) => p.status === 'out' && p.location !== LOC_SOON && !onGrocery(p.name, p.id));
const findRow = (t, id) => state.rows[t].find((r) => r.id === id);

/* ---------- sync badge (real connection + queue state) ---------- */
function syncStatus() {
  if (PREVIEW) {
    const s = Q.get('sync');
    if (s === 'off') return { k: 'off', t: 'Offline · 1 waiting' };
    if (s === 'err') return { k: 'err', t: 'Sync error' };
    return { k: 'ok', t: 'Synced' };
  }
  const n = state.queue.length;
  if (!navigator.onLine || state.netFail) return { k: 'off', t: n ? `Offline · ${n} waiting` : 'Offline' };
  if (state.error) return { k: 'err', t: 'Sync error' };
  if (state.flushing || n || !state.fetched) return { k: 'busy', t: n ? 'Saving' : 'Syncing' };
  return { k: 'ok', t: 'Synced' };
}
let lastSync = '';
const badgeHtml = () => {
  const s = syncStatus();
  const just = lastSync === 'busy' && s.k === 'ok'; // a save just landed
  lastSync = s.k;
  return `<button class="sync s-${s.k} press${just ? ' just' : ''}" data-act="sync" aria-live="polite"><i></i><span>${s.t}</span></button>`;
};
function updateBadge() { document.querySelectorAll('[data-act="sync"]').forEach((b) => { b.outerHTML = badgeHtml(); }); }

/* ---------- local changes: optimistic, queued, synced in order ---------- */
function saveRows() { ls.set(K.rows, state.rows); }
function saveQueue() { ls.set(K.queue, state.queue); }

function insertRow(table, data, { conflict = null } = {}) {
  const now = new Date().toISOString();
  const row = { id: uid(), created_at: now, updated_at: now, ...data };
  state.rows[table].push(row);
  saveRows();
  if (!PREVIEW) { state.queue.push({ kind: 'row', op: 'insert', table, id: row.id, data: row, conflict }); saveQueue(); flush(); }
  return row;
}

function updateRow(table, id, patch) {
  const row = findRow(table, id);
  if (!row) return;
  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  const j = justSaved.get(id); if (j) Object.assign(j.data, patch); // e.g. removed right after adding stays removed
  saveRows();
  if (PREVIEW) return;
  // Fold into a change that hasn't been sent yet, so the queue stays short.
  const pending = state.queue.find((o) => o.kind === 'row' && o.table === table && o.id === id && !o.sending);
  if (pending) Object.assign(pending.data, patch);
  else state.queue.push({ kind: 'row', op: 'update', table, id, data: { ...patch } });
  saveQueue();
  flush();
}
const removeRow = (table, id) => updateRow(table, id, { deleted_at: new Date().toISOString() });

/* ---------- server sync ---------- */
let pulling = null;
async function pull() {
  if (PREVIEW || !api.getSession()) return;
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      const members = await api.rest('household_members?select=user_id');
      state.member = !!members && members.some((m) => m.user_id === myId());
      state.members = (members || []).map((m) => m.user_id);
      if (!state.member) {
        state.error = "This account isn't in the household yet. Add its user ID to household_members (README, step 4).";
      } else {
        const [profiles, history, ...tables] = await Promise.all([
          api.rest('profiles?select=user_id,display_name,updated_at&deleted_at=is.null'),
          // Where each item was bought before, including cleared ones: new adds go to that store.
          api.rest('grocery_items?select=name,store&store=not.is.null&order=updated_at.desc&limit=500'),
          ...TABLES.map((t) => api.rest(tableQuery(t)))
        ]);
        const mem = {};
        for (const h of history) if (!(norm(h.name) in mem)) mem[norm(h.name)] = h.store;
        state.storeMemory = mem;
        ls.set(K.stores, mem);
        state.profiles = profiles;
        TABLES.forEach((t, i) => { state.rows[t] = tables[i]; });
        overlayQueue();
        ls.set(K.profiles, state.profiles);
        saveRows();
        if (state.error && !state.queue.length) state.error = null;
      }
      state.fetched = true;
      state.netFail = false;
    } catch (e) { onErr(e); }
    render({ soft: true });
    flush();
  })();
  try { await pulling; } finally { pulling = null; }
}

// Rows saved in the last few seconds: a refresh that started before the save finished won't have them yet.
const justSaved = new Map();
// Server rows plus local changes that haven't synced yet, so nothing flickers back.
function overlayQueue() {
  const now = Date.now();
  for (const [id, j] of justSaved) {
    if (j.until < now) { justSaved.delete(id); continue; }
    const rows = state.rows[j.table];
    if (!rows.some((r) => r.id === id)) rows.push({ ...j.data });
  }
  for (const o of state.queue) {
    if (o.kind === 'profile') {
      const me = profileOf(myId());
      if (me) me.display_name = o.data.display_name; else state.profiles.push({ user_id: myId(), display_name: o.data.display_name });
      continue;
    }
    const rows = state.rows[o.table], row = rows.find((r) => r.id === o.id);
    if (row) Object.assign(row, o.data);
    else if (o.op === 'insert') rows.push({ ...o.data });
  }
}

async function flush() {
  if (PREVIEW || state.flushing || !state.queue.length || !navigator.onLine || !api.getSession() || !state.member) return updateBadge();
  state.flushing = true; updateBadge();
  try {
    while (state.queue.length) {
      const op = state.queue[0];
      op.sending = true;
      try {
        if (op.kind === 'profile') {
          const rows = await api.rest('profiles?on_conflict=user_id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: { user_id: myId(), display_name: op.data.display_name }
          });
          if (rows && rows[0]) upsertProfile(rows[0]);
        } else if (op.op === 'insert') {
          const { created_at, updated_at, ...body } = op.data; // server sets the clocks
          if (op.table === 'task_events') { delete body.created_at; }
          // A conflict target means "record once": the other phone may already have written it.
          await api.rest(`${op.table}?on_conflict=${op.conflict || 'id'}`, { method: 'POST', prefer: `resolution=${op.conflict ? 'ignore' : 'merge'}-duplicates,return=minimal`, body });
          justSaved.set(op.id, { table: op.table, data: op.data, until: Date.now() + 15000 });
        } else {
          const { updated_at, ...body } = op.data;
          await api.rest(`${op.table}?id=eq.${encodeURIComponent(op.id)}`, { method: 'PATCH', prefer: 'return=minimal', body });
        }
      } catch (e) {
        op.sending = false;
        // A change the server rejects outright would block everything behind it: drop it and say so.
        if (!e.network && !e.signedOut && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) {
          state.queue.shift(); saveQueue();
          state.error = `A change couldn't be saved: ${e.message}`;
          continue;
        }
        throw e;
      }
      state.queue.shift();
      saveQueue();
    }
    if (!state.error || state.error.startsWith('Something')) state.error = null;
    state.netFail = false;
  } catch (e) { onErr(e); }
  state.flushing = false;
  updateBadge();
}

function onErr(e) {
  if (e.signedOut) { resetLocal(); render(); return; }
  if (e.network) { state.netFail = true; return; }
  state.error = e.message || 'Something went wrong';
}

function upsertProfile(row) {
  const i = state.profiles.findIndex((p) => p.user_id === row.user_id);
  if (i < 0) state.profiles.push(row); else state.profiles[i] = { ...state.profiles[i], ...row };
  ls.set(K.profiles, state.profiles);
}

function saveName(name) {
  name = name.trim().slice(0, 40);
  if (!name || name === myName()) return;
  upsertProfile({ user_id: myId(), display_name: name });
  if (PREVIEW) return render({ soft: true });
  state.queue = state.queue.filter((o) => o.kind !== 'profile' || o.sending);
  state.queue.push({ kind: 'profile', data: { display_name: name }, at: new Date().toISOString() });
  saveQueue();
  updateBadge();
  flush();
}

function resetLocal() {
  state.storeMemory = {}; ls.del(K.stores);
  state.profiles = []; state.rows = emptyRows(); state.queue = []; state.fetched = false; state.error = null; state.netFail = false; state.member = true;
  ls.del(K.profiles); ls.del(K.rows); ls.del(K.queue);
}

/* ---------- actions ---------- */
function addGrocery(name, extra = {}) {
  name = name.trim().slice(0, 80);
  if (!name) return null;
  const dup = onGrocery(name, extra.pantry_item_id);
  if (dup) return dup;
  // Pick the store: where it was last bought, else its staple or Costco list entry, else Unsorted.
  if (!('store' in extra)) {
    const s = live('staples').find((x) => norm(x.name) === norm(name) && x.store);
    extra.store = state.storeMemory[norm(name)] || (s ? s.store : null);
  }
  return insertRow('grocery_items', { name, store: null, note: null, pantry_item_id: null, checked_at: null, ...extra });
}

function toggleGrocery(id) {
  const g = findRow('grocery_items', id);
  if (!g) return;
  const checked = !g.checked_at;
  updateRow('grocery_items', id, { checked_at: checked ? new Date().toISOString() : null });
  // Bought it: the kitchen has it again.
  if (checked) {
    const p = (g.pantry_item_id && findRow('pantry_items', g.pantry_item_id)) || pantry().find((x) => norm(x.name) === norm(g.name) && x.status !== 'have');
    if (p && p.status !== 'have') updateRow('pantry_items', p.id, { status: 'have' });
  }
}

function sendToGrocery(p) { return addGrocery(p.name, { pantry_item_id: p.id }); }

/* ---------- screens ---------- */
let destroyFx = null;

function signinView() {
  const ready = api.configured || PREVIEW;
  return `<canvas class="fx" aria-hidden="true"></canvas>
  <main class="si">
    <div class="si-in">
      <div class="mark rise">${ic('home')}</div>
      <h1 class="rise d1">Home</h1>
      <p class="sub rise d1">Your household, on both phones.</p>
      <form class="form rise d2" data-form="signin" novalidate>
        <label class="lbl" for="em">Email</label>
        <input class="in" id="em" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" required>
        <label class="lbl" for="pw">Password</label>
        <input class="in" id="pw" name="password" type="password" autocomplete="current-password" required>
        <p class="err" id="err" role="alert" hidden></p>
        <button class="pri press" type="submit" ${ready ? '' : 'disabled'}>Sign in ${ic('arr')}</button>
        <p class="foot">${ready ? 'Stays signed in on this phone.' : 'Setup needed: add the project URL and key to config.js.'}</p>
      </form>
    </div>
  </main>`;
}

function steps() {
  return [
    { done: !!myName(), title: 'Add your name', body: 'So the app shows your name, not your email.', go: '#/settings' },
    { done: installed(), title: 'Add Home to your home screen', body: 'In Safari, tap Share, then Add to Home Screen. It opens full screen and stays signed in.' },
    { done: !!partner() || ls.get(K.later, false), title: 'Get your partner signed in', body: 'Open Home on their phone, add it to the home screen, and sign in.', later: true }
  ];
}

function phoneLine(th) {
  if (th.theme !== 'night') return THEMES[th.theme].long;
  if (th.dimmed) return 'Night Shift, dimmed until 6 AM';
  return th.dimOn ? 'Night Shift, dims at 10 PM' : 'Night Shift';
}

function header(eyebrow, title) {
  return `<header class="hd"><div class="top"><p class="eyebrow">${eyebrow}</p>${badgeHtml()}</div><h1>${title}</h1></header>`;
}

function dock(on) {
  const b = (k, label, icon) => `<a class="press${on === k ? ' on' : ''}" href="#/${k}" ${on === k ? 'aria-current="page"' : ''}>${ic(icon)}${label}</a>`;
  return `<nav class="dockwrap" aria-label="Main"><div class="dock">${b('home', 'Home', 'home')}${b('grocery', 'Grocery', 'cart')}${b('kitchen', 'Kitchen', 'box')}${b('chores', 'Chores', 'chore')}${b('settings', 'Settings', 'set')}</div></nav>`;
}

function choreLine() {
  const today = todayStr();
  const act = choresAll().filter((c) => c.active && c.due_date);
  const o = act.filter((c) => S.isOverdue(c, today)).length, d = act.filter((c) => c.due_date === today).length;
  return [o && `${o} overdue`, d && `${d} due today`].filter(Boolean).join(', ');
}
function resetCard() {
  const today = todayStr();
  if (S.weekdayOf(today) !== 0) return '';
  const n = missed(today).filter(S.resetsWeekly).length;
  return n ? `<a class="card press rise d1" href="#/reset"><div class="ic">${ic('reset')}</div><div><b>Sunday reset</b><small>${plural(n, 'chore')} to start fresh</small></div></a>` : '';
}

function homeView() {
  const th = T.apply();
  const name = myName();
  const s = steps();
  const next = s.find((x) => !x.done);
  const doneCount = s.filter((x) => x.done).length;
  const p = partner();
  const hero = next ? `<div class="stack rise">
      <${next.go ? `a href="${next.go}"` : 'section'} class="hero${next.go ? ' press' : ''}">
        <p class="eyebrow">Next up</p>
        <h2>${esc(next.title)}${next.go ? ic('chev', 'i hchev') : ''}</h2>
        <p>${esc(next.body)}</p>
        <div class="prog" role="img" aria-label="${doneCount} of ${s.length} setup steps done"><div class="trk"><b style="width:${(doneCount / s.length) * 100}%"></b></div><span>${doneCount} of ${s.length}</span></div>
        ${next.later ? `<button class="later press" data-act="later">Later</button>` : ''}
      </${next.go ? 'a' : 'section'}></div>` : '';
  const house = p
    ? `${name ? esc(name) : 'You'} and ${esc(p.display_name)}, both signed in`
    : `${name ? esc(name) + ' signed in' : 'You’re signed in'}, partner not yet`;
  const toGet = groceryOpen().length;
  const out = pantry().filter((x) => x.status === 'out').length, low = pantry().filter((x) => x.status === 'low').length;
  const kitchenLine = [out && `${out} out`, low && `${low} low`].filter(Boolean).join(', ');
  return `${header(today(), name ? `${greeting()},<br>${esc(name)}` : greeting())}
  <main>
    ${hero}
    ${toGet ? `<a class="card press rise d1" href="#/grocery"><div class="ic">${ic('cart')}</div><div><b>Grocery</b><small>${plural(toGet, 'thing')} to get</small></div></a>` : ''}
    ${resetCard()}
    ${choreLine() ? `<a class="card press rise d1" href="#/chores"><div class="ic">${ic('chore')}</div><div><b>Chores</b><small>${choreLine()}</small></div></a>` : ''}
    ${kitchenLine ? `<a class="card press rise d1" href="#/kitchen"><div class="ic">${ic('box')}</div><div><b>Kitchen</b><small>${kitchenLine}</small></div></a>` : ''}
    <a class="card press rise d2" href="#/settings"><div class="ic">${ic('ppl')}</div><div><b>Household</b><small>${house}</small></div></a>
    <a class="card press rise d2" href="#/settings"><div class="ic">${ic(th.theme === 'night' ? 'moon' : 'sun')}</div><div><b>This phone</b><small>${phoneLine(th)}</small></div></a>
  </main>
  ${dock('home')}`;
}

/* --- grocery --- */
const sec = (a, b = '') => `<div class="sec"><b>${a}</b><span>${b}</span></div>`;
const cbx = (on, id) => `<button class="cb${on ? ' on' : ''} press" data-act="gcheck" data-id="${id}" role="checkbox" aria-checked="${on}" aria-label="${on ? 'Uncheck' : 'Check off'}">${on ? ic('check') : ''}</button>`;

function groceryRow(g) {
  const done = !!g.checked_at;
  return `<div class="it${done ? ' done' : ''}">${cbx(done, g.id)}
    <button class="nm" data-act="gitem" data-id="${g.id}">${esc(g.name)}${g.note ? `<small>${esc(g.note)}</small>` : ''}</button>
    ${!done && !g.store ? `<button class="tag press" data-act="gitem" data-id="${g.id}">Tag store</button>` : ''}</div>`;
}

function groceryView() {
  const open = groceryOpen(), done = groceryDone();
  const groups = [[null, 'Unsorted'], ...STORES].map(([k, label]) => [label, open.filter((g) => (g.store || null) === k)]).filter(([, items]) => items.length);
  return `${header(open.length ? `${open.length} to get` : 'All set', 'Grocery')}
  <main>
    <form class="qa rise" data-form="gadd" autocomplete="off">
      <div class="row"><input class="fld" name="name" type="text" placeholder="${cozy() ? 'What do we need?' : 'Add an item'}" maxlength="80" enterkeyhint="done" aria-label="Add an item">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}<span>Add</span></button></div>
      <div class="chips"><button type="button" class="chip press" data-act="addfrom" data-tab="staples">${ic('star')}Staples</button><button type="button" class="chip press" data-act="addfrom" data-tab="costco">${ic('bag')}Buy at Costco</button></div>
    </form>
    ${!open.length && !done.length ? `<p class="empty">Nothing on the list. Add things as you think of them, or tap Staples.</p>` : ''}
    ${groups.map(([label, items]) => `${sec(label, items.length)}<div class="list">${items.map(groceryRow).join('')}</div>`).join('')}
    ${done.length ? `<div class="sec"><b>Got it</b><button class="clear press" data-act="gclear">Clear ${done.length}</button></div><div class="list">${done.map(groceryRow).join('')}</div>` : ''}
  </main>
  ${dock('grocery')}`;
}

/* --- kitchen --- */
function hlo(p) {
  const b = (s, label) => `<button class="${p.status === s ? s[0] : ''}" data-act="pstat" data-id="${p.id}" data-s="${s}" aria-pressed="${p.status === s}">${label}</button>`;
  return `<span class="hlo" role="group" aria-label="${esc(p.name)} status">${b('have', 'Have')}${b('low', 'Low')}${b('out', 'Out')}</span>`;
}

function pantryRow(p) {
  let sub = '';
  if (p.status === 'out') {
    sub = onGrocery(p.name, p.id)
      ? `<span class="onlist">${ic('check')}On grocery</span>`
      : `<span class="send press" data-act="psend" data-id="${p.id}" role="button">${ic('plus')}Grocery</span>`;
  }
  return `<div class="it"><div class="nm"><button class="nmb" data-act="pitem" data-id="${p.id}">${esc(p.name)}</button>${sub}</div>${hlo(p)}</div>`;
}

function kitchenView() {
  const loc = ui.loc;
  const here = pantry().filter((p) => p.location === loc).sort((a, b) => a.name.localeCompare(b.name));
  const need = outNotListed();
  const seg = LOCS.map(([k, label]) => k === LOC_SOON
    ? `<span class="soon" aria-disabled="true">Garage<br>soon</span>`
    : `<button class="${k === loc ? 'on' : ''}" data-act="loc" data-loc="${k}" aria-pressed="${k === loc}" aria-label="${label}">${LOC_SHORT[k] || label}</button>`).join('');
  const hero = need.length ? `<div class="stack rise" style="margin:14px 0 26px"><section class="hero sum">
      <p class="eyebrow">Out</p>
      <h2>${esc(need[0].name)}${need.length > 1 ? ` and ${plural(need.length - 1, 'more', 'more')}` : ''}</h2>
      <p>${need.length > 1 ? 'Out, and not on the grocery list yet.' : `Out${need[0].location !== loc ? ` in the ${locName(need[0].location).toLowerCase()}` : ''}, and not on the grocery list yet.`}</p>
      <button class="pri press" data-act="psendall">${ic('cart')}${need.length > 1 ? `Add ${need.length} to grocery` : 'Add to grocery'}</button>
    </section></div>` : '';
  const block = (s, label) => { const items = here.filter((p) => p.status === s); return items.length ? `${sec(label, items.length)}<div class="list">${items.map(pantryRow).join('')}</div>` : ''; };
  return `${header(`${locName(loc)} · ${plural(here.length, 'item')}`, 'Kitchen')}
  <main>
    <div class="seg rise" role="group" aria-label="Location">${seg}</div>
    ${hero}
    <form class="qa slim rise" data-form="padd" autocomplete="off"><div class="row">
      <input class="fld" name="name" type="text" placeholder="Add to ${locName(loc).toLowerCase()}" maxlength="80" enterkeyhint="done" aria-label="Add to ${locName(loc).toLowerCase()}">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div></form>
    ${!here.length ? `<p class="empty">Nothing in the ${locName(loc).toLowerCase()} yet. Add what you keep here, then mark it Low or Out when it runs down.</p>` : ''}
    ${block('out', 'Out')}${block('low', 'Low')}${block('have', 'Have')}
  </main>
  ${dock('kitchen')}`;
}

/* --- chores and tasks --- */
const todayStr = () => S.localToday(T.now());
const choresAll = () => live('tasks').filter((t) => t.kind === 'chore');
const tasksAll = () => live('tasks').filter((t) => t.kind === 'task');
const partnerId = () => state.members.find((id) => id !== myId()) || partner()?.user_id || null;
const userName = (id) => { const n = (profileOf(id)?.display_name || '').trim(); return n || (id === myId() ? 'You' : 'Partner'); };
const whoKey = (t) => (!t.assignee ? 'either' : t.assignee === myId() ? 'me' : 'partner');
const whoInitial = (t) => (!t.assignee ? 'E' : (userName(t.assignee)[0] || '?').toUpperCase());
const whoLine = (t) => (!t.assignee ? 'Either' : userName(t.assignee));
const passWho = (t) => ui.who === 'all' || whoKey(t) === ui.who;
const missed = (today) => choresAll().filter((c) => c.active && S.isOverdue(c, today));
const TASK_LISTS = ['House', 'Kids', 'Errands'];
const taskLists = () => [...new Set([...TASK_LISTS, ...tasksAll().map((t) => t.category).filter(Boolean), ...ls.get(K.lists, [])])];
const eventsOf = (id) => live('task_events').filter((e) => e.task_id === id).sort((a, b) => String(b.at).localeCompare(String(a.at)));

function recordEvent(t, kind, due) {
  insertRow('task_events', { task_id: t.id, kind, due_date: due, at: new Date().toISOString(), by_user: myId() }, { conflict: 'task_id,kind,due_date' });
}

// Done or skip closes the open instance and schedules the next one. One open instance per chore, never a stack.
function closeChore(c, kind) {
  const today = todayStr();
  if (c.kind === 'task' || c.repeat_mode === 'once') {
    if (kind === 'done') { recordEvent(c, 'done', c.due_date || today); updateRow('tasks', c.id, { done_at: new Date().toISOString() }); }
    return;
  }
  recordEvent(c, kind, c.due_date || today);
  updateRow('tasks', c.id, { due_date: S.nextDue(c, today) });
}

// Sunday reset: frequent misses start fresh; monthly-or-longer ones and tasks stay until done. History is kept.
function resetWeek() {
  const today = todayStr();
  let n = 0;
  for (const c of missed(today)) {
    if (!S.resetsWeekly(c)) continue;
    const next = S.resetDue(c, today);
    if (next && next !== c.due_date) { recordEvent(c, 'reset', c.due_date); updateRow('tasks', c.id, { due_date: next }); n++; }
  }
  return n;
}

function newChore() {
  const today = todayStr();
  const c = { kind: 'chore', title: 'New chore', category: null, assignee: null, priority: false, notes: null, howto: null, active: true,
    repeat_mode: 'after', every: 1, unit: 'week', week_of_month: null, weekday: null, months: null };
  c.anchor_date = c.due_date = S.initialDue(c, today);
  return insertRow('tasks', c);
}

function choreRow(c, today) {
  const due = S.shownDue(c, today), late = S.isOverdue(c, today);
  const open = ui.howto === c.id && c.howto;
  return `<div class="it${late ? ' late' : ''}">${`<button class="cb press" data-act="cdone" data-id="${c.id}" role="checkbox" aria-checked="false" aria-label="Done: ${esc(c.title)}"></button>`}
    <button class="nm" data-act="citem" data-id="${c.id}">${esc(c.title)}<span class="meta"><b>${S.dueLabel(due, today)}</b> · ${esc(S.repeatLabel(c))}</span></button>
    ${c.howto ? `<button class="qbtn press" data-act="howto" data-id="${c.id}" aria-expanded="${!!open}" aria-label="How to">${ic('q')}</button>` : ''}
    <span class="who${whoKey(c) === 'me' ? ' me' : ''}" title="${esc(whoLine(c))}">${esc(whoInitial(c))}</span></div>
    ${open ? `<div class="howto"><ol>${c.howto.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<li>${esc(l.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol></div>` : ''}`;
}

function choresView() {
  const today = todayStr(), weekEnd = S.addDays(today, 6);
  const tabs = `<div class="seg rise" role="group" aria-label="Chores or tasks"><button class="${ui.choreTab === 'chores' ? 'on' : ''}" data-act="ctab" data-v="chores">Chores</button><button class="${ui.choreTab === 'tasks' ? 'on' : ''}" data-act="ctab" data-v="tasks">Tasks</button></div>`;
  if (ui.choreTab === 'tasks') return tasksView(tabs);
  const all = choresAll().filter((c) => c.active && c.due_date);
  const list = all.filter(passWho).map((c) => ({ c, due: S.shownDue(c, today) })).sort((a, b) => a.due.localeCompare(b.due) || a.c.title.localeCompare(b.c.title));
  const over = list.filter((x) => S.isOverdue(x.c, today));
  const hero = over[0] || list.find((x) => x.due === today);
  const rest = list.filter((x) => x !== hero);
  const groups = [
    ['Overdue', rest.filter((x) => S.isOverdue(x.c, today))],
    ['Today', rest.filter((x) => x.due === today && !S.isOverdue(x.c, today))],
    ['This week', rest.filter((x) => x.due > today && x.due <= weekEnd)]
  ];
  const later = rest.filter((x) => x.due > weekEnd);
  const off = choresAll().filter((c) => !c.active && passWho(c));
  const overAll = all.filter((c) => S.isOverdue(c, today)).length;
  const weekAll = all.filter((c) => { const d = S.shownDue(c, today); return d >= today && d <= weekEnd; }).length;
  const chip = (k, label) => `<button class="fchip press${ui.who === k ? ' on' : ''}" data-act="cwhof" data-v="${k}">${esc(label)}</button>`;
  const heroHtml = hero ? `<div class="stack rise" style="margin:12px 0 26px"><section class="hero chore">
      <p class="eyebrow">${S.isOverdue(hero.c, today) ? `Overdue · ${plural(-S.diffDays(hero.c.due_date, today), 'day')}` : 'Due today'}</p>
      <h2>${esc(hero.c.title)}</h2><p>${esc(S.repeatLabel(hero.c))} · ${esc(whoLine(hero.c))}</p>
      <div class="acts"><button class="pri press" data-act="cdonehero" data-id="${hero.c.id}">${ic('check')}Done</button><button class="skipb press" data-act="cskip" data-id="${hero.c.id}">Skip</button></div>
    </section></div>` : '';
  const sections = groups.filter(([, xs]) => xs.length).map(([label, xs]) => `${sec(label, xs.length)}<div class="list">${xs.map((x) => choreRow(x.c, today)).join('')}</div>`).join('');
  const laterHtml = later.length ? (ui.showLater
    ? `${sec('Later', later.length)}<div class="list">${later.map((x) => choreRow(x.c, today)).join('')}</div>`
    : `<button class="more press" data-act="clater">Show ${plural(later.length, 'later chore')}</button>`) : '';
  const offHtml = ui.showLater && off.length ? `${sec('Switched off', off.length)}<div class="list">${off.map((c) => `<div class="it off"><span class="cb ghosted"></span><button class="nm" data-act="citem" data-id="${c.id}">${esc(c.title)}<span class="meta">${esc(S.repeatLabel(c))}</span></button></div>`).join('')}</div>` : '';
  const pName = partnerId() ? userName(partnerId()) : null;
  return `${header(overAll || weekAll ? [overAll && `${overAll} overdue`, weekAll && `${weekAll} this week`].filter(Boolean).join(' · ') : 'All caught up', 'Chores')}
  <main>
    ${tabs}
    <div class="fchips rise">${chip('all', 'Everyone')}${chip('me', myName() || 'Me')}${pName ? chip('partner', pName) : ''}${chip('either', 'Either')}</div>
    ${heroHtml}
    ${!list.length && !off.length ? `<p class="empty">${choresAll().length ? 'Nothing for this filter.' : 'No chores yet. Import your list in Settings, or add one below.'}</p>` : ''}
    ${sections}${laterHtml}${offHtml}
    <div class="crow"><button class="more press" data-act="cnew">${ic('plus')}New chore</button><a class="more press" href="#/reset">${ic('reset')}Sunday reset</a></div>
  </main>
  ${dock('chores')}`;
}

function tasksView(tabs) {
  const today = todayStr();
  const open = tasksAll().filter((t) => !t.done_at);
  const done = tasksAll().filter((t) => t.done_at).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 30);
  const sort = (a, b) => (b.priority - a.priority) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const lists = taskLists();
  const cat = lists.includes(ui.taskCat) ? ui.taskCat : lists[0];
  const row = (t) => `<div class="it${t.done_at ? ' done' : ''}">
      <button class="cb${t.done_at ? ' on' : ''} press" data-act="tdone" data-id="${t.id}" role="checkbox" aria-checked="${!!t.done_at}" aria-label="${t.done_at ? 'Not done' : 'Done'}: ${esc(t.title)}">${t.done_at ? ic('check') : ''}</button>
      <button class="nm" data-act="titem" data-id="${t.id}">${esc(t.title)}${t.due_date && !t.done_at ? `<span class="meta">${S.isOverdue(t, today) ? `<b>${S.dueLabel(t.due_date, today)}</b>` : `Due ${S.dueLabel(t.due_date, today)}`}</span>` : ''}</button>
      ${t.done_at ? '' : `<button class="flag press${t.priority ? ' on' : ''}" data-act="tflag" data-id="${t.id}" aria-pressed="${t.priority}" aria-label="Priority">${ic('flag')}</button>`}</div>`;
  const flagged = open.filter((t) => t.priority).length;
  const byList = lists.map((l) => [l, open.filter((t) => (t.category || 'House') === l).sort(sort)]).filter(([, xs]) => xs.length);
  return `${header(open.length ? `${open.length} open${flagged ? ` · ${flagged} flagged` : ''}` : 'All done', 'Tasks')}
  <main>
    ${tabs}
    <form class="qa rise" data-form="tadd" autocomplete="off" style="margin-top:12px">
      <div class="row"><input class="fld" name="name" type="text" placeholder="${cozy() ? 'What needs doing?' : 'Add a task'}" maxlength="120" enterkeyhint="done" aria-label="Add a task">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}<span>Add</span></button></div>
      <div class="chips">${lists.map((l) => `<button type="button" class="chip press${l === cat ? ' on' : ''}" data-act="tcat" data-v="${esc(l)}" aria-pressed="${l === cat}">${esc(l)}</button>`).join('')}<button type="button" class="chip press" data-act="tnewcat">${ic('plus')}List</button></div>
    </form>
    ${!open.length ? `<p class="empty">Nothing open. Add things as they come up; flag the ones that matter most.</p>` : ''}
    ${byList.map(([l, xs]) => `${sec(esc(l), xs.length)}<div class="list">${xs.map(row).join('')}</div>`).join('')}
    ${done.length ? (ui.showDone ? `${sec('Done', done.length)}<div class="list">${done.map(row).join('')}</div>` : `<button class="more press" data-act="tshowdone">Show ${plural(done.length, 'done task')}</button>`) : ''}
  </main>
  ${dock('chores')}`;
}

function resetView() {
  const today = todayStr();
  const miss = missed(today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const fresh = miss.filter(S.resetsWeekly), stay = miss.filter((c) => !S.resetsWeekly(c));
  const row = (c, next) => `<div class="it"><span class="pill">${esc(S.repeatLabel(c).split(',')[0].split(' · ')[0])}</span><span class="nm">${esc(c.title)}<span class="meta">${S.dueLabel(c.due_date, today)} · ${next}</span></span></div>`;
  const doneMsg = ui.resetCount != null ? `<div class="hero sum rise" style="margin-bottom:14px"><p class="eyebrow">Done</p><h2>Week reset</h2><p>${ui.resetCount ? `${plural(ui.resetCount, 'chore')} start${ui.resetCount === 1 ? 's' : ''} fresh.` : 'Nothing needed resetting.'} History is kept.</p></div>` : '';
  const dateLine = new Date(S.parse(today)).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${header(dateLine, 'Sunday reset')}
  <main class="has-big">
    ${doneMsg}
    ${miss.length ? `<p class="rs-sum">${plural(miss.length, 'thing was', 'things were')} missed. ${fresh.length ? 'The weekly ones start fresh; ' : ''}${stay.length ? 'the rest stay until they’re done.' : ''}</p>` : (ui.resetCount == null ? `<p class="empty">Nothing missed. Nice week.</p>` : '')}
    ${fresh.length ? `${sec('Starts fresh', fresh.length)}<div class="list">${fresh.map((c) => row(c, `next ${S.dueLabel(S.resetDue(c, today), today)}`)).join('')}</div>` : ''}
    ${stay.length ? `${sec('Stays until done', stay.length)}<div class="list">${stay.map((c) => row(c, 'still due')).join('')}</div>` : ''}
  </main>
  ${fresh.length ? `<div class="bigbtn"><button class="pri press" data-act="resetweek">${ic('reset')}Reset week</button></div>` : ''}
  ${dock('chores')}`;
}

function choreSheet(c) {
  if (!c || c.deleted_at) return '';
  const today = todayStr();
  const pid = partnerId();
  const seg = (act, opts, cur) => `<div class="seg sm">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-act="${act}" data-id="${c.id}" data-v="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div>`;
  const sel = (field, opts, cur) => `<select class="sel" data-field="${field}" data-id="${c.id}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const monthly = c.unit === 'month' || c.unit === 'year';
  const hist = eventsOf(c.id).slice(0, 6).map((e) => `${S.dueLabel(S.localToday(new Date(e.at)), today)} · ${e.kind === 'done' ? `done by ${esc(userName(e.by_user))}` : e.kind === 'skip' ? 'skipped' : 'reset on Sunday'}`).join('<br>');
  const months = c.months && c.months.length ? c.months : [];
  return `<h2><input class="ttl" data-field="title" data-id="${c.id}" value="${esc(c.title)}" maxlength="120" aria-label="Chore name" enterkeyhint="done"><button class="lnk" data-act="close">Done</button></h2>
    <div class="scroll">
      <div class="acts2"><button class="pri press" data-act="cdone" data-id="${c.id}">${ic('check')}Mark done</button><button class="ghost press" data-act="cskip" data-id="${c.id}">Skip</button></div>
      <div class="list frm">
        <div class="frow">Who${seg('cwho', [['me', myName() || 'Me'], ...(pid ? [['partner', userName(pid)]] : []), ['either', 'Either']], whoKey(c))}</div>
        <label class="frow">Next due<input type="date" class="dt" data-field="due_date" data-id="${c.id}" value="${c.due_date || ''}"></label>
        <div class="frow">Repeats<span class="pair"><span class="evl">Every</span><input type="number" class="num" min="1" max="365" inputmode="numeric" data-field="every" data-id="${c.id}" value="${c.every || 1}" aria-label="Every">${sel('unit', [['day', c.every > 1 ? 'days' : 'day'], ['week', c.every > 1 ? 'weeks' : 'week'], ['month', c.every > 1 ? 'months' : 'month'], ['year', c.every > 1 ? 'years' : 'year']], c.unit)}</span></div>
        ${monthly ? `<div class="frow">Week of the month${sel('week_of_month', [['', 'Any'], ['1', 'Week 1'], ['2', 'Week 2'], ['3', 'Week 3'], ['4', 'Week 4']], c.week_of_month)}</div>` : ''}
        ${c.unit === 'week' || (monthly && c.week_of_month) ? `<div class="frow">Day${sel('weekday', [['', 'Any'], ...S.WEEKDAYS.map((d, i) => [String(i), d])], c.weekday)}</div>` : ''}
        <div class="frow">Count from${seg('cmode', [['after', 'Last done'], ['fixed', 'Schedule']], c.repeat_mode === 'fixed' ? 'fixed' : 'after')}</div>
      </div>
      <p class="hint">${esc(S.repeatLabel(c))}. ${c.repeat_mode === 'fixed' ? 'Stays on the calendar even when it’s done late.' : 'The next one is counted from the day it’s done.'}</p>
      ${sec('Only in these months', months.length ? `${months.length} of 12` : 'All year')}
      <div class="months">${S.MONTHS.map((m, i) => `<button class="press${!months.length || months.includes(i + 1) ? ' on' : ''}" data-act="cmonth" data-id="${c.id}" data-m="${i + 1}" aria-pressed="${!months.length || months.includes(i + 1)}">${m}</button>`).join('')}</div>
      ${sec('How-to', 'One step per line')}
      <textarea class="ta" data-field="howto" data-id="${c.id}" rows="4" placeholder="Steps for anything unusual">${esc(c.howto || '')}</textarea>
      ${sec('Notes')}
      <textarea class="ta" data-field="notes" data-id="${c.id}" rows="2" placeholder="Optional">${esc(c.notes || '')}</textarea>
      <div class="list frm" style="margin-top:12px">
        <label class="frow">Group<input class="txt" data-field="category" data-id="${c.id}" value="${esc(c.category || '')}" placeholder="Optional" maxlength="40"></label>
        <button class="frow swr" role="switch" aria-checked="${c.active}" data-act="cactive" data-id="${c.id}">Switched on<span class="tg" aria-hidden="true"></span></button>
      </div>
      ${hist ? `${sec('History')}<div class="hist">${hist}</div>` : ''}
      <button class="ghost press" data-act="cdel" data-id="${c.id}" style="margin-top:14px">Delete chore</button>
    </div>`;
}

function taskSheet(t) {
  if (!t || t.deleted_at) return '';
  const lists = taskLists();
  return `<h2><input class="ttl" data-field="title" data-id="${t.id}" value="${esc(t.title)}" maxlength="120" aria-label="Task" enterkeyhint="done"><button class="lnk" data-act="close">Done</button></h2>
    <div class="list frm">
      <label class="frow">List<select class="sel" data-field="category" data-id="${t.id}">${lists.map((l) => `<option${l === (t.category || 'House') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="frow">Due<input type="date" class="dt" data-field="due_date" data-id="${t.id}" value="${t.due_date || ''}"></label>
      <button class="frow swr" role="switch" aria-checked="${!!t.priority}" data-act="tflag" data-id="${t.id}">Priority<span class="tg" aria-hidden="true"></span></button>
    </div>
    ${sec('Notes')}
    <textarea class="ta" data-field="notes" data-id="${t.id}" rows="3" placeholder="Optional">${esc(t.notes || '')}</textarea>
    <button class="ghost press" data-act="tdel" data-id="${t.id}" style="margin-top:14px">Delete task</button>`;
}

/* --- bottom sheets --- */
function sheetView() {
  const s = ui.sheet;
  if (!s) return '';
  let body = '';
  if (s.type === 'addfrom') body = addFromSheet(s.tab);
  else if (s.type === 'gitem') body = groceryItemSheet(findRow('grocery_items', s.id));
  else if (s.type === 'pitem') body = pantryItemSheet(findRow('pantry_items', s.id));
  else if (s.type === 'chore') body = choreSheet(findRow('tasks', s.id));
  else if (s.type === 'task') body = taskSheet(findRow('tasks', s.id));
  if (!body) { ui.sheet = null; return ''; }
  return `<div class="scrim" data-act="close"></div><div class="bs${s.type === 'addfrom' || s.type === 'chore' ? '' : ' short'}" role="dialog" aria-modal="true">
    <div class="grab" data-act="close"></div>${body}</div>`;
}

function addFromSheet(tab) {
  const list = live('staples').filter((x) => (x.list || 'staples') === tab).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
  const groups = tab === 'costco'
    ? COSTCO_GROUPS.map((c) => [c, list.filter((x) => (COSTCO_GROUPS.includes(x.category) ? x.category : 'Other') === c)])
    : [...STORES.map(([k, l]) => [l, list.filter((x) => x.store === k)]), ['Any store', list.filter((x) => !x.store)]];
  const row = (x) => {
    const on = !!onGrocery(x.name);
    const right = ui.edit
      ? `<button class="plus press" data-act="delstaple" data-id="${x.id}" aria-label="Remove ${esc(x.name)}">${ic('x')}</button>`
      : on ? `<span class="onlist" data-sid="${x.id}">${ic('check')}On list</span>` : `<button class="plus press" data-act="addstaple" data-id="${x.id}" aria-label="Add ${esc(x.name)}">${ic('plus')}</button>`;
    return `<div class="it"><span class="nm">${esc(x.name)}</span>${right}</div>`;
  };
  const choices = tab === 'costco' ? COSTCO_GROUPS : [...STORES.map((x) => x[1]), 'Any store'];
  const pick = ui.newGroup && choices.includes(ui.newGroup) ? ui.newGroup : choices[0];
  const addForm = ui.edit ? `<form class="newst" data-form="sadd" autocomplete="off">
      <div class="row"><input class="fld2" name="name" type="text" placeholder="${tab === 'costco' ? 'Add to the Costco list' : 'Add a staple'}" maxlength="80" enterkeyhint="done">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div>
      <div class="picks">${choices.map((c) => `<button type="button" class="pick${c === pick ? ' on' : ''}" data-act="newgroup" data-g="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    </form>` : '';
  const empty = !list.length ? `<p class="empty">${tab === 'costco'
    ? 'No Costco list yet. Import it from Settings, or tap Edit to add items.'
    : 'No staples yet. Tap Edit to add the things you buy every time.'}</p>` : '';
  return `<h2>${ui.edit ? 'Edit list' : 'Add from'}<button class="lnk" data-act="edit">${ui.edit ? 'Done' : 'Edit'}</button></h2>
    <div class="seg"><button class="${tab === 'staples' ? 'on' : ''}" data-act="addfrom" data-tab="staples">Staples</button><button class="${tab === 'costco' ? 'on' : ''}" data-act="addfrom" data-tab="costco">Buy at Costco</button></div>
    <div class="scroll">${addForm}${empty}${groups.filter(([, items]) => items.length).map(([label, items]) => `${sec(esc(label))}<div class="list">${items.map(row).join('')}</div>`).join('')}</div>`;
}

function groceryItemSheet(g) {
  if (!g || g.deleted_at) return '';
  const opt = (k, label) => `<button class="opt press${(g.store || null) === k ? ' on' : ''}" data-act="gstore" data-id="${g.id}" data-store="${k || ''}">${label}${(g.store || null) === k ? ic('check') : ''}</button>`;
  return `<h2>${esc(g.name)}</h2>
    <p class="gt">Store</p>
    <div class="list opts">${STORES.map(([k, l]) => opt(k, l)).join('')}${opt(null, 'No store yet')}</div>
    <button class="ghost press" data-act="gdel" data-id="${g.id}">Remove from list</button>`;
}

function pantryItemSheet(p) {
  if (!p || p.deleted_at) return '';
  const opt = ([k, label]) => k === LOC_SOON
    ? `<span class="opt soon">${label}<small>Coming soon</small></span>`
    : `<button class="opt press${p.location === k ? ' on' : ''}" data-act="ploc" data-id="${p.id}" data-loc="${k}">${label}${p.location === k ? ic('check') : ''}</button>`;
  return `<h2>${esc(p.name)}</h2>
    <p class="gt">Kept in</p>
    <div class="list opts">${LOCS.map(opt).join('')}</div>
    <button class="ghost press" data-act="pdel" data-id="${p.id}">Remove from kitchen</button>`;
}

/* --- settings --- */
function settingsView() {
  const th = T.apply();
  const p = partner();
  const tile = (k) => {
    const t = THEMES[k], sel = th.theme === k;
    return `<button class="tile press${sel ? ' sel' : ''}" role="radio" aria-checked="${sel}" data-theme="${k}">
      ${swatch(t.sw)}<span><small>${t.group}</small>${t.name}</span></button>`;
  };
  const costco = live('staples').filter((x) => x.list === 'costco').length;
  return `${header('Theme is per phone', 'Settings')}
  <main>
    <p class="gt">Names</p>
    <div class="grp rise">
      <label class="fl" for="nm">You<input id="nm" type="text" value="${esc(myName())}" placeholder="Add your name" maxlength="40" autocomplete="nickname" enterkeyhint="done"></label>
      <div class="fl">Partner<span class="v">${p ? esc(p.display_name) : 'Not signed in yet'}</span></div>
    </div>
    <p class="gt">Theme</p>
    <div class="grp rise d1">
      <div class="tiles" role="radiogroup" aria-label="Theme">${tile('blush')}${tile('roast')}${tile('night')}</div>
      ${th.theme === 'night' ? `<button class="fl swr" role="switch" aria-checked="${th.dimOn}" data-act="dim">Dim 10 PM to 6 AM<span class="tg" aria-hidden="true"></span></button>` : ''}
    </div>
    <p class="gt">Lists</p>
    <div class="grp rise d1">
      <label class="fl press">Import Costco list<span class="v">${costco ? `${costco} items` : 'CSV file'}</span><input class="hide" type="file" accept=".csv,text/csv" data-act="costcocsv"></label>
      <label class="fl press">Import chores<span class="v">${choresAll().length ? `${choresAll().length} chores` : 'CSV file'}</span><input class="hide" type="file" accept=".csv,text/csv" data-act="chorescsv"></label>
    </div>
    <button class="ghost press rise d2" data-act="signout">Sign out</button>
    <p class="ver" data-act="ver">Version ${VERSION}</p>
  </main>
  ${dock('settings')}`;
}

/* ---------- Costco CSV import (columns: name, category, store, good_to_freeze) ---------- */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function importCostco(file) {
  const rows = parseCsv(await file.text());
  const head = (rows.shift() || []).map(norm);
  const col = (n) => head.indexOf(n);
  if (col('name') < 0) { alert('That file needs a "name" column.'); return; }
  const have = new Set(live('staples').filter((x) => x.list === 'costco').map((x) => norm(x.name)));
  let added = 0;
  rows.forEach((r, i) => {
    const name = (r[col('name')] || '').trim().slice(0, 80);
    if (!name || have.has(norm(name))) return;
    const cat = (r[col('category')] || '').trim();
    insertRow('staples', { list: 'costco', name, store: 'costco', category: COSTCO_GROUPS.find((g) => norm(g) === norm(cat)) || 'Other', sort: i });
    have.add(norm(name)); added++;
  });
  alert(added ? `Added ${plural(added, 'item')} to the Costco list.` : 'Everything in that file is already on the list.');
  render({ soft: true });
}

/* ---------- chores CSV import ----------
   columns: name, group, repeat_mode (fixed | after_completion | once), every, unit, week_of_month,
   months (Mar;Jun), day (Tue), owner (Me | Either), active (yes | no), notes, howto, start_date */
async function importChores(file) {
  const rows = parseCsv(await file.text());
  const head = (rows.shift() || []).map(norm);
  const col = (n) => head.indexOf(n);
  const get = (r, n) => (col(n) < 0 ? '' : (r[col(n)] || '').trim());
  if (col('name') < 0) { alert('That file needs a "name" column.'); return; }
  const today = todayStr();
  const have = new Set(live('tasks').map((t) => norm(t.title)));
  let chores = 0, tasks = 0, off = 0;
  for (const r of rows) {
    const title = get(r, 'name').slice(0, 120);
    if (!title || have.has(norm(title))) continue;
    const mode = norm(get(r, 'repeat_mode'));
    const base = { title, notes: get(r, 'notes') || null, howto: get(r, 'howto') || null, priority: false, done_at: null };
    if (mode === 'once') {
      insertRow('tasks', { ...base, kind: 'task', category: 'House', priority: true, active: true, repeat_mode: 'once', every: 1, unit: 'week', due_date: get(r, 'start_date') || null });
      tasks++; have.add(norm(title)); continue;
    }
    const day = get(r, 'day').slice(0, 3).toLowerCase();
    const months = get(r, 'months').split(/[;,]/).map((m) => S.MONTHS.findIndex((x) => x.toLowerCase() === m.trim().slice(0, 3).toLowerCase()) + 1).filter((m) => m > 0);
    const unit = ['day', 'week', 'month', 'year'].includes(norm(get(r, 'unit'))) ? norm(get(r, 'unit')) : 'week';
    const c = {
      ...base, kind: 'chore', category: get(r, 'group') || null,
      assignee: norm(get(r, 'owner')) === 'me' ? myId() : null,
      active: norm(get(r, 'active')) !== 'no',
      repeat_mode: mode === 'fixed' ? 'fixed' : 'after',
      every: Math.max(1, parseInt(get(r, 'every'), 10) || 1), unit,
      week_of_month: parseInt(get(r, 'week_of_month'), 10) || null,
      weekday: day ? S.WEEKDAYS.findIndex((d) => d.toLowerCase() === day) : null,
      months: months.length && months.length < 12 ? months : null,
      start_date: get(r, 'start_date') || null
    };
    if (c.weekday < 0) c.weekday = null;
    c.anchor_date = c.due_date = S.initialDue(c, today);
    delete c.start_date;
    insertRow('tasks', c);
    chores++; if (!c.active) off++; have.add(norm(title));
  }
  alert(chores || tasks ? `Added ${plural(chores, 'chore')}${off ? ` (${off} switched off)` : ''}${tasks ? ` and ${plural(tasks, 'task')}` : ''}.` : 'Everything in that file is already here.');
  render({ soft: true });
}

/* ---------- render + events ---------- */
let current = '';
const ROUTES = ['home', 'grocery', 'kitchen', 'chores', 'reset', 'settings'];
function route() {
  if (!api.getSession()) return 'signin';
  if (PREVIEW && PREVIEW !== 'signin' && !location.hash) return PREVIEW;
  const h = location.hash.replace('#/', '');
  return ROUTES.includes(h) ? h : 'home';
}

const VIEWS = { signin: signinView, home: homeView, grocery: groceryView, kitchen: kitchenView, chores: choresView, reset: resetView, settings: settingsView };

function render({ soft = false, keepFocus = null, fx = null } = {}) {
  const r = route();
  // Never lose what someone is typing. The name field just waits; add boxes keep their text and focus across a redraw.
  const act = $app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'file' ? document.activeElement : null;
  if (soft && !keepFocus && r === current && act && act.id === 'nm') return updateBadge();
  const typing = soft && !keepFocus && r === current && act && act.form?.dataset.form
    ? { sel: `[data-form="${act.form.dataset.form}"] input[name="${act.name}"]`, value: act.value, start: act.selectionStart, end: act.selectionEnd }
    : null;
  if (destroyFx) { destroyFx(); destroyFx = null; }
  const scroll = r === current ? $app.querySelector('main')?.scrollTop || 0 : 0;
  const sScroll = r === current ? $app.querySelector('.bs .scroll')?.scrollTop || 0 : 0;
  $app.className = `scr-${r}${(soft && r === current) || PREVIEW ? ' still' : ''}`;
  $app.innerHTML = VIEWS[r]() + (r === 'signin' ? '' : sheetView());
  if (r === current) {
    const m = $app.querySelector('main'); if (m) m.scrollTop = scroll;
    const ss = $app.querySelector('.bs .scroll'); if (ss) ss.scrollTop = sScroll;
  }
  current = r;
  if (keepFocus) $app.querySelector(keepFocus)?.focus();
  if (typing) {
    const el = $app.querySelector(typing.sel);
    if (el) { el.value = typing.value; el.focus(); try { el.setSelectionRange(typing.start, typing.end); } catch {} }
    syncAddButton(el);
  }
  // One-shot motion on whatever just changed (jelly on a check, pop on a new row).
  if (fx) for (const [sel, cls] of fx) { const el = sel && $app.querySelector(sel); if (el) el.classList.add(cls); }
  if (r === 'signin') destroyFx = startParticles($app.querySelector('canvas.fx'));
  debugReadout();
}

$app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, kind = f.dataset.form;
  if (kind === 'tadd') {
    const name = f.name.value.trim();
    if (!name) return;
    const lists = taskLists(), cat = lists.includes(ui.taskCat) ? ui.taskCat : lists[0];
    const t = insertRow('tasks', { kind: 'task', title: name.slice(0, 120), category: cat, priority: false, active: true, repeat_mode: 'once', every: 1, unit: 'week', due_date: null, done_at: null });
    render({ soft: true, keepFocus: '[data-form="tadd"] .fld', fx: [[`.it:has([data-id="${t.id}"])`, 'pop']] });
    return;
  }
  if (kind === 'gadd' || kind === 'padd' || kind === 'sadd') {
    const name = f.name.value.trim();
    if (!name) return;
    let added = null;
    if (kind === 'gadd') added = addGrocery(name);
    else if (kind === 'padd') added = insertRow('pantry_items', { name: name.slice(0, 80), location: ui.loc, status: 'have' });
    else {
      const tab = ui.sheet?.tab || 'staples';
      const choices = tab === 'costco' ? COSTCO_GROUPS : [...STORES.map((x) => x[1]), 'Any store'];
      const g = ui.newGroup && choices.includes(ui.newGroup) ? ui.newGroup : choices[0];
      const store = tab === 'costco' ? 'costco' : (STORES.find((s) => s[1] === g) || [null])[0];
      insertRow('staples', { list: tab, name: name.slice(0, 80), store, category: tab === 'costco' ? g : null, sort: 1000 });
    }
    // Stay in the field for the next item.
    const rowSel = added ? `[data-id="${added.id}"]` : null;
    render({ soft: true, keepFocus: kind === 'sadd' ? '.newst .fld2' : `[data-form="${kind}"] .fld`, fx: rowSel ? [[`.it:has(${rowSel})`, 'pop']] : null });
    return;
  }
  if (PREVIEW) return;
  const btn = f.querySelector('button[type=submit]'), err = f.querySelector('#err');
  const email = f.email.value.trim(), password = f.password.value;
  err.hidden = true;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  btn.classList.add('ld'); btn.setAttribute('aria-busy', 'true');
  try {
    await api.signIn(email, password);
    btn.classList.add('ok');
    await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520));
    resetLocal();
    location.hash = '#/home';
    render();
    pull();
    rt.wake();
  } catch (x) {
    err.textContent = x.network ? "Can't reach the server. Check your connection." : x.status === 400 ? "That email and password don't match." : x.message;
    err.hidden = false; btn.classList.remove('ld', 'ok'); btn.removeAttribute('aria-busy');
  }
});

$app.addEventListener('click', (e) => {
  // In-app links swap the screen without stacking history, so a back-swipe doesn't jump between tabs.
  const link = e.target.closest('a[href^="#/"]');
  if (link) { e.preventDefault(); if (location.hash !== link.getAttribute('href')) location.replace(link.getAttribute('href')); return; }
  const t = e.target.closest('[data-theme],[data-act]');
  if (!t || t.tagName === 'INPUT') return;
  if (t.dataset.theme) { T.setTheme(t.dataset.theme); render({ soft: true }); return; }
  const a = t.dataset.act, id = t.dataset.id;
  const soft = (fx) => render({ soft: true, keepFocus: '__none', fx });
  switch (a) {
    case 'later': ls.set(K.later, true); return soft();
    case 'dim': T.setDim(t.getAttribute('aria-checked') !== 'true'); return soft();
    case 'sync':
      if (state.error) alert(state.error);
      state.error = null; state.netFail = false; updateBadge(); pull(); rt.wake(); return;
    case 'signout': {
      const n = state.queue.length;
      if (n && !confirm(`${n} change${n > 1 ? 's haven’t' : ' hasn’t'} synced yet. Sign out anyway?`)) return;
      api.signOut(); resetLocal(); ui.sheet = null; location.hash = ''; render(); return;
    }
    case 'ver':
      verTaps = (verTaps || 0) + 1;
      clearTimeout(verTimer); verTimer = setTimeout(() => (verTaps = 0), 1500);
      if (verTaps >= 5) { verTaps = 0; ls.set(K.debug, !ls.get(K.debug, false)); debugReadout(); }
      return;
    // grocery
    case 'gcheck': toggleGrocery(id); return soft([[`[data-act="gcheck"][data-id="${id}"]`, 'jelly']]);
    case 'gclear': groceryDone().forEach((g) => removeRow('grocery_items', g.id)); return soft();
    case 'gitem': ui.sheet = { type: 'gitem', id }; return soft();
    case 'gstore': {
      const g = findRow('grocery_items', id), store = t.dataset.store || null;
      updateRow('grocery_items', id, { store });
      if (g && store) { state.storeMemory[norm(g.name)] = store; ls.set(K.stores, state.storeMemory); } // next time it goes straight there
      ui.sheet = null; return soft();
    }
    case 'gdel': removeRow('grocery_items', id); ui.sheet = null; return soft();
    // add-from sheet
    case 'addfrom': ui.sheet = { type: 'addfrom', tab: t.dataset.tab }; ui.newGroup = null; return soft();
    case 'edit': ui.edit = !ui.edit; return soft();
    case 'newgroup': ui.newGroup = t.dataset.g; return soft();
    case 'addstaple': { const x = findRow('staples', id); if (x) addGrocery(x.name, { store: x.store || (x.list === 'costco' ? 'costco' : null) }); return soft([[`[data-sid="${id}"]`, 'pop']]); }
    case 'delstaple': removeRow('staples', id); return soft();
    case 'close': ui.sheet = null; ui.edit = false; return soft();
    // kitchen
    case 'loc': ui.loc = t.dataset.loc; ls.set(K.loc, ui.loc); return soft();
    case 'pstat': updateRow('pantry_items', id, { status: t.dataset.s }); return soft([[`[data-act="pstat"][data-id="${id}"][data-s="${t.dataset.s}"]`, 'jelly']]);
    case 'psend': { const p = findRow('pantry_items', id); if (p) sendToGrocery(p); return soft([[`[data-id="${id}"] ~ .onlist, .it:has([data-id="${id}"]) .onlist`, 'pop']]); }
    case 'psendall': {
      // Load & success, then the card leaves.
      if (t.classList.contains('ld')) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 280);
      setTimeout(() => { outNotListed().forEach(sendToGrocery); soft(); }, still ? 0 : 820);
      return;
    }
    case 'pitem': ui.sheet = { type: 'pitem', id }; return soft();
    case 'ploc': updateRow('pantry_items', id, { location: t.dataset.loc }); ui.sheet = null; return soft();
    case 'pdel': removeRow('pantry_items', id); ui.sheet = null; return soft();
    // chores
    case 'ctab': ui.choreTab = t.dataset.v; ls.set(K.choreTab, ui.choreTab); return soft();
    case 'cwhof': ui.who = t.dataset.v; ls.set(K.who, ui.who); return soft();
    case 'citem': ui.sheet = { type: 'chore', id }; return soft();
    case 'howto': ui.howto = ui.howto === id ? null : id; return soft();
    case 'clater': ui.showLater = !ui.showLater; return soft();
    case 'cdone': case 'cskip': {
      const c = findRow('tasks', id); if (!c) return;
      if (a === 'cdone' && t.classList.contains('cb')) {
        // Check, squish, then the row moves on to its next date.
        t.classList.add('on', 'jelly'); t.innerHTML = ic('check');
        setTimeout(() => { closeChore(c, 'done'); soft(); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
        return;
      }
      closeChore(c, a === 'cdone' ? 'done' : 'skip'); return soft(ui.sheet ? [['.bs .hint', 'pop']] : null);
    }
    case 'cdonehero': {
      const c = findRow('tasks', id); if (!c || t.classList.contains('ld')) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 280);
      setTimeout(() => { closeChore(c, 'done'); soft(); }, still ? 0 : 820);
      return;
    }
    case 'cnew': { const c = newChore(); ui.sheet = { type: 'chore', id: c.id }; render({ soft: true, keepFocus: '.bs .ttl' }); $app.querySelector('.bs .ttl')?.select(); return; }
    case 'cwho': { const v = t.dataset.v; updateRow('tasks', id, { assignee: v === 'me' ? myId() : v === 'partner' ? partnerId() : null }); return soft(); }
    case 'cmode': updateRow('tasks', id, { repeat_mode: t.dataset.v }); return soft();
    case 'cmonth': {
      const c = findRow('tasks', id); if (!c) return;
      const m = +t.dataset.m;
      let ms = c.months && c.months.length ? [...c.months] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      ms = ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m].sort((x, y) => x - y);
      if (!ms.length) return; // at least one month
      updateRow('tasks', id, { months: ms.length === 12 ? null : ms }); return soft();
    }
    case 'cactive': {
      const c = findRow('tasks', id); if (!c) return;
      const on = !c.active;
      updateRow('tasks', id, on && !c.due_date ? { active: on, due_date: S.initialDue(c, todayStr()) } : { active: on }); return soft();
    }
    case 'cdel': if (!confirm('Delete this chore? Its history is kept.')) return; removeRow('tasks', id); ui.sheet = null; return soft();
    // tasks
    case 'tcat': ui.taskCat = t.dataset.v; return soft();
    case 'tnewcat': {
      const n = (prompt('Name the new list') || '').trim().slice(0, 40);
      if (!n) return;
      ls.set(K.lists, [...new Set([...ls.get(K.lists, []), n])]); ui.taskCat = n; return soft();
    }
    case 'tdone': {
      const x = findRow('tasks', id); if (!x) return;
      if (x.done_at) updateRow('tasks', id, { done_at: null });
      else { recordEvent(x, 'done', x.due_date || todayStr()); updateRow('tasks', id, { done_at: new Date().toISOString() }); }
      return soft([[`[data-act="tdone"][data-id="${id}"]`, 'jelly']]);
    }
    case 'titem': ui.sheet = { type: 'task', id }; return soft();
    case 'tflag': { const x = findRow('tasks', id); if (x) updateRow('tasks', id, { priority: !x.priority }); return soft([[`.flag[data-id="${id}"]`, 'jelly']]); }
    case 'tshowdone': ui.showDone = !ui.showDone; return soft();
    case 'tdel': removeRow('tasks', id); ui.sheet = null; return soft();
    case 'resetweek': {
      if (t.classList.contains('ld')) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 320);
      setTimeout(() => { ui.resetCount = resetWeek(); soft(); }, still ? 0 : 900);
      return;
    }
  }
});
let verTaps = 0, verTimer = 0;

$app.addEventListener('change', (e) => {
  if (e.target.id === 'nm') saveName(e.target.value);
  if (e.target.dataset.act === 'costcocsv' && e.target.files[0]) importCostco(e.target.files[0]);
  if (e.target.dataset.act === 'chorescsv' && e.target.files[0]) importChores(e.target.files[0]);
  const f = e.target.dataset.field, fid = e.target.dataset.id;
  if (f && fid) {
    const row = findRow('tasks', fid); if (!row) return;
    let v = e.target.value;
    const patch = {};
    if (f === 'title') { v = v.trim().slice(0, 120); if (!v) return render({ soft: true, keepFocus: '__none' }); patch.title = v; }
    else if (f === 'every') patch.every = Math.max(1, Math.min(365, parseInt(v, 10) || 1));
    else if (f === 'week_of_month' || f === 'weekday') patch[f] = v === '' ? null : +v;
    else if (f === 'due_date') patch.due_date = v || null;
    else if (f === 'unit') { patch.unit = v; if (v === 'day') { patch.weekday = null; patch.week_of_month = null; } if (v === 'week') patch.week_of_month = null; }
    else patch[f] = v.trim() || null;
    if (patch.due_date && row.kind === 'chore') patch.anchor_date = patch.due_date; // fixed monthly schedules keep this day
    updateRow('tasks', fid, patch);
    render({ soft: true, keepFocus: '__none' });
  }
});
function syncAddButton(input) {
  const b = input?.form?.querySelector('.add');
  if (b && (input.form.dataset.form === 'gadd' || input.form.dataset.form === 'tadd')) b.classList.toggle('ready', !!input.value.trim());
}
$app.addEventListener('input', (e) => { if (e.target.classList.contains('fld')) syncAddButton(e.target); });

const RIPPLE = '.pri,.add,.chip,.tag,.plus,.opt,.send,.seg > button,.dock a,.hlo button,.clear,.ghost,.tile,.card,.hero.press,.it .nm,.lnk,.pick,.fchip,.skipb,.more,.flag,.qbtn,.months button';
$app.addEventListener('pointerdown', (e) => {
  const b = e.target.closest(RIPPLE);
  if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const dot = document.createElement('span');
  dot.className = 'rip';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  b.classList.add('rp');
  b.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
}, { passive: true });

$app.addEventListener('keydown', (e) => {
  if ((e.target.id === 'nm' || e.target.classList.contains('ttl') || e.target.classList.contains('txt')) && e.key === 'Enter') e.target.blur();
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; ui.edit = false; render({ soft: true, keepFocus: '__none' }); }
});

addEventListener('hashchange', () => { ui.sheet = null; ui.edit = false; ui.resetCount = null; render(); });
addEventListener('online', () => { state.netFail = false; pull(); rt.wake(); });
addEventListener('offline', updateBadge);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { T.apply(); pull(); rt.wake(); } });
addEventListener('pageshow', (e) => { if (e.persisted) { pull(); rt.wake(); } });
// Auto dim: re-check the clock each minute.
setInterval(() => { const before = document.documentElement.className; T.apply(); if (document.documentElement.className !== before) render({ soft: true }); }, 60000);

/* ---------- live updates from the other phone ---------- */
let rtTimer = 0;
const rt = PREVIEW ? { wake() {}, stop() {} } : startRealtime(TABLES, () => { clearTimeout(rtTimer); rtTimer = setTimeout(pull, 300); });

/* ---------- layout debug readout (tap Version 5 times, or ?debug=1) ---------- */
if (Q.get('debug') === '1') ls.set(K.debug, true);
function debugReadout() {
  let el = document.getElementById('dbg');
  if (!ls.get(K.debug, false)) { el && el.remove(); return; }
  if (!el) { el = document.createElement('pre'); el.id = 'dbg'; document.body.appendChild(el); }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(probe);
  const sab = probe.getBoundingClientRect().height; probe.remove();
  const nav = document.querySelector('.dockwrap');
  el.textContent = `innerHeight ${innerHeight}\nvisualViewport ${Math.round(visualViewport?.height ?? 0)}\nsafe-area bottom ${sab}\nnav bottom ${nav ? Math.round(nav.getBoundingClientRect().bottom) : '-'}\nstandalone ${installed()}\nqueue ${state.queue.length}`;
}
addEventListener('resize', debugReadout);
visualViewport?.addEventListener('resize', debugReadout);

/* ---------- service worker (own scope, own caches only) ---------- */
if ('serviceWorker' in navigator && !PREVIEW) {
  const hadController = !!navigator.serviceWorker.controller; // first install: no reload
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    const go = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    // Never reload under someone's thumb while they type.
    if (document.activeElement?.tagName === 'INPUT') document.addEventListener('visibilitychange', go, { once: true });
    else go();
  });
}

render();
pull();
