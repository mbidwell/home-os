// Chore repeat rules. Pure functions on local calendar dates ('YYYY-MM-DD'), no clocks inside,
// so they are easy to test (tests/schedule.test.mjs).
//
// A chore has:
//   repeat_mode   'after' (count from when it was last done, the default) | 'fixed' (calendar schedule) | 'once'
//   every, unit   e.g. 3 + 'day', 2 + 'week', 1 + 'month', 1 + 'year'
//   week_of_month 1-4 (monthly/yearly): week 1 starts on the 1st, week 2 on the 8th, and so on;
//                 with a weekday it means "the Nth Tuesday"
//   weekday       0-6 (Sun-Sat), for weekly ones like "every Tuesday"
//   months        [1..12] the chore is active in, or null for all year (seasonal chores)
//   anchor_date   the first due date; fixed monthly schedules keep its day of the month (no drift after Feb)
//   due_date      the one open instance

const MS_DAY = 86400000;

export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const fmt = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => fmt(parse(s) + n * MS_DAY);
export const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / MS_DAY);
export const weekdayOf = (s) => new Date(parse(s)).getUTCDay();
const ymd = (s) => s.split('-').map(Number);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const pad = (n) => String(n).padStart(2, '0');
const make = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;
const monthShift = (y, m, n) => { const i = y * 12 + (m - 1) + n; return [Math.floor(i / 12), (i % 12) + 1]; };

/** Today as a local calendar date. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Add months or years, clamping to the end of a shorter month (Jan 31 + 1 month = Feb 28/29). */
export function addUnit(s, every, unit) {
  const n = Math.max(1, every || 1);
  if (unit === 'day') return addDays(s, n);
  if (unit === 'week') return addDays(s, 7 * n);
  const [y, m, d] = ymd(s);
  const [y2, m2] = monthShift(y, m, unit === 'year' ? 12 * n : n);
  return make(y2, m2, d);
}

export const inSeason = (c, s) => !c.months || !c.months.length || c.months.includes(ymd(s)[1]);

/** Approximate days between repeats (for sorting and for Sunday reset). */
export function intervalDays(c) {
  const n = Math.max(1, c.every || 1);
  return { day: 1, week: 7, month: 30, year: 365 }[c.unit] * n;
}

/** Sunday reset clears chores that repeat more often than monthly. */
export const resetsWeekly = (c) => c.repeat_mode !== 'once' && intervalDays(c) < 28;

// The due day inside a given month for monthly/yearly fixed schedules.
function dayInMonth(c, y, m) {
  if (c.week_of_month) {
    const first = 1 + (c.week_of_month - 1) * 7;
    if (c.weekday == null) return make(y, m, first);
    const shift = (c.weekday - weekdayOf(make(y, m, first)) + 7) % 7;
    return make(y, m, first + shift);
  }
  const anchorDay = c.anchor_date ? ymd(c.anchor_date)[2] : 1;
  return make(y, m, anchorDay);
}

// First date on or after s that the chore could be due in an active month.
function firstInSeasonFrom(c, s) {
  if (inSeason(c, s)) return s;
  let [y, m] = ymd(s);
  for (let i = 0; i < 12; i++) {
    [y, m] = monthShift(y, m, 1);
    if (c.months.includes(m)) {
      if (c.unit === 'month' || c.unit === 'year') return dayInMonth(c, y, m);
      const start = make(y, m, 1);
      if (c.weekday != null) return addDays(start, (c.weekday - weekdayOf(start) + 7) % 7);
      return start;
    }
  }
  return s; // no active months listed: treat as all year
}

/** Next fixed-schedule slot strictly after `after`, stepping from a known slot `from`. */
function nextFixedAfter(c, from, after) {
  const monthly = c.unit === 'month' || c.unit === 'year';
  const step = (cur) => {
    if (!monthly) return addUnit(cur, c.every, c.unit);
    const [y, m] = ymd(cur);
    const [y2, m2] = monthShift(y, m, (c.unit === 'year' ? 12 : 1) * Math.max(1, c.every || 1));
    return dayInMonth(c, y2, m2);
  };
  let cur = from;
  for (let i = 0; i < 5000; i++) {
    if (cur > after) return inSeason(c, cur) ? cur : firstInSeasonFrom(c, cur);
    cur = step(cur);
  }
  return cur;
}

/** First due date for a new chore. A start date wins; otherwise the first slot on or after today. */
export function initialDue(c, today) {
  if (c.repeat_mode === 'once') return c.start_date || null;
  if (c.start_date) return firstInSeasonFrom(c, c.start_date);
  let s = today;
  if (c.repeat_mode === 'fixed') {
    if (c.unit === 'week' && c.weekday != null) s = addDays(today, (c.weekday - weekdayOf(today) + 7) % 7);
    if (c.unit === 'month' || c.unit === 'year') {
      const [y, m] = ymd(today);
      s = dayInMonth(c, y, m);
      if (s < today) { const [y2, m2] = monthShift(y, m, 1); s = dayInMonth(c, y2, m2); }
    }
  }
  return firstInSeasonFrom(c, s);
}

/**
 * Next due date after the open instance is done or skipped on `today`.
 * After-mode counts from today. Fixed-mode moves to the next slot after both the old due date and today,
 * so a late completion never leaves it instantly overdue again, and an early one doesn't double up.
 */
export function nextDue(c, today) {
  if (c.repeat_mode === 'once') return null;
  if (c.repeat_mode === 'fixed') {
    const after = c.due_date && c.due_date > today ? c.due_date : today;
    return nextFixedAfter(c, c.due_date || today, after);
  }
  return firstInSeasonFrom(c, addUnit(today, c.every, c.unit));
}

/** Sunday reset: the due date a missed, frequent chore starts fresh at. Same answer on both phones. */
export function resetDue(c, today) {
  if (!resetsWeekly(c) || !c.due_date || c.due_date >= today) return c.due_date; // nothing to reset
  return nextDue(c, today);
}

/** Is the open instance overdue? Never out of season. */
export const isOverdue = (c, today) => !!c.due_date && c.due_date < today && inSeason(c, today);

/**
 * The date to show and sort by. An overdue chore whose season ended shows its next season instead.
 */
export function shownDue(c, today) {
  if (!c.due_date) return null;
  if (c.due_date < today && !inSeason(c, today)) return firstInSeasonFrom(c, today);
  return c.due_date;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = MON;
export const WEEKDAYS = DAY;

/** "Every 2 weeks on Tue", "Monthly, week 4", "Quarterly", "Weekly · Apr to Oct". */
export function repeatLabel(c) {
  if (c.repeat_mode === 'once') return 'One time';
  const n = Math.max(1, c.every || 1);
  let s;
  if (c.unit === 'day') s = n === 1 ? 'Daily' : `Every ${n} days`;
  else if (c.unit === 'week') s = (n === 1 ? 'Weekly' : `Every ${n} weeks`) + (c.weekday != null ? ` on ${DAY[c.weekday]}` : '');
  else if (c.unit === 'month') s = n === 1 ? 'Monthly' : n === 3 ? 'Quarterly' : n === 6 ? 'Every 6 months' : `Every ${n} months`;
  else s = n === 1 ? 'Yearly' : `Every ${n} years`;
  if ((c.unit === 'month' || c.unit === 'year') && c.week_of_month) {
    s += c.weekday != null ? `, ${['1st', '2nd', '3rd', '4th'][c.week_of_month - 1]} ${DAY[c.weekday]}` : `, week ${c.week_of_month}`;
  }
  if (c.months && c.months.length && c.months.length < 12) {
    const ms = [...c.months].sort((a, b) => a - b);
    const run = ms.every((m, i) => i === 0 || m === ms[i - 1] + 1);
    const span = run && ms.length > 2 ? `${MON[ms[0] - 1]} to ${MON[ms[ms.length - 1] - 1]}` : ms.map((m) => MON[m - 1]).join(', ');
    if (!(c.unit === 'month' && n === 3 && ms.length === 4) && !(c.unit === 'year' && ms.length === 1)) s += ` · ${span}`;
    else if (c.unit === 'year' && ms.length === 1) s += ` in ${MON[ms[0] - 1]}`;
  }
  if (c.repeat_mode === 'after' && c.unit !== 'year') s += ', after done';
  return s;
}

/** "Today", "Tomorrow", "Yesterday", "Tue", "Was due Sat", "Dec 3", "Apr 2027". */
export function dueLabel(due, today) {
  if (!due) return '';
  const d = diffDays(due, today);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  const [y, m, day] = ymd(due);
  if (d < 0 && d > -7) return `Was due ${DAY[weekdayOf(due)]}`;
  if (d > 0 && d < 7) return DAY[weekdayOf(due)];
  const ty = ymd(today)[0];
  return y === ty ? `${MON[m - 1]} ${day}` : `${MON[m - 1]} ${day}, ${y}`;
}
