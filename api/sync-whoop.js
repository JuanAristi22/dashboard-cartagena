import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken, API_BASE } from './_lib/whoop.js';

function checkSecret(req) {
  const provided = req.headers['x-app-secret'] || req.query.secret;
  return !!process.env.APP_SECRET && provided === process.env.APP_SECRET;
}

async function fetchWhoop(path, accessToken, params) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Whoop ${path} fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function mapCycle(c) {
  return {
    external_id: String(c.id),
    start_at: c.start,
    end_at: c.end,
    score_state: c.score_state,
    strain: c.score?.strain ?? null,
    kilojoule: c.score?.kilojoule ?? null,
    average_heartrate: c.score?.average_heart_rate ?? null,
    max_heartrate: c.score?.max_heart_rate ?? null,
    raw: c,
  };
}

function mapRecovery(r) {
  return {
    cycle_id: String(r.cycle_id),
    sleep_id: r.sleep_id != null ? String(r.sleep_id) : null,
    score_state: r.score_state,
    recovery_score: r.score?.recovery_score ?? null,
    resting_heart_rate: r.score?.resting_heart_rate ?? null,
    hrv_rmssd_milli: r.score?.hrv_rmssd_milli ?? null,
    spo2_percentage: r.score?.spo2_percentage ?? null,
    skin_temp_celsius: r.score?.skin_temp_celsius ?? null,
    raw: r,
  };
}

function mapSleep(s) {
  return {
    external_id: String(s.id),
    cycle_id: s.cycle_id != null ? String(s.cycle_id) : null,
    start_at: s.start,
    end_at: s.end,
    nap: s.nap ?? false,
    score_state: s.score_state,
    sleep_performance_percentage: s.score?.sleep_performance_percentage ?? null,
    sleep_consistency_percentage: s.score?.sleep_consistency_percentage ?? null,
    sleep_efficiency_percentage: s.score?.sleep_efficiency_percentage ?? null,
    respiratory_rate: s.score?.respiratory_rate ?? null,
    raw: s,
  };
}

// Test/manual sync: pulls the last ~30 days of cycles, recovery and sleep from Whoop and
// upserts them into Supabase. Step-1 version — no derived health trends yet.
export default async function handler(req, res) {
  if (!checkSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const accessToken = await getValidAccessToken(supabase);

    const days = Math.min(Number(req.query.days) || 30, 90);
    const start = new Date(Date.now() - days * 86400000).toISOString();

    const [cyclesRes, recoveryRes, sleepRes] = await Promise.all([
      fetchWhoop('/v2/cycle', accessToken, { start, limit: 50 }),
      fetchWhoop('/v2/recovery', accessToken, { start, limit: 50 }),
      fetchWhoop('/v2/activity/sleep', accessToken, { start, limit: 50 }),
    ]);

    const cycles = (cyclesRes.records || []).map(mapCycle);
    const recoveries = (recoveryRes.records || []).map(mapRecovery);
    const sleeps = (sleepRes.records || []).map(mapSleep);

    const results = {};
    if (cycles.length) {
      const { error, count } = await supabase
        .from('whoop_cycles')
        .upsert(cycles, { onConflict: 'external_id', count: 'exact' });
      if (error) throw error;
      results.cycles = count ?? cycles.length;
    } else {
      results.cycles = 0;
    }

    if (recoveries.length) {
      const { error, count } = await supabase
        .from('whoop_recovery')
        .upsert(recoveries, { onConflict: 'cycle_id', count: 'exact' });
      if (error) throw error;
      results.recovery = count ?? recoveries.length;
    } else {
      results.recovery = 0;
    }

    if (sleeps.length) {
      const { error, count } = await supabase
        .from('whoop_sleep')
        .upsert(sleeps, { onConflict: 'external_id', count: 'exact' });
      if (error) throw error;
      results.sleep = count ?? sleeps.length;
    } else {
      results.sleep = 0;
    }

    res.status(200).json({ ok: true, upserted: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
