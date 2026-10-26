// Coach Candela — a rule-based read of the Performance Management Chart (CTL/ATL/TSB),
// framed around the race goal, not just the raw numbers. Pure function: no I/O, so it can
// run both in the browser (index.html, duplicated inline per this project's no-bundler
// convention — keep that copy in sync with this one) and later server-side for a Telegram
// alert when the level crosses into "alert".
//
// Thresholds are the standard TrainingPeaks/Joe Friel PMC bands for TSB (Training Stress
// Balance = CTL - ATL), plus ACWR (Acute:Chronic Workload Ratio = ATL/CTL) as a second,
// independent injury-risk signal -- a jump in ACWR can show up before TSB looks alarming.
const TSB_BANDS = {
  VERY_FRESH: 25, // > this: likely losing fitness (too much rest)
  FRESH: 5, // this..VERY_FRESH: ready to race / good window for a key session
  NEUTRAL_LOW: -10, // NEUTRAL_LOW..FRESH: normal sustainable training
  BUILDING_LOW: -30, // BUILDING_LOW..NEUTRAL_LOW: accumulating fatigue, expected in a build block
  // < BUILDING_LOW: overtraining/injury risk zone
};

const ACWR_CAUTION = 1.3;
const ACWR_ALERT = 1.5;

function tsbBand(tsb) {
  if (tsb > TSB_BANDS.VERY_FRESH) return 'very_fresh';
  if (tsb >= TSB_BANDS.FRESH) return 'fresh';
  if (tsb >= TSB_BANDS.NEUTRAL_LOW) return 'neutral';
  if (tsb >= TSB_BANDS.BUILDING_LOW) return 'building';
  return 'high_risk';
}

// Sums daily_load over the last `days` entries of a date-ascending pmc series (today
// inclusive), using whatever is available if the series is shorter than requested.
function sumRecentLoad(series, days) {
  const slice = series.slice(-days);
  return slice.reduce((sum, r) => sum + (r.daily_load || 0), 0);
}

// Builds the full coach analysis from a date-ascending pmc series (each row needs at least
// date/daily_load/ctl/atl/tsb) plus race context. Returns null if there's no data yet.
export function getCoachAnalysis(pmcSeries, { daysLeft, phase } = {}) {
  if (!pmcSeries || !pmcSeries.length) return null;

  const latest = pmcSeries[pmcSeries.length - 1];
  const { ctl, atl, tsb } = latest;
  const band = tsbBand(tsb);
  const acwr = ctl > 0 ? Math.round((atl / ctl) * 100) / 100 : null;

  const thisWeekTss = sumRecentLoad(pmcSeries, 7);
  const prevWeeksSeries = pmcSeries.slice(0, -7);
  const prevWeeksTss = sumRecentLoad(prevWeeksSeries, 21);
  const avgPrevWeekTss = prevWeeksSeries.length >= 7 ? prevWeeksTss / Math.min(3, Math.floor(prevWeeksSeries.length / 7)) : null;
  const rampPct = avgPrevWeekTss && avgPrevWeekTss > 0 ? Math.round(((thisWeekTss - avgPrevWeekTss) / avgPrevWeekTss) * 100) : null;

  const metrics = { ctl, atl, tsb, band, acwr, thisWeekTss: Math.round(thisWeekTss), rampPct };

  const inTaper = phase && /taper/i.test(phase);

  // -------- Level + message --------
  // Highest-priority red flags first (overtraining/injury risk), regardless of phase.
  if (band === 'high_risk' || (acwr != null && acwr > ACWR_ALERT)) {
    return {
      level: 'alert',
      headline: 'Time to back off',
      message: `Your form (TSB ${tsb.toFixed(1)}) is deep in the red and${acwr != null ? ` your ACWR is ${acwr.toFixed(2)}` : ''} — this is the zone where injury and burnout happen, not where fitness gets built. Scale today's session down or take the day off entirely.`,
      metrics,
    };
  }

  if (rampPct != null && rampPct > 10 && (acwr == null || acwr > ACWR_CAUTION)) {
    return {
      level: 'caution',
      headline: 'Loading up fast',
      message: `This week's training load is running ${rampPct}% above your recent average. That's a sharp jump — totally fine for a planned build week, but worth a gut-check: is this the plan, or are extra sessions creeping in?`,
      metrics,
    };
  }

  if (band === 'building' && !inTaper) {
    return {
      level: 'normal',
      headline: 'On track for this phase',
      message: `TSB ${tsb.toFixed(1)} is exactly what a build block should look like — fatigue stacking on top of real fitness gains. Not a concern as long as the next recovery week lands on schedule.`,
      metrics,
    };
  }

  if (band === 'building' && inTaper) {
    return {
      level: 'caution',
      headline: 'Form should be climbing by now',
      message: `TSB is still at ${tsb.toFixed(1)} this late in the plan. Taper weeks exist to let this number rise before race day — if the next few days don't show it moving up, it's worth trimming volume further rather than adding more.`,
      metrics,
    };
  }

  if (band === 'fresh' && daysLeft != null && daysLeft <= 10) {
    return {
      level: 'optimal',
      headline: 'Right where you want to be',
      message: `TSB ${tsb.toFixed(1)} with ${daysLeft} days to go — this is the sweet spot for race day. Protect it: no new hard efforts this close in, just stay sharp.`,
      metrics,
    };
  }

  if (band === 'very_fresh') {
    return {
      level: daysLeft != null && daysLeft <= 10 ? 'optimal' : 'caution',
      headline: daysLeft != null && daysLeft <= 10 ? 'Fully rested' : 'Very fresh for this point in the plan',
      message:
        daysLeft != null && daysLeft <= 10
          ? `TSB ${tsb.toFixed(1)} — fully rested and ready. If this is race week, that's exactly the plan.`
          : `TSB ${tsb.toFixed(1)} is high for mid-plan — fine after a cutback week, but if training has felt light lately, this is also what losing fitness looks like on paper.`,
      metrics,
    };
  }

  return {
    level: 'normal',
    headline: 'Steady state',
    message: `TSB ${tsb.toFixed(1)}, CTL ${ctl.toFixed(1)}, ATL ${atl.toFixed(1)} — nothing in the numbers needs attention right now. Normal, sustainable training load.`,
    metrics,
  };
}
