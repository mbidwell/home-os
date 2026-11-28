// Fitting chores around a work schedule. Pure functions (tests in tests/fit.test.mjs).
import * as S from './schedule.js';

// Chores that take real time. Anything else counts as quick unless someone sets it.
const BIG = /\b(clean|deep|scrub|mop|vacuum|gutters?|garage|bathrooms?|basement|attic|windows?|baseboards?|oven|organi[sz]e|closets?|carpets?|pressure|power wash|mow|yard|lawn|rake|leaves|weed|mulch|paint|wash (?:the )?cars?|detail|declutter|shampoo|grout|blinds|ceiling fans?|bedding|sheets|laundry)\b/i;
export const guessSize = (title) => (BIG.test(String(title || '')) ? 'big' : 'quick');
export const sizeOf = (c) => c.effort || guessSize(c.title);

/** How far a chore can move: a few days for weekly ones, a week for monthly, two weeks for anything longer. */
export function slackFor(c) {
  const n = S.intervalDays(c);
  return n <= 7 ? 2 : n <= 31 ? 7 : 14;
}

/**
 * A better day for a chore due on a busy day: the nearest free day (or, failing that, a light one)
 * from a few days before the due date to `slack` days after, never before today.
 * loadOf(date) -> 'busy' | 'light' | 'free' | 'unknown'. Returns a date or null.
 */
export function betterDay(due, today, slack, loadOf) {
  if (due < today || loadOf(due) !== 'busy') return null;
  const from = S.addDays(due, -3) > today ? S.addDays(due, -3) : today, to = S.addDays(due, slack);
  let best = null, bestScore = Infinity;
  for (let d = from; d <= to; d = S.addDays(d, 1)) {
    const l = loadOf(d);
    if (l !== 'free' && l !== 'light') continue;
    // Free beats light; then closest to the due date; ties go to the earlier day.
    const score = (l === 'free' ? 0 : 100) + Math.abs(S.diffDays(due, d)) * 2 + (d > due ? 1 : 0);
    if (score < bestScore) { best = d; bestScore = score; }
  }
  return best;
}
