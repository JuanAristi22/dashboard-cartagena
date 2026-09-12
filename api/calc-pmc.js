import { getSupabaseAdmin } from './_lib/supabase.js';
import { dailyLoadsFromActivities, computePmcSeries } from './_lib/pmc.js';

function checkSecret(req) {
  const provided = req.headers['x-app-secret'] || req.query.secret;
  return !!process.env.APP_SECRET && provided === process.env.APP_SECRET;
}

// Reads every stored Strava activity (paginating past Supabase/PostgREST's 1000-row
// default page size — a multi-year training history can exceed that).
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

// Recomputes the full CTL/ATL/TSB (Fitness/Fatigue/Form) daily series from whatever
// Strava activities are already stored in Supabase, and upserts it into pmc_daily.
// Run this after /api/sync-strava so it sees the latest activities.
export default async function handler(req, res) {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const activities = await fetchAllActivities(supabase);

    const forLoads = activities.map((a) => ({
      start_date: a.raw?.start_date_local || a.start_date,
      suffer_score: a.suffer_score,
    }));
    const dailyLoads = dailyLoadsFromActivities(forLoads);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const series = computePmcSeries(dailyLoads, today).map((row) => ({
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

    res.status(200).json({
      ok: true,
      activitiesUsed: activities.length,
      days: series.length,
      latest: series[series.length - 1] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
