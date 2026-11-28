import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStatus, postCallOn } from '../js/day.js';

const tz = 'America/New_York';
const shift = (type, from, to, o = {}) => ({ kind: 'shift', shift_type: type, all_day: false, starts_at: from, ends_at: to, start_date: from.slice(0, 10), end_date: to.slice(0, 10), site: 'Main ED', ...o });
const allDayCall = (date) => ({ kind: 'shift', shift_type: 'on_call', all_day: true, start_date: date, end_date: date, starts_at: null, ends_at: null });
// 7 PM to 7 AM Eastern, Nov 27 -> 28 (EST = UTC-5)
const night = shift('working', '2026-11-28T00:00:00.000Z', '2026-11-28T12:00:00.000Z', { start_date: '2026-11-27', end_date: '2026-11-28' });

test('a day shift is Working with hours and site', () => {
  const s = dayStatus('2026-11-27', [shift('working', '2026-11-27T12:00:00.000Z', '2026-11-28T00:00:00.000Z', { start_date: '2026-11-27', end_date: '2026-11-27' })], [], { tz });
  assert.equal(s.type, 'working');
  assert.equal(s.hours, '7a–7p');
  assert.equal(s.site, 'Main ED');
});

test('a night shift makes the next day Post call for 10 hours', () => {
  const s = dayStatus('2026-11-28', [night], [], { tz });
  assert.equal(s.type, 'post_call');
  assert.equal(s.postCall.until, '2026-11-28T22:00:00.000Z'); // 7 AM + 10 h = 5 PM
  assert.equal(s.hours, 'until 5 PM');
  assert.equal(dayStatus('2026-11-28', [night], [], { tz, postCallHours: 8 }).hours, 'until 3 PM');
});

test('on call alone never makes Post call; an overnight activation does', () => {
  const rows = [allDayCall('2026-11-28'), allDayCall('2026-11-29')];
  assert.equal(dayStatus('2026-11-28', rows, [], { tz }).type, 'on_call');
  assert.equal(postCallOn('2026-11-29', rows, [], { tz }), null);
  // called in Sat 11 PM, home Sun 6 AM
  const act = [{ date: '2026-11-28', activated_from: '2026-11-29T04:00:00.000Z', activated_to: '2026-11-29T11:00:00.000Z' }];
  const sat = dayStatus('2026-11-28', rows, act, { tz });
  assert.equal(sat.type, 'activated');
  assert.equal(sat.hours, '11p–6a');
  const sun = dayStatus('2026-11-29', rows, act, { tz });
  assert.equal(sun.type, 'on_call'); // still on call Sunday...
  assert.equal(sun.postCall.until, '2026-11-29T21:00:00.000Z'); // ...and post call until 4 PM
  // an activation that ends the same evening is not overnight
  const day = [{ date: '2026-11-28', activated_from: '2026-11-28T15:00:00.000Z', activated_to: '2026-11-28T20:00:00.000Z' }];
  assert.equal(postCallOn('2026-11-29', rows, day, { tz }), null);
});

test('No shift only when later shifts are posted; never off a failed sync', () => {
  const rows = [night, allDayCall('2026-12-05')];
  assert.equal(dayStatus('2026-12-01', rows, [], { tz }).type, 'no_shift');
  assert.equal(dayStatus('2026-12-09', rows, [], { tz }).type, 'not_posted');
  assert.equal(dayStatus('2026-12-01', rows, [], { tz, syncOk: false }).type, 'unknown');
});
