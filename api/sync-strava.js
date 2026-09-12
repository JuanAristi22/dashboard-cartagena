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

// Fetches the athlete's full activity history from Strava, paginating until an empty/short
// page is hit. Needed (not just "recent activities") because CTL/ATL only converge to
// accurate values once a few months of real training load feed the exponential average.
async function fetchAllActivities(accessToken, maxPages) {
  const perPage = 200;
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
    }
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

// Pulls the athlete's full activity history and upserts it into Supabase. Safe to run
// repeatedly (2x/day via cron) since activities are upserted by (source, external_id).
export default async function handler(req, res) {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const accessToken = await getValidAccessToken(supabase);

    const maxPages = Math.min(Number(req.query.max_pages) || 15, 25);
    const activities = await fetchAllActivities(accessToken, maxPages);
    const rows = activities.map(mapActivity);

    let upserted = 0;
    const chunkSize = 200;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error, count } = await supabase
        .from('activities')
        .upsert(chunk, { onConflict: 'source,external_id', count: 'exact' });
      if (error) throw error;
      upserted += count ?? chunk.length;
    }

    res.status(200).json({ ok: true, fetched: activities.length, upserted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
