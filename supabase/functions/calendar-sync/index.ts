// calendar-sync: reads the two private calendar feeds and stores filtered events.
//
// Secrets (set in Supabase, never in this repo): GOOGLE_ICS_URL, OUTLOOK_ICS_URL.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase at runtime.
// Deploy with JWT verification off: it's triggered by cron and by the app on open. Anyone calling it can
// only make it re-read the same two feeds (at most every few minutes); it returns no calendar data.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { feedToRows, localDate, DEFAULT_TZ } from './calendar.js';

const FEEDS: [string, string | undefined][] = [
  ['google', Deno.env.get('GOOGLE_ICS_URL')],
  ['outlook', Deno.env.get('OUTLOOK_ICS_URL')]
];
const MIN_GAP_MS = 4 * 60 * 1000;  // don't re-read more often than this
const PAST_DAYS = 14, FUTURE_DAYS = 75;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

async function syncFeed(source: string, url: string | undefined, from: string, to: string) {
  const now = new Date().toISOString();
  const status: Record<string, unknown> = { source, last_attempt_at: now };
  try {
    if (!url) throw new Error('Feed link not set up');
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'home-calendar-sync' } }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`Feed returned ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('Feed did not return a calendar');
    const rows = feedToRows(text, source, from, to).map((r: Record<string, unknown>) => ({ ...r, seen_at: now, removed_at: null, updated_at: now }));

    // A feed that suddenly comes back empty is treated as broken, so nothing gets marked removed.
    const { data: prev } = await db.from('calendar_sync').select('event_count').eq('source', source).maybeSingle();
    if (!rows.length && (prev?.event_count ?? 0) > 5) throw new Error('Feed came back empty');

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('calendar_events').upsert(rows.slice(i, i + 500), { onConflict: 'uid' });
      if (error) throw new Error(`Save failed: ${error.message}`);
    }
    // Inside the window, anything not seen this time was removed from the calendar. Mark it; never delete.
    const { error: rmErr } = await db.from('calendar_events').update({ removed_at: now })
      .eq('source', source).is('removed_at', null).lt('seen_at', now).gte('end_date', from).lte('start_date', to);
    if (rmErr) throw new Error(`Cleanup failed: ${rmErr.message}`);

    Object.assign(status, { last_ok_at: now, last_error: null, event_count: rows.length });
  } catch (e) {
    status.last_error = String((e as Error).message || e).slice(0, 200);
  }
  await db.from('calendar_sync').upsert(status, { onConflict: 'source' });
  return status;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const force = new URL(req.url).searchParams.get('force') === '1';
  const { data: last } = await db.from('calendar_sync').select('last_attempt_at');
  const newest = Math.max(0, ...(last || []).map((r: { last_attempt_at: string | null }) => (r.last_attempt_at ? Date.parse(r.last_attempt_at) : 0)));
  if (!force && Date.now() - newest < MIN_GAP_MS) return json({ ok: true, skipped: true });

  const now = Date.now();
  const from = localDate(now - PAST_DAYS * 86400000, DEFAULT_TZ), to = localDate(now + FUTURE_DAYS * 86400000, DEFAULT_TZ);
  const results = [];
  for (const [source, url] of FEEDS) results.push(await syncFeed(source, url, from, to));
  return json({ ok: results.every((r) => !r.last_error), feeds: results.map((r) => ({ source: r.source, ok: !r.last_error, error: r.last_error || null })) });
});
