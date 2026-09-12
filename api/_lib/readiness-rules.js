// Three readiness rules, evaluated against a 7-day rolling baseline. Any one breaking
// triggers the "reduce today's session to 80-90%" email.
//
// Rule 1 — Resting HR: today's RHR is more than 5 bpm above the weekly average.
// Rule 2 — Fatigue vs Fitness: ATL exceeds CTL by more than 20 points (TSB < -20).
//   Note: CTL/ATL are Strava Relative-Effort load units, not percentages — "20 puntos
//   porcentuales" is read here as 20 points of TSB, which is the standard way this
//   threshold is discussed for training-load dashboards.
// Rule 3 — HRV: today's HRV is more than 6ms below the weekly average, AND yesterday's
//   HRV was also more than 6ms below that same average (two consecutive days; one bad
//   day alone does not trigger it).
export function evaluateReadiness({ todayRHR, weeklyAvgRHR, ctl, atl, todayHRV, yesterdayHRV, weeklyAvgHRV }) {
  const broken = [];

  if (todayRHR != null && weeklyAvgRHR != null && todayRHR - weeklyAvgRHR > 5) {
    broken.push({
      rule: 'resting_hr',
      message: `FC en reposo hoy (${todayRHR.toFixed(0)} bpm) está ${(todayRHR - weeklyAvgRHR).toFixed(1)} bpm por encima del promedio semanal (${weeklyAvgRHR.toFixed(0)} bpm).`,
    });
  }

  if (ctl != null && atl != null && atl - ctl > 20) {
    broken.push({
      rule: 'fatigue_vs_fitness',
      message: `Fatiga (ATL ${atl.toFixed(1)}) supera a Fitness (CTL ${ctl.toFixed(1)}) por ${(atl - ctl).toFixed(1)} puntos (Forma/TSB: ${(ctl - atl).toFixed(1)}).`,
    });
  }

  if (
    todayHRV != null &&
    yesterdayHRV != null &&
    weeklyAvgHRV != null &&
    weeklyAvgHRV - todayHRV > 6 &&
    weeklyAvgHRV - yesterdayHRV > 6
  ) {
    broken.push({
      rule: 'hrv_drop',
      message: `HRV lleva 2 días seguidos más de 6ms por debajo del promedio semanal (hoy: ${todayHRV.toFixed(0)}ms, ayer: ${yesterdayHRV.toFixed(0)}ms, promedio: ${weeklyAvgHRV.toFixed(0)}ms).`,
    });
  }

  return broken;
}

// Parses a block's "time" field ("60 min", "3:00", "90 min", "~2:30", "—") into minutes,
// when possible, so we can suggest an 80-90% adjusted duration.
export function parseMinutes(timeStr) {
  if (!timeStr) return null;
  const clean = timeStr.replace('~', '').trim();

  const minMatch = clean.match(/^(\d+)\s*min/);
  if (minMatch) return Number(minMatch[1]);

  const hmMatch = clean.match(/^(\d+):(\d+)/);
  if (hmMatch) return Number(hmMatch[1]) * 60 + Number(hmMatch[2]);

  return null;
}

// Builds a plain-language adjustment note per block: a scaled-down duration when we can
// parse one, plus a generic effort-reduction reminder either way.
export function adjustBlocks(blocks) {
  return blocks.map((b) => {
    const minutes = parseMinutes(b.time);
    const adjusted =
      minutes != null
        ? `~${Math.round(minutes * 0.8)}-${Math.round(minutes * 0.9)} min (80-90% de ${b.time})`
        : 'reduce el esfuerzo/duración a 80-90% de lo planeado';
    return { ...b, adjustedNote: adjusted };
  });
}
