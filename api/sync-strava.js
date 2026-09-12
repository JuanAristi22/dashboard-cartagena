import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken } from './_lib/strava.js';

function checkSecret(req) {
  const provided = req.headers['x-app-secret'] || req.query.secret;
  return !!process.env.APP_SECRET && provided === process.env.APP_SECRET;
}

function mapActivity(a) {
  return {
    source: 'strava',
    external_id: a.id,
    athlete_id: a.athlete?.id ?? null,
    name: a.name,
    sport_type: a.sport_type || a.type,
    start_date: a.start_date,
    moving_time_s: a.moving_time,
    elapsed_time_s: a.elapsed_time,
    distance_m: a.distance,
    total_elevation_gain_m: a.total_elevation_gain,
    average_heartrate: a.average_heartrate ?? null,
    max_heartrate: a.max_heartrate ?? null,
    average_watts: a.average_watts ?? null,
    weighted_average_watts: a.weighted_average_watts ?? null,
    kilojoules: a.kilojoules ?? null,
    suffer_score: a.suffer_score ?? null,
    raw: a,
  };
}

// Test/manual sync: pulls the most recent activities from Strava and upserts them into Supabase.
// This is the step-1 version — no CTL/ATL/TSB calculation yet, just proving the pipeline works.
export default async function handler(req, res) {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const accessToken = await getValidAccessToken(supabase);

    const perPage = Math.min(Number(req.query.per_page) || 30, 100);
    const activitiesRes = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!activitiesRes.ok) {
      throw new Error(`Strava activities fetch failed: ${activitiesRes.status} ${await activitiesRes.text()}`);
    }

    const activities = await activitiesRes.json();
    const rows = activities.map(mapActivity);

    let upserted = 0;
    if (rows.length) {
      const { error, count } = await supabase
        .from('activities')
        .upsert(rows, { onConflict: 'source,external_id', count: 'exact' });
      if (error) throw error;
      upserted = count ?? rows.length;
    }

    res.status(200).json({ ok: true, fetched: activities.length, upserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
