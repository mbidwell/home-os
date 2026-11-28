// Run: node --test tests/routines.test.mjs   (sample data is made up)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occursOn, breakOn, nextBreak, daysLabel } from '../js/routines.js';

const school = { weekdays: [1, 3, 5] };
const study = { weekdays: [3], breaks: [{ from: '2026-12-14', to: '2027-01-08', label: 'Holidays' }, { from: '2027-05-24', to: '2027-08-27', label: 'Summer' }] };

test('weekly days', () => {
  assert.ok(occursOn(school, '2026-11-30')); // Mon
  assert.ok(!occursOn(school, '2026-12-01')); // Tue
  assert.ok(occursOn(school, '2026-12-04')); // Fri
});

test('breaks pause it, inclusive of both ends', () => {
  assert.ok(occursOn(study, '2026-12-09'));
  assert.ok(!occursOn(study, '2026-12-16'));
  assert.ok(!occursOn(study, '2027-01-06'));
  assert.ok(occursOn(study, '2027-01-13'));
  assert.equal(breakOn(study, '2026-12-16').label, 'Holidays');
  assert.equal(nextBreak(study, '2026-12-01').label, 'Holidays');
  assert.equal(nextBreak(study, '2027-02-01').label, 'Summer');
});

test('season start and end', () => {
  assert.ok(!occursOn({ weekdays: [1], starts_on: '2026-12-07' }, '2026-11-30'));
  assert.ok(!occursOn({ weekdays: [1], ends_on: '2026-11-29' }, '2026-11-30'));
});

test('day labels', () => {
  assert.equal(daysLabel([5, 1, 3]), 'Mon, Wed, Fri');
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(daysLabel([]), 'No days yet');
});
