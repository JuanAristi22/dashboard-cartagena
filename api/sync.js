import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken as getValidStravaToken } from './_lib/strava.js';
import { getValidAccessToken as getValidWhoopToken } from './_lib/whoop.js';
import { syncStravaWindow } from './_lib/strava-sync.js';
import { syncWhoopWindow } from './_lib/whoop-sync.js';
import { recomputePmc } from './_lib/pmc-calc.js';
import { checkSyncAuth } from './_lib/auth.js';

// The one function everything else points to: the dashboard's manual "Sync" button and
// Vercel's cron jobs both hit this. Pulls recent Strava activities, recalculates
// Fitness/Fatigue/Form, and pulls recent Whoop recovery/sleep/cycles — in one call.
//
// Each section is independent: if Whoop's token has gone stale, Strava + PMC still update,
// and vice versa. Errors are collected and returned rather than thrown, so a partial
// failure still leaves you with a useful response instead of a bare 500.
export default async function handler(req, res) {
  if (!checkSyncAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const supabase = getSupabaseAdmin();
  const result = { ok: true, strava: null, pmc: null, whoop: null, errors: [] };

  try {
    const stravaToken = await getValidStravaToken(supabase);
    result.strava = await syncStravaWindow(supabase, stravaToken, { startPage: 1, pageCount: 3 });
  } catch (err) {
    console.error('Strava sync failed:', err);
    result.errors.push({ step: 'strava', message: err.message });
  }

  try {
    result.pmc = await recomputePmc(supabase);
  } catch (err) {
    console.error('PMC calculation failed:', err);
    result.errors.push({ step: 'pmc', message: err.message });
  }

  try {
    const whoopToken = await getValidWhoopToken(supabase);
    result.whoop = await syncWhoopWindow(supabase, whoopToken, { days: 14 });
  } catch (err) {
    console.error('Whoop sync failed:', err);
    result.errors.push({ step: 'whoop', message: err.message });
  }

  if (result.errors.length) result.ok = false;
  res.status(result.errors.length ? 207 : 200).json(result);
}
