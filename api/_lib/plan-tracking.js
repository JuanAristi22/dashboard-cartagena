import { getAllPlannedBlocks } from './training-plan.js';
import { parseMinutes } from './readiness-rules.js';
import { todayInCartagena } from './date.js';

// Maps Strava's sport_type to the plan's sport categories (Bike/Run/Swim/Strength).
// Anything not listed here (Walk, Tennis, Golf, Workout, ...) doesn't count toward any
// planned block -- there's nothing in the plan to match it against.
const SPORT_MAP = {
  Ride: 'Bike',
  VirtualRide: 'Bike',
  EBikeRide: 'Bike',
  Run: 'Run',
  TrailRun: 'Run',
  Swim: 'Swim',
  WeightTraining: 'Strength',
};

const GREEN_THRESHOLD = 0.7; // actual/planned ratio at or above this = green, below = yellow

// Reads real Strava activities in the plan's date range and totals minutes per
// (date, mapped sport) -- e.g. { '2026-09-16': { Bike: 62, Run: 15 } }.
async function fetchActivityMinutesByDateSport(supabase, fromDate, toDate) {
  const { data, error } = await supabase
    .from('activities')
    .select('sport_type, moving_time_s, start_date, raw')
    .eq('source', 'strava')
    .gte('start_date', fromDate)
    .lte('start_date', toDate);
  if (error) throw error;

  const byDateSport = {};
  for (const a of data) {
    const category = SPORT_MAP[a.sport_type];
    if (!category) continue;
    const dateStr = (a.raw?.start_date_local || a.start_date).slice(0, 10);
    const minutes = (a.moving_time_s || 0) / 60;
    byDateSport[dateStr] = byDateSport[dateStr] || {};
    byDateSport[dateStr][category] = (byDateSport[dateStr][category] || 0) + minutes;
  }
  return byDateSport;
}

// Compares every past, already-happened block in the training plan against real Strava
// activity on that date, and upserts a green/yellow/red verdict per block into
// plan_completion. Skips future dates (nothing to judge yet) and un-done optional blocks
// (never required, so silence rather than a false "red").
export async function computePlanCompletion(supabase, { today = todayInCartagena(), year } = {}) {
  const blocks = getAllPlannedBlocks(year);
  const pastBlocks = blocks.filter((b) => b.date <= today);
  if (!pastBlocks.length) return { evaluated: 0, upserted: 0 };

  const fromDate = pastBlocks[0].date;
  const minutesByDateSport = await fetchActivityMinutesByDateSport(supabase, fromDate, today);

  const rows = [];
  for (const b of pastBlocks) {
    const plannedMinutes = parseMinutes(b.time);
    if (plannedMinutes == null) continue;

    const dayTotals = minutesByDateSport[b.date] || {};
    const actualMinutes =
      b.sport === 'Brick'
        ? (dayTotals.Bike || 0) + (dayTotals.Run || 0)
        : dayTotals[b.sport] || 0;

    if (actualMinutes === 0 && b.optional) continue; // never required, don't mark red

    const status = actualMinutes === 0 ? 'red' : actualMinutes / plannedMinutes >= GREEN_THRESHOLD ? 'green' : 'yellow';

    rows.push({
      week_n: b.week_n,
      dow: b.dow,
      block_index: b.block_index,
      planned_date: b.date,
      sport: b.sport,
      label: b.label,
      planned_minutes: plannedMinutes,
      actual_minutes: Math.round(actualMinutes * 10) / 10,
      status,
      updated_at: new Date().toISOString(),
    });
  }

  let upserted = 0;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error, count } = await supabase
      .from('plan_completion')
      .upsert(chunk, { onConflict: 'week_n,dow,block_index', count: 'exact' });
    if (error) throw error;
    upserted += count ?? chunk.length;
  }

  return { evaluated: rows.length, upserted };
}
