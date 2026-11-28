# Home OS

A private household app for two adults, installed to the home screen on two phones.
Static PWA (plain HTML, CSS, vanilla JS, no build step) on GitHub Pages, with Supabase for sign-in and data.

This repo is a template: it holds no names, addresses, chores, or calendar data.

## Set up your own copy

1. **Supabase project.** Create a new, empty Supabase project used only for this app.
2. **Turn off public signups.** Authentication > Providers > Email: keep email/password on, and turn off "Allow new users to sign up".
3. **Run the schema.** Open the SQL editor and run `supabase/setup.sql`. It is safe to run again; it never drops anything.
4. **Create the two users and add them to the household.** Authentication > Users > Add user, once per person (you choose the passwords). Then copy each user ID and run the `insert into public.household_members ...` line at the bottom of `setup.sql`, once per ID. Don't commit the IDs.
5. **Config.** Put the project URL and the publishable (anon) key in `config.js`. Never put a service-role or secret key in this repo.
6. **Publish.** GitHub Pages from the `main` branch root. The app is served at `/<repo-name>/`; all paths are relative.
7. **Install.** On each iPhone, open the site in Safari, tap Share, then Add to Home Screen, and sign in inside the installed app. (An installed app keeps its own storage, separate from Safari.)

8. **Costco list (optional).** In the app, Settings > Lists > Import Costco list, and pick a CSV with columns `name, category, store, good_to_freeze`. Categories Fridge, Freezer, Pantry, Household, and Kids group the list; anything else goes under Other. Keep the CSV out of the repo.

9. **Chores (optional).** Settings > Lists > Import chores, with a CSV of columns `name, group, repeat_mode (fixed | after_completion | once), every, unit (day | week | month | year), week_of_month (1-4), months (Mar;Jun), day (Tue), owner (Me | Either), active (yes | no), notes, howto, start_date`. "Me" means whoever imports. Rows with `once` become priority tasks. Keep the CSV out of the repo.

10. **Calendar (optional).** The `calendar-sync` Edge Function reads two private calendar links and stores filtered events (never descriptions, attendees, locations, or meeting links).
    - Find the links. Google: Calendar settings > your calendar > Integrate calendar > **Secret address in iCal format**. Outlook: Settings > Calendar > Shared calendars > **Publish a calendar** > ICS link.
    - Add them as Edge Function secrets in Supabase (Edge Functions > Secrets): `GOOGLE_ICS_URL` and `OUTLOOK_ICS_URL`. Never put them in this repo.
    - Deploy: `supabase functions deploy calendar-sync --project-ref <your-ref> --no-verify-jwt --use-api` (it's triggered by cron and by the app; it returns no calendar data).
    - Schedule every 30 minutes with the commented SQL in `setup.sql` section 8.
    - Rules: QGenda entries (description contains "AutoSync from QGenda") with "call" in the title are On call; "Off" is not a shift; other timed ones are Working. Upcoming "Event Physician" entries are listed under Event shifts. Overnight shifts and overnight activations make the next morning Post call (hours set in Settings).

## Notes

- Theme is stored per phone. Night Shift dims to amber from 10 PM to 6 AM (toggle in Settings).
- Every storage key and cache name starts with `homeos-`, and the service worker deletes only its own caches, so other apps on the same GitHub Pages origin are left alone.
- Bump `VERSION` in `sw.js` on every release.
- Layout readout for debugging: tap "Version" in Settings five times.
- Chore repeat rules live in `js/schedule.js`. Tests: `node --test tests/schedule.test.mjs` (no install needed).

## Local preview

Serve the parent folder so paths match GitHub Pages, for example from the folder that contains `home-os`:

```bash
python3 -m http.server 8765
```

Then open `http://localhost:8765/home-os/`. On localhost only, `?preview=signin|home|settings&theme=night|blush|roast&clock=22:40` renders screens with sample data and no network, for screenshots. `tools/shots.sh` takes all of them.
