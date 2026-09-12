const CTL_DAYS = 42;
const ATL_DAYS = 7;

function toDateKey(isoString) {
  return isoString.slice(0, 10); // YYYY-MM-DD, in the timestamp's own timezone offset
}

// Sums Strava's suffer_score (Relative Effort) per calendar day. Activities with no
// suffer_score (e.g. some strength/indoor sessions without HR data) contribute 0.
export function dailyLoadsFromActivities(activities) {
  const byDate = new Map();
  for (const a of activities) {
    if (!a.start_date) continue;
    const key = toDateKey(a.start_date);
    const load = Number(a.suffer_score) || 0;
    byDate.set(key, (byDate.get(key) || 0) + load);
  }
  return byDate;
}

// Builds a continuous daily CTL/ATL/TSB series from the first activity date through
// `throughDate` (inclusive), filling rest days with 0 load. Seeded at CTL=ATL=0 on the day
// before the series starts — with 42-day/7-day time constants, this seed's influence is
// negligible by the time the series has run a few months, which is why sync-strava pulls
// full history rather than just recent activities.
export function computePmcSeries(dailyLoads, throughDate) {
  const dates = [...dailyLoads.keys()].sort();
  if (!dates.length) return [];

  const start = new Date(dates[0] + 'T00:00:00Z');
  const end = new Date(throughDate + 'T00:00:00Z');

  let ctl = 0;
  let atl = 0;
  const series = [];

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const load = dailyLoads.get(key) || 0;

    ctl = ctl + (load - ctl) / CTL_DAYS;
    atl = atl + (load - atl) / ATL_DAYS;
    const tsb = ctl - atl;

    series.push({
      date: key,
      daily_load: Math.round(load * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
    });
  }

  return series;
}
