// Calendar feed rules, shared by the calendar-sync Edge Function (Deno) and the tests (Node).
// Pure JavaScript, no runtime APIs. Nothing here stores descriptions, attendees, locations, or links:
// the description is only read to spot QGenda entries, then dropped.

export const DEFAULT_TZ = 'America/New_York';

/* ---------- ICS text ---------- */
export function unfold(text) { return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }

function unescapeText(v) { return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }

function parseLine(line) {
  // NAME;PARAM=V;PARAM="V":VALUE  (colon inside quotes belongs to the param)
  let i = 0, inQ = false;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if (c === ':' && !inQ) break; }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params = {};
  for (const p of ps) { const k = p.indexOf('='); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params, value };
}

/** VEVENTs as { NAME: [{params, value}] } maps. */
export function parseEvents(text) {
  const out = []; let cur = null, depth = 0;
  for (const raw of unfold(text).split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith('BEGIN:')) { depth++; continue; } // VALARM etc.
    if (line.startsWith('END:') && depth > 0) { depth--; continue; }
    if (line === 'END:VEVENT') { out.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const p = parseLine(line);
    (cur[p.name] ||= []).push({ params: p.params, value: p.value });
  }
  return out;
}

const first = (ev, k) => (ev[k] && ev[k][0]) || null;
const text = (ev, k) => { const f = first(ev, k); return f ? unescapeText(f.value) : ''; };

/* ---------- time zones ---------- */
const WINDOWS_TZ = {
  'eastern standard time': 'America/New_York', 'us eastern standard time': 'America/Indiana/Indianapolis',
  'central standard time': 'America/Chicago', 'mountain standard time': 'America/Denver',
  'us mountain standard time': 'America/Phoenix', 'pacific standard time': 'America/Los_Angeles',
  'alaskan standard time': 'America/Anchorage', 'hawaiian standard time': 'Pacific/Honolulu',
  'utc': 'UTC', 'gmt standard time': 'Europe/London', 'coordinated universal time': 'UTC'
};
export function normalizeTz(tz) {
  if (!tz) return DEFAULT_TZ;
  const t = tz.replace(/^\/+/, '');
  if (WINDOWS_TZ[t.toLowerCase()]) return WINDOWS_TZ[t.toLowerCase()];
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t; } catch { return DEFAULT_TZ; }
}

const dtfCache = new Map();
function partsIn(ts, tz) {
  let f = dtfCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); dtfCache.set(tz, f); }
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = +p.value;
  return o;
}
const offsetAt = (ts, tz) => { const p = partsIn(ts, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ts; };

/** Wall-clock time in a zone -> UTC milliseconds (DST-safe). */
export function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - offsetAt(guess, tz);
  const o2 = offsetAt(ts, tz);
  if (guess - o2 !== ts) ts = guess - o2;
  return ts;
}

/** Local calendar date ('YYYY-MM-DD') of a UTC instant in a zone. */
export function localDate(ts, tz = DEFAULT_TZ) { const p = partsIn(ts, tz); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
export function localHour(ts, tz = DEFAULT_TZ) { const p = partsIn(ts, tz); return p.hour % 24 + p.minute / 60; }

/* ---------- DTSTART / DTEND ---------- */
// -> { allDay, y, m, d, h, mi, s, tz, utc } (utc only for timed values)
export function parseDateValue(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || prop.params.VALUE === 'DATE') return { allDay: true, y: +y, m: +mo, d: +d };
  const tz = z ? 'UTC' : normalizeTz(prop.params.TZID);
  const r = { allDay: false, y: +y, m: +mo, d: +d, h: +h, mi: +mi, s: +(s || 0), tz };
  r.utc = zonedToUtc(r.y, r.m, r.d, r.h, r.mi, r.s, tz);
  return r;
}

const ymdStr = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const fromDayNum = (n) => { const t = new Date(n * 86400000); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(s) {
  const r = {};
  for (const part of s.split(';')) { const [k, v] = part.split('='); if (k) r[k.toUpperCase()] = v; }
  return r;
}

/**
 * Local start dates [y, m, d] of a recurring event, from DTSTART up to `toDay` (a day number).
 * Supports FREQ DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (incl. 2TU / -1FR),
 * BYMONTHDAY, BYMONTH. That covers Google and Outlook feeds in practice.
 */
export function expandRule(rule, start, toDay) {
  const r = parseRule(rule);
  const freq = r.FREQ, interval = Math.max(1, +(r.INTERVAL || 1));
  const count = r.COUNT ? +r.COUNT : Infinity;
  let untilDay = Infinity;
  if (r.UNTIL) {
    const u = parseDateValue({ value: r.UNTIL, params: {} });
    if (u) untilDay = u.allDay ? dayNum(u.y, u.m, u.d) : dayNum(...localDate(u.utc, start.tz || DEFAULT_TZ).split('-').map(Number));
  }
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => { const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(x); return mm ? { n: mm[1] ? +mm[1] : 0, wd: WD[mm[2]] } : null; }).filter(Boolean) : null;
  const bymd = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = r.BYMONTH ? r.BYMONTH.split(',').map(Number) : null;
  const s0 = dayNum(start.y, start.m, start.d);
  const last = Math.min(toDay, untilDay);
  const out = []; let n = 0;
  const push = (dn) => { if (dn < s0 || dn > last || n >= count) return false; n++; out.push(fromDayNum(dn)); return true; };
  const inMonthDays = (y, m) => {
    let days = [];
    if (byday) {
      for (const b of byday) {
        const all = [];
        for (let d = 1; d <= daysIn(y, m); d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) all.push(d);
        if (!b.n) days.push(...all); else { const pick = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (pick) days.push(pick); }
      }
    } else if (bymd) {
      for (const x of bymd) { const d = x > 0 ? x : daysIn(y, m) + 1 + x; if (d >= 1 && d <= daysIn(y, m)) days.push(d); }
    } else if (start.d <= daysIn(y, m)) days.push(start.d);
    return [...new Set(days)].sort((a, b) => a - b);
  };
  let guard = 0;
  if (freq === 'DAILY') {
    for (let dn = s0; dn <= last && n < count && guard++ < 5000; dn += interval) {
      const [y, m] = fromDayNum(dn);
      if (bymonth && !bymonth.includes(m)) continue;
      if (byday && !byday.some((b) => b.wd === new Date(dn * 86400000).getUTCDay())) continue;
      push(dn);
    }
  } else if (freq === 'WEEKLY') {
    const days = byday ? byday.map((b) => b.wd) : [new Date(s0 * 86400000).getUTCDay()];
    const weekStart = s0 - ((new Date(s0 * 86400000).getUTCDay() + 6) % 7); // Monday of DTSTART's week
    for (let w = weekStart; w <= last && n < count && guard++ < 3000; w += 7 * interval) {
      for (const wd of [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) push(w + ((wd + 6) % 7));
    }
  } else if (freq === 'MONTHLY') {
    let y = start.y, m = start.m;
    while (dayNum(y, m, 1) <= last && n < count && guard++ < 1200) {
      for (const d of inMonthDays(y, m)) push(dayNum(y, m, d));
      m += interval; while (m > 12) { m -= 12; y++; }
    }
  } else if (freq === 'YEARLY') {
    let y = start.y;
    while (dayNum(y, 1, 1) <= last && n < count && guard++ < 200) {
      const months = bymonth || [start.m];
      for (const m of months) {
        if (byday || bymd) { for (const d of inMonthDays(y, m)) push(dayNum(y, m, d)); }
        else if (start.d <= daysIn(y, m)) push(dayNum(y, m, start.d));
      }
      y += interval;
    }
  } else {
    push(s0);
  }
  return out;
}

/* ---------- filtering + classification ---------- */
const SKIP_TITLE = /^(canceled|cancelled|following)\s*:/i;

/**
 * Turn one feed into stored rows. Never keeps descriptions, attendees, locations, or links.
 * source: 'google' | 'outlook'. Window: [fromDate, toDate] as 'YYYY-MM-DD'.
 */
export function feedToRows(icsText, source, fromDate, toDate) {
  const evs = parseEvents(icsText);
  const fromDay = dayNum(...fromDate.split('-').map(Number)), toDay = dayNum(...toDate.split('-').map(Number));
  // Edited single instances of a recurring event: UID + RECURRENCE-ID replace the generated one.
  const overrides = new Map();
  for (const ev of evs) {
    const rid = first(ev, 'RECURRENCE-ID');
    if (rid) { const v = parseDateValue(rid); if (v) overrides.set(`${text(ev, 'UID')}|${ymdStr(v.y, v.m, v.d)}`, ev); }
  }
  const rows = [];
  for (const ev of evs) {
    const st = parseDateValue(first(ev, 'DTSTART'));
    if (!st) continue;
    const uid = text(ev, 'UID') || `${text(ev, 'SUMMARY')}|${first(ev, 'DTSTART').value}`;
    const ridV = first(ev, 'RECURRENCE-ID') ? parseDateValue(first(ev, 'RECURRENCE-ID')) : null;
    const isOverride = !!ridV;
    const en = parseDateValue(first(ev, 'DTEND'));
    const durMs = st.allDay ? null : (en && !en.allDay ? en.utc - st.utc : 0);
    const durDays = st.allDay ? Math.max(1, en && en.allDay ? dayNum(en.y, en.m, en.d) - dayNum(st.y, st.m, st.d) : 1) : null; // end == start: that one day
    let starts = [[st.y, st.m, st.d]];
    const rule = first(ev, 'RRULE');
    if (rule && !isOverride) {
      starts = expandRule(rule.value, st, toDay);
      const ex = new Set((ev.EXDATE || []).flatMap((p) => p.value.split(',').map((v) => { const x = parseDateValue({ value: v, params: p.params }); return x ? ymdStr(x.y, x.m, x.d) : ''; })));
      starts = starts.filter(([y, m, d]) => !ex.has(ymdStr(y, m, d)) && !overrides.has(`${uid}|${ymdStr(y, m, d)}`));
    }
    for (const [y, m, d] of starts) {
      const dn = dayNum(y, m, d);
      const lastDn = st.allDay ? dn + durDays - 1 : dn + 1;
      if (lastDn < fromDay || dn > toDay) continue;
      const row = classify(ev, source);
      if (!row) continue;
      row.uid = `${source}:${uid}${rule && !isOverride ? `:${ymdStr(y, m, d)}` : isOverride ? `:${ymdStr(ridV.y, ridV.m, ridV.d)}` : ''}`; // an edited instance keeps its series slot
      row.all_day = st.allDay;
      if (st.allDay) {
        row.start_date = ymdStr(y, m, d);
        row.end_date = ymdStr(...fromDayNum(dn + durDays - 1)); // inclusive
        row.starts_at = row.ends_at = null;
      } else {
        const s = zonedToUtc(y, m, d, st.h, st.mi, st.s, st.tz);
        row.starts_at = new Date(s).toISOString();
        row.ends_at = new Date(s + Math.max(0, durMs)).toISOString();
        row.start_date = localDate(s); row.end_date = localDate(s + Math.max(0, durMs - 1));
      }
      if (row.kind === 'shift' && row.shift_type === 'working' && st.allDay) row.shift_type = null; // only timed entries are Working
      if (row.kind === 'shift' && !row.shift_type) { row.kind = 'event'; }
      rows.push(row);
    }
  }
  return rows;
}

/** One event -> { kind, title, shift_type, site } or null to skip. */
export function classify(ev, source) {
  const title = text(ev, 'SUMMARY').trim();
  const status = text(ev, 'STATUS').toUpperCase();
  const transp = text(ev, 'TRANSP').toUpperCase();
  const cls = text(ev, 'CLASS').toUpperCase();
  const busy = text(ev, 'X-MICROSOFT-CDO-BUSYSTATUS').toUpperCase();
  if (status === 'CANCELLED') return null;
  if (transp === 'TRANSPARENT' || busy === 'FREE') return null; // marked free
  if (cls === 'PRIVATE' || cls === 'CONFIDENTIAL') return null;
  if (SKIP_TITLE.test(title)) return null;
  if (source === 'outlook') return { kind: 'meeting', title: null, shift_type: null, site: null };
  if (/autosync from qgenda/i.test(text(ev, 'DESCRIPTION'))) {
    if (/\boff\b/i.test(title)) return null;                    // "Off" as a word: not a shift
    if (/call/i.test(title)) return { kind: 'shift', title, shift_type: 'on_call', site: null }; // never "Working"
    return { kind: 'shift', title, shift_type: 'working', site: title };
  }
  if (/event physician/i.test(title)) {
    const name = title.replace(/^[^A-Za-z0-9]*event physician\s*[—–-]*\s*/i, '').trim() || title;
    return { kind: 'event_shift', title: name, shift_type: null, site: null };
  }
  return { kind: 'event', title: title || 'Busy', shift_type: null, site: null };
}
