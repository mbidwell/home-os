// Run: node --test tests/calendar.test.mjs tests/day.test.mjs
// Sample feeds are made up. No real calendar data in this repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedToRows, zonedToUtc } from '../supabase/functions/calendar-sync/calendar.js';

const cal = (...evs) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...evs.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const QG = 'DESCRIPTION:Shift details\\n\\nAutoSync from QGenda';
const rows = (ics, src = 'google', from = '2026-11-01', to = '2026-12-31') => feedToRows(ics, src, from, to);

test('QGenda: call is On call, timed is Working, Off is not a shift', () => {
  const r = rows(cal(
    ['UID:a', 'SUMMARY:Call Activation', 'DTSTART;TZID=America/New_York:20261128T070000', 'DTEND;TZID=America/New_York:20261129T070000', QG],
    ['UID:b', 'SUMMARY:Main ED', 'DTSTART;TZID=America/New_York:20261127T070000', 'DTEND;TZID=America/New_York:20261127T190000', QG],
    ['UID:c', 'SUMMARY:Off', 'DTSTART;VALUE=DATE:20261130', 'DTEND;VALUE=DATE:20261130', QG],
    ['UID:d', 'SUMMARY:Home call', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261201', QG]
  ));
  const by = Object.fromEntries(r.map((x) => [x.uid, x]));
  assert.equal(by['google:a'].shift_type, 'on_call');
  assert.equal(by['google:b'].shift_type, 'working');
  assert.equal(by['google:b'].site, 'Main ED');
  assert.equal(by['google:c'], undefined);
  assert.equal(by['google:d'].shift_type, 'on_call');
  // QGenda all-day with end == start is that one day
  assert.equal(by['google:d'].start_date, '2026-12-01');
  assert.equal(by['google:d'].end_date, '2026-12-01');
});

test('descriptions are read, never stored', () => {
  const [x] = rows(cal(['UID:b', 'SUMMARY:Main ED', 'DTSTART:20261127T120000Z', 'DTEND:20261128T000000Z', QG, 'LOCATION:Somewhere']));
  assert.equal(JSON.stringify(x).includes('QGenda'), false);
  assert.equal(JSON.stringify(x).includes('Somewhere'), false);
});

test('skips canceled, free, private, and Canceled:/Following: titles', () => {
  const r = rows(cal(
    ['UID:1', 'SUMMARY:Dinner', 'STATUS:CANCELLED', 'DTSTART:20261127T230000Z', 'DTEND:20261128T000000Z'],
    ['UID:2', 'SUMMARY:Hold', 'TRANSP:TRANSPARENT', 'DTSTART:20261127T230000Z', 'DTEND:20261128T000000Z'],
    ['UID:3', 'SUMMARY:Secret', 'CLASS:PRIVATE', 'DTSTART:20261127T230000Z', 'DTEND:20261128T000000Z'],
    ['UID:4', 'SUMMARY:Canceled: Sync', 'DTSTART:20261127T230000Z', 'DTEND:20261128T000000Z'],
    ['UID:5', 'SUMMARY:Following: Sync', 'DTSTART:20261127T230000Z', 'DTEND:20261128T000000Z'],
    ['UID:6', 'SUMMARY:Pediatrician', 'DTSTART:20261127T213000Z', 'DTEND:20261127T223000Z']
  ));
  assert.deepEqual(r.map((x) => x.title), ['Pediatrician']);
});

test('Outlook shows Work meeting and time only', () => {
  const [x] = rows(cal(['UID:o1', 'SUMMARY:Budget review with Pat', 'LOCATION:Room 4', 'DTSTART;TZID=Eastern Standard Time:20261201T100000', 'DTEND;TZID=Eastern Standard Time:20261201T103000']), 'outlook');
  assert.equal(x.kind, 'meeting');
  assert.equal(x.title, null);
  assert.equal(x.starts_at, new Date(zonedToUtc(2026, 12, 1, 10, 0, 0, 'America/New_York')).toISOString());
});

test('event physician entries become event shifts with the event name', () => {
  const [x] = rows(cal(['UID:e1', 'SUMMARY:⚕️ Event Physician — City FC vs. Sample United', 'DTSTART;TZID=America/New_York:20261128T173000', 'DTEND;TZID=America/New_York:20261128T223000', 'DESCRIPTION:Parking pass details']));
  assert.equal(x.kind, 'event_shift');
  assert.equal(x.title, 'City FC vs. Sample United');
  assert.equal((Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 3600000, 5);
});

test('weekly repeats expand inside the window, with exceptions and edited instances', () => {
  const r = rows(cal(
    ['UID:w', 'SUMMARY:Soccer practice', 'DTSTART;TZID=America/New_York:20261102T180000', 'DTEND;TZID=America/New_York:20261102T190000', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T235959Z', 'EXDATE;TZID=America/New_York:20261116T180000'],
    ['UID:w', 'SUMMARY:Soccer practice (moved)', 'RECURRENCE-ID;TZID=America/New_York:20261123T180000', 'DTSTART;TZID=America/New_York:20261124T180000', 'DTEND;TZID=America/New_York:20261124T190000']
  ), 'google', '2026-11-20', '2026-12-10');
  assert.deepEqual(r.map((x) => `${x.start_date} ${x.title}`).sort(), [
    '2026-11-24 Soccer practice (moved)', '2026-11-30 Soccer practice', '2026-12-07 Soccer practice'
  ]);
});

test('repeats keep their wall-clock time across the DST change', () => {
  const r = rows(cal(['UID:d', 'SUMMARY:Standup', 'DTSTART;TZID=America/New_York:20261030T090000', 'DTEND;TZID=America/New_York:20261030T091500', 'RRULE:FREQ=DAILY;COUNT=5']), 'google', '2026-10-30', '2026-11-05');
  const hoursUtc = r.map((x) => new Date(x.starts_at).getUTCHours());
  assert.deepEqual(hoursUtc, [13, 13, 14, 14, 14]); // 9 AM all week: EDT Oct 30-31, EST from Sun Nov 1
});

test('monthly by weekday (2nd Tuesday, last Friday)', () => {
  const r = rows(cal(
    ['UID:m1', 'SUMMARY:Board', 'DTSTART;TZID=America/New_York:20261013T190000', 'DTEND;TZID=America/New_York:20261013T200000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU'],
    ['UID:m2', 'SUMMARY:Payday', 'DTSTART;VALUE=DATE:20261030', 'DTEND;VALUE=DATE:20261031', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR']
  ), 'google', '2026-11-01', '2026-12-31');
  assert.deepEqual(r.filter((x) => x.title === 'Board').map((x) => x.start_date), ['2026-11-10', '2026-12-08']);
  assert.deepEqual(r.filter((x) => x.title === 'Payday').map((x) => x.start_date), ['2026-11-27', '2026-12-25']);
});

test('every row carries its source (the table requires it)', () => {
  const g = rows(cal(['UID:s', 'SUMMARY:Main ED', 'DTSTART:20261127T120000Z', 'DTEND:20261128T000000Z', QG]));
  const o = rows(cal(['UID:t', 'SUMMARY:Standup', 'DTSTART:20261127T150000Z', 'DTEND:20261127T153000Z']), 'outlook');
  assert.equal(g[0].source, 'google');
  assert.equal(o[0].source, 'outlook');
});
