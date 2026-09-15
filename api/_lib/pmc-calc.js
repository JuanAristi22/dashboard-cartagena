import { dailyLoadsFromActivities, computePmcSeries } from './pmc.js';
import { todayInCartagena } from './date.js';

// Reads every stored Strava activity (paginating past Supabase/PostgREST's 1000-row
// default page size — a multi-year training history can exceed that). Only used for the
// one-time bootstrap, when pmc_daily has no rows yet to seed from.
async function fetchAllActivities(supabase) {
  const pageSize = 1000;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('activities')
      .select('suffer_score, start_date, raw')
      .eq('source', 'strava')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}

// Reads Strava activities from `fromDate` onward -- the normal (non-bootstrap) path, bounded
// to a few days so this doesn't grow with the athlete's total history.
async function fetchActivitiesSince(supabase, fromDate) {
  const { data, error } = await supabase
    .from('activities')
    .select('suffer_score, start_date, raw')
    .eq('source', 'strava')
    .gte('start_date', fromDate);
  if (error) throw error;
  return data;
}

function toLoads(activities) {
  return activities.map((a) => ({
    start_date: a.raw?.start_date_local || a.start_date,
    suffer_score: a.suffer_score,
  }));
}

// Recomputes CTL/ATL/TSB (Fitness/Fatigue/Form) and upserts it into pmc_daily. Call this
// after syncing Strava activities so it sees the latest data.
//
// Normal path: seeds from the day *before* the most recently stored pmc_daily row (so the
// most recent day gets fully reprocessed too, in case more activities landed for it since
// last time), then only reads activities from there through today -- a few days at most,
// not the athlete's whole history. First-ever run (no pmc_daily rows) falls back to a full
// bootstrap over everything stored.
export async function recomputePmc(supabase) {
  const today = todayInCartagena();
  const now = new Date().toISOString();

  const { data: checkpointRows, error: checkpointErr } = await supabase
    .from('pmc_daily')
    .select('date, ctl, atl')
    .order('date', { ascending: false })
    .limit(2);
  if (checkpointErr) throw checkpointErr;

  let seed = null;
  let activities;
  if (checkpointRows.length === 2) {
    const seedRow = checkpointRows[1]; // the day before our last computed day
    seed = { date: seedRow.date, ctl: Number(seedRow.ctl), atl: Number(seedRow.atl) };
    activities = await fetchActivitiesSince(supabase, seed.date);
  } else {
    activities = await fetchAllActivities(supabase);
  }

  const dailyLoads = dailyLoadsFromActivities(toLoads(activities));
  const series = computePmcSeries(dailyLoads, today, seed).map((row) => ({
    ...row,
    updated_at: now,
  }));

  let upserted = 0;
  const chunkSize = 500;
  for (let i = 0; i < series.length; i += chunkSize) {
    const chunk = series.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from('pmc_daily')
      .upsert(chunk, { onConflict: 'date', count: 'exact' });
    if (error) throw error;
    upserted += count ?? chunk.length;
  }

  return {
    activitiesUsed: activities.length,
    days: series.length,
    upserted,
    latest: series[series.length - 1] || null,
  };
}
