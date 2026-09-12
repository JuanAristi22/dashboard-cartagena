import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken as getValidWhoopToken } from './_lib/whoop.js';
import { syncWhoopWindow } from './_lib/whoop-sync.js';
import { checkSyncAuth } from './_lib/auth.js';
import { evaluateReadiness, adjustBlocks } from './_lib/readiness-rules.js';
import { getWorkoutForDate } from './_lib/training-plan.js';
import { sendEmail } from './_lib/email.js';

const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || 'juan@tnc.com.co';

function average(nums) {
  const valid = nums.filter((n) => n != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// Joins the last N days of whoop_cycles + whoop_recovery in JS (no FK between them in the
// schema, so PostgREST can't embed the join) and returns them newest-first.
async function fetchRecentRecovery(supabase, days) {
  const { data: cycles, error: cyclesErr } = await supabase
    .from('whoop_cycles')
    .select('external_id, start_at')
    .order('start_at', { ascending: false })
    .limit(days);
  if (cyclesErr) throw cyclesErr;
  if (!cycles.length) return [];

  const ids = cycles.map((c) => c.external_id);
  const { data: recovery, error: recErr } = await supabase
    .from('whoop_recovery')
    .select('cycle_id, recovery_score, resting_heart_rate, hrv_rmssd_milli')
    .in('cycle_id', ids);
  if (recErr) throw recErr;

  const byCycle = new Map(recovery.map((r) => [r.cycle_id, r]));
  return cycles.map((c) => ({
    date: c.start_at?.slice(0, 10),
    ...byCycle.get(c.external_id),
  }));
}

function buildEmailHtml({ todayStr, brokenRules, workout }) {
  const rulesHtml = brokenRules.map((r) => `<li>${r.message}</li>`).join('');
  const workoutHtml = workout?.blocks?.length
    ? workout.blocks
        .map(
          (b) =>
            `<li><b>${b.sport}</b> — ${b.label} (${b.time}). Ajustado: ${b.adjustedNote}</li>`
        )
        .join('')
    : '<li>No hay sesión programada hoy en el plan.</li>';

  return `
    <div style="font-family:sans-serif; max-width:560px">
      <h2>⚠️ Ajuste en tu entrenamiento de hoy — ${todayStr}</h2>
      <p><b>Reglas que se activaron:</b></p>
      <ul>${rulesHtml}</ul>
      <p><b>Entrenamiento de hoy (ajustado a 80-90%):</b></p>
      <ul>${workoutHtml}</ul>
      <p style="color:#666;font-size:13px">Generado automáticamente por el chequeo de readiness de tu dashboard.</p>
    </div>
  `;
}

// Runs every morning (cron): pulls fresh Whoop data, checks 3 readiness rules against a
// 7-day baseline, and — only if one breaks — emails a suggested 80-90% adjustment for
// today's planned session. Sends nothing when all rules pass.
export default async function handler(req, res) {
  if (!checkSyncAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();

    const whoopToken = await getValidWhoopToken(supabase);
    await syncWhoopWindow(supabase, whoopToken, { days: 3 });

    const recent = await fetchRecentRecovery(supabase, 8);
    const [today, yesterday, ...baseline] = recent;

    const weeklyAvgRHR = average(baseline.map((d) => d?.resting_heart_rate));
    const weeklyAvgHRV = average(baseline.map((d) => d?.hrv_rmssd_milli));

    const { data: pmcRows, error: pmcErr } = await supabase
      .from('pmc_daily')
      .select('ctl, atl, date')
      .order('date', { ascending: false })
      .limit(1);
    if (pmcErr) throw pmcErr;
    const latestPmc = pmcRows[0] || {};

    const brokenRules = evaluateReadiness({
      todayRHR: today?.resting_heart_rate ?? null,
      weeklyAvgRHR,
      ctl: latestPmc.ctl ?? null,
      atl: latestPmc.atl ?? null,
      todayHRV: today?.hrv_rmssd_milli ?? null,
      yesterdayHRV: yesterday?.hrv_rmssd_milli ?? null,
      weeklyAvgHRV,
    });

    const todayStr = new Date().toISOString().slice(0, 10);

    if (!brokenRules.length) {
      res.status(200).json({ ok: true, alertSent: false, checked: { today, weeklyAvgRHR, weeklyAvgHRV, latestPmc } });
      return;
    }

    const workout = getWorkoutForDate(todayStr);
    const adjustedBlocks = workout ? adjustBlocks(workout.blocks) : [];
    const html = buildEmailHtml({ todayStr, brokenRules, workout: { blocks: adjustedBlocks } });

    await sendEmail({
      to: ALERT_EMAIL_TO,
      subject: `⚠️ Ajuste en tu entrenamiento de hoy — ${todayStr}`,
      html,
    });

    res.status(200).json({ ok: true, alertSent: true, brokenRules, workout: adjustedBlocks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
