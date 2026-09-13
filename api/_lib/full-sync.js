import { getValidAccessToken as getValidStravaToken } from './strava.js';
import { getValidAccessToken as getValidWhoopToken } from './whoop.js';
import { syncStravaWindow } from './strava-sync.js';
import { syncWhoopWindow } from './whoop-sync.js';
import { recomputePmc } from './pmc-calc.js';
import { computePlanCompletion } from './plan-tracking.js';

// Recent Strava activities -> recompute CTL/ATL/TSB -> recent Whoop data -> re-check plan
// completion (green/yellow/red), in one call. Each section is independent: if one token has
// gone stale, the others still update, and errors are collected rather than thrown so a
// partial failure still returns something useful. Used by both /api/sync (secret-gated, for
// cron) and /api/trigger-sync (public, for the dashboard's manual button).
export async function runFullSync(supabase) {
  const result = { ok: true, strava: null, pmc: null, whoop: null, planCompletion: null, errors: [] };

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

  try {
    result.planCompletion = await computePlanCompletion(supabase);
  } catch (err) {
    console.error('Plan completion check failed:', err);
    result.errors.push({ step: 'planCompletion', message: err.message });
  }

  if (result.errors.length) result.ok = false;
  return result;
}
