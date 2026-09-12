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

// Fetches a bounded window of pages from Strava (not the whole history at once — Vercel's
// Hobby plan kills functions that run too long). Returns whether it hit the end of the
// athlete's history (a short page) so the caller knows whether to request the next window.
async function fetchActivityPages(accessToken, startPage, pageCount) {
  const perPage = 200;
  const all = [];
  let reachedEnd = false;
  for (let page = startPage; page < startPage + pageCount; page++) {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${perPage}&page=${page}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      throw new Error(`Strava activities fetch failed: ${res.status} ${await res.text()}`);
    }
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < perPage) {
      reachedEnd = true;
      break;
    }
  }
  return { activities: all, reachedEnd };
}

// Pulls one window of the athlete's activity history and upserts it into Supabase.
// Call repeatedly with increasing `startPage` to backfill full history — each call stays
// small enough to finish well inside Vercel's time limit. Safe to re-run (upserted by
// source+external_id).
export async function syncStravaWindow(supabase, accessToken, { startPage = 1, pageCount = 2 } = {}) {
  const { activities, reachedEnd } = await fetchActivityPages(accessToken, startPage, pageCount);
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

  return {
    fetched: activities.length,
    upserted,
    done: reachedEnd,
    nextPage: startPage + pageCount,
  };
}
