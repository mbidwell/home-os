// What a day looks like from the calendar: Working / Activated / On call / Post call / No shift /
// Schedule not posted. Pure functions (tests in tests/day.test.mjs).
//
// rows:        calendar_events (kind 'shift' with shift_type 'working' | 'on_call'), removed rows already dropped
// activations: day_overrides with activated_from / activated_to (ISO times), keyed by their local date
// opts:        { postCallHours = 10, syncOk = true, tz }  syncOk false -> never claim "No shift"

const H = 3600000;

export function localDateOf(ts, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date(ts));
}
export function localHourOf(ts, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ts));
  const g = (t) => +p.find((x) => x.type === t).value;
  return (g('hour') % 24) + g('minute') / 60;
}

/** "7a–7p" (short) or "7 AM – 7 PM" (long). */
export function hoursLabel(fromIso, toIso, tz, long = false) {
  const one = (iso) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
    const h = p.find((x) => x.type === 'hour').value, m = p.find((x) => x.type === 'minute').value, ap = p.find((x) => x.type === 'dayPeriod').value;
    const mm = m === '00' ? '' : `:${m}`;
    return long ? `${h}${mm} ${ap.toUpperCase()}` : `${h}${mm}${ap[0].toLowerCase()}`;
  };
  if (!toIso) return long ? `from ${one(fromIso)}` : `${one(fromIso)}–`;
  return long ? `${one(fromIso)} – ${one(toIso)}` : `${one(fromIso)}–${one(toIso)}`;
}

const shiftsOn = (rows, date) => rows.filter((r) => r.kind === 'shift' && (r.all_day ? r.start_date <= date && date <= (r.end_date || r.start_date) : r.start_date === date));

/** Overnight: ends on a later calendar day than it started (a 7p-7a, a 10p-6a). */
export const isOvernight = (fromIso, toIso, tz) => !!toIso && localDateOf(Date.parse(toIso), tz) > localDateOf(Date.parse(fromIso), tz);

/** Post call windows that cover any part of `date`: 10 hours after an overnight shift or activation ends. */
export function postCallOn(date, rows, activations, { postCallHours = 10, tz }) {
  const spans = [];
  for (const r of rows) if (r.kind === 'shift' && r.shift_type === 'working' && !r.all_day && isOvernight(r.starts_at, r.ends_at, tz)) spans.push(Date.parse(r.ends_at));
  for (const a of activations) if (a.activated_from && a.activated_to && isOvernight(a.activated_from, a.activated_to, tz)) spans.push(Date.parse(a.activated_to));
  const hits = spans.filter((end) => localDateOf(end, tz) === date || localDateOf(end + postCallHours * H, tz) === date)
    .map((end) => ({ from: new Date(end).toISOString(), until: new Date(end + postCallHours * H).toISOString() }));
  return hits.sort((a, b) => b.until.localeCompare(a.until))[0] || null;
}

/**
 * The day's status.
 * -> { type, label, hours, site, postCall, onCall, activation }
 */
export function dayStatus(date, rows, activations = [], opts = {}) {
  const tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shifts = shiftsOn(rows, date);
  const working = shifts.filter((s) => s.shift_type === 'working').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const onCall = shifts.find((s) => s.shift_type === 'on_call') || null;
  const act = activations.find((a) => a.date === date && a.activated_from) || null;
  const postCall = postCallOn(date, rows, activations, { ...opts, tz });
  const base = { postCall, onCall, activation: act, site: null, hours: null };
  if (working.length) {
    const w = working[0];
    return { ...base, type: 'working', label: 'Working', site: w.site || w.title || null, hours: hoursLabel(w.starts_at, w.ends_at, tz), hoursLong: hoursLabel(w.starts_at, w.ends_at, tz, true), shift: w };
  }
  if (act) return { ...base, type: 'activated', label: 'Activated', hours: hoursLabel(act.activated_from, act.activated_to, tz), hoursLong: hoursLabel(act.activated_from, act.activated_to, tz, true) };
  if (onCall) return { ...base, type: 'on_call', label: 'On call' };
  if (postCall) return { ...base, type: 'post_call', label: 'Post call', hours: `until ${hoursLabel(postCall.until, null, tz, true).replace('from ', '')}` };
  if (opts.syncOk === false) return { ...base, type: 'unknown', label: 'Shift unknown' };
  const lastShift = rows.filter((r) => r.kind === 'shift').reduce((m, r) => ((r.end_date || r.start_date) > m ? (r.end_date || r.start_date) : m), '');
  if (lastShift && lastShift >= date) return { ...base, type: 'no_shift', label: 'No shift' };
  return { ...base, type: 'not_posted', label: 'Schedule not posted' };
}
