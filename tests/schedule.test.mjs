// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDue, initialDue, resetDue, isOverdue, shownDue, addUnit, repeatLabel, resetsWeekly, dueLabel } from '../js/schedule.js';

const chore = (o) => ({ repeat_mode: 'after', every: 1, unit: 'week', week_of_month: null, weekday: null, months: null, anchor_date: null, due_date: null, ...o });

test('after-done repeats count from the day it was done', () => {
  assert.equal(nextDue(chore({ due_date: '2026-11-27' }), '2026-11-27'), '2026-12-04');
  // done late: still counts from today, not from the old due date
  assert.equal(nextDue(chore({ every: 3, unit: 'day', due_date: '2026-11-20' }), '2026-11-27'), '2026-11-30');
  // done early: same
  assert.equal(nextDue(chore({ due_date: '2026-12-01' }), '2026-11-27'), '2026-12-04');
});

test('fixed schedules stay on the calendar', () => {
  const tue = chore({ repeat_mode: 'fixed', weekday: 2 });
  // done late on Friday: next Tuesday, not three days later
  assert.equal(nextDue({ ...tue, due_date: '2026-11-24' }, '2026-11-27'), '2026-12-01');
  // done early on Monday: the Tuesday after, never twice in one week
  assert.equal(nextDue({ ...tue, due_date: '2026-12-01' }, '2026-11-30'), '2026-12-08');
  // every 2 weeks keeps its rhythm
  assert.equal(nextDue({ ...tue, every: 2, due_date: '2026-11-24' }, '2026-11-27'), '2026-12-08');
  // daily, done a week late: tomorrow, not a backlog
  assert.equal(nextDue(chore({ repeat_mode: 'fixed', unit: 'day', due_date: '2026-11-20' }), '2026-11-27'), '2026-11-28');
});

test('month ends clamp and do not drift', () => {
  assert.equal(addUnit('2027-01-31', 1, 'month'), '2027-02-28');
  assert.equal(addUnit('2028-01-31', 1, 'month'), '2028-02-29'); // leap year
  assert.equal(addUnit('2026-12-15', 1, 'month'), '2027-01-15'); // year rollover
  assert.equal(addUnit('2028-02-29', 1, 'year'), '2029-02-28');
  const m31 = chore({ repeat_mode: 'fixed', unit: 'month', anchor_date: '2027-01-31' });
  const feb = nextDue({ ...m31, due_date: '2027-01-31' }, '2027-01-31');
  assert.equal(feb, '2027-02-28');
  assert.equal(nextDue({ ...m31, due_date: feb }, feb), '2027-03-31'); // back to the 31st, no drift to the 28th
});

test('monthly by week of month', () => {
  const wk4 = chore({ repeat_mode: 'fixed', unit: 'month', week_of_month: 4 });
  assert.equal(nextDue({ ...wk4, due_date: '2026-11-22' }, '2026-11-27'), '2026-12-22');
  assert.equal(initialDue(wk4, '2026-11-27'), '2026-12-22'); // this month's week 4 already started
  assert.equal(initialDue({ ...wk4, week_of_month: 1 }, '2026-11-27'), '2026-12-01');
  // 2nd Tuesday
  const tue2 = chore({ repeat_mode: 'fixed', unit: 'month', week_of_month: 2, weekday: 2 });
  assert.equal(initialDue(tue2, '2026-11-27'), '2026-12-08');
});

test('quarterly and seasonal chores only land in their months', () => {
  const q = chore({ repeat_mode: 'fixed', every: 3, unit: 'month', week_of_month: 1, months: [3, 6, 9, 12] });
  assert.equal(initialDue(q, '2026-11-27'), '2026-12-01');
  assert.equal(nextDue({ ...q, due_date: '2026-12-01' }, '2026-12-01'), '2027-03-01');
  const yearlyJan = chore({ repeat_mode: 'fixed', unit: 'year', months: [1] });
  assert.equal(initialDue(yearlyJan, '2026-11-27'), '2027-01-01');
  const summer = chore({ months: [4, 5, 6, 7, 8, 9, 10] }); // weekly, Apr to Oct
  assert.equal(nextDue({ ...summer, due_date: '2026-10-28' }, '2026-10-28'), '2027-04-01');
});

test('nothing shows overdue out of season', () => {
  const summer = chore({ months: [4, 5, 6, 7, 8, 9, 10], due_date: '2026-10-20' });
  assert.equal(isOverdue(summer, '2026-10-25'), true);
  assert.equal(isOverdue(summer, '2026-11-27'), false);
  assert.equal(shownDue(summer, '2026-11-27'), '2027-04-01');
});

test('a start date sets the first due date', () => {
  assert.equal(initialDue(chore({ start_date: '2026-12-01' }), '2026-11-27'), '2026-12-01');
  assert.equal(initialDue(chore({ repeat_mode: 'once', start_date: null }), '2026-11-27'), null);
});

test('skip moves on exactly like done', () => {
  const c = chore({ every: 2, due_date: '2026-11-25' });
  assert.equal(nextDue(c, '2026-11-27'), '2026-12-11');
});

test('Sunday reset only clears frequent misses', () => {
  const sunday = '2026-11-29';
  const weekly = chore({ due_date: '2026-11-21' });
  assert.equal(resetDue(weekly, sunday), '2026-12-06');
  const every3 = chore({ every: 3, unit: 'day', due_date: '2026-11-26' });
  assert.equal(resetDue(every3, sunday), '2026-12-02');
  const monthly = chore({ repeat_mode: 'fixed', unit: 'month', week_of_month: 4, due_date: '2026-11-22' });
  assert.equal(resetsWeekly(monthly), false);
  assert.equal(resetDue(monthly, sunday), '2026-11-22'); // stays until done
  const notMissed = chore({ due_date: '2026-12-02' });
  assert.equal(resetDue(notMissed, sunday), '2026-12-02');
});

test('both phones pressing reset agree and the second press is a no-op', () => {
  const sunday = '2026-11-29';
  const c = chore({ due_date: '2026-11-21' });
  const phoneA = resetDue(c, sunday), phoneB = resetDue(c, sunday);
  assert.equal(phoneA, phoneB);
  assert.equal(resetDue({ ...c, due_date: phoneA }, sunday), phoneA);
});

test('labels read naturally', () => {
  assert.equal(repeatLabel(chore({})), 'Weekly, after done');
  assert.equal(repeatLabel(chore({ repeat_mode: 'fixed', every: 2, weekday: 2 })), 'Every 2 weeks on Tue');
  assert.equal(repeatLabel(chore({ repeat_mode: 'fixed', unit: 'month', week_of_month: 4 })), 'Monthly, week 4');
  assert.equal(repeatLabel(chore({ repeat_mode: 'fixed', every: 3, unit: 'month', week_of_month: 1, months: [3, 6, 9, 12] })), 'Quarterly, week 1');
  assert.equal(repeatLabel(chore({ repeat_mode: 'fixed', months: [4, 5, 6, 7, 8, 9, 10] })), 'Weekly · Apr to Oct');
  assert.equal(repeatLabel(chore({ repeat_mode: 'fixed', unit: 'year', months: [1] })), 'Yearly in Jan');
  assert.equal(dueLabel('2026-11-26', '2026-11-27'), 'Yesterday');
  assert.equal(dueLabel('2026-11-24', '2026-11-27'), 'Was due Tue');
  assert.equal(dueLabel('2027-01-04', '2026-11-27'), 'Jan 4, 2027');
});
