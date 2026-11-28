// Weekly routines (preschool, a study group): which days they happen. Pure (tests in tests/routines.test.mjs).
import * as S from './schedule.js';

/**
 * r: { weekdays: [1, 3, 5] (0 = Sunday), starts_on?, ends_on?, breaks: [{ from, to, label }] }
 * Happens on `date` if it's one of its weekdays, inside its season, and not during a break.
 */
export function occursOn(r, date) {
  if (!r || !Array.isArray(r.weekdays) || !r.weekdays.includes(S.weekdayOf(date))) return false;
  if (r.starts_on && date < r.starts_on) return false;
  if (r.ends_on && date > r.ends_on) return false;
  return !breakOn(r, date);
}

/** The break covering `date`, if any. */
export const breakOn = (r, date) => (Array.isArray(r.breaks) ? r.breaks : []).find((b) => b && b.from && b.to && b.from <= date && date <= b.to) || null;

/** The next break that hasn't ended yet, for "On break until Jan 5" / "Next break: Dec 18". */
export function nextBreak(r, today) {
  return (Array.isArray(r.breaks) ? r.breaks : []).filter((b) => b && b.to >= today).sort((a, b) => a.from.localeCompare(b.from))[0] || null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon, Wed, Fri", "Weekdays", "Every day". */
export function daysLabel(weekdays) {
  const w = [...new Set(weekdays || [])].sort((a, b) => a - b);
  if (w.length === 7) return 'Every day';
  if (w.length === 5 && [1, 2, 3, 4, 5].every((d) => w.includes(d))) return 'Weekdays';
  return w.map((d) => DAYS[d]).join(', ') || 'No days yet';
}
