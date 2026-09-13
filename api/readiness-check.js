import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken as getValidWhoopToken } from './_lib/whoop.js';
import { syncWhoopWindow } from './_lib/whoop-sync.js';
import { checkSyncAuth } from './_lib/auth.js';
import { evaluateReadiness, adjustBlocks } from './_lib/readiness-rules.js';
import { getWorkoutForDate } from './_lib/training-plan.js';
import { sendTelegramMessage } from './_lib/telegram.js';

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

async function fetchLastSleepPerformance(supabase) {
  const { data, error } = await supabase
    .from('whoop_sleep')
    .select('sleep_performance_percentage')
    .eq('nap', false)
    .order('start_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0]?.sleep_performance_percentage ?? null;
}

function formatBlockLine(b) {
  return `${b.sport.toUpperCase()} — ${b.label} (${b.time})${b.optional ? ' [opcional]' : ''}`;
}

function buildOkMessage({ todayStr, workout }) {
  const lines = [`✅ Buenos días — ${todayStr}. Tus datos de Whoop están bien, seguimos el plan tal cual:`, ''];
  if (workout?.blocks?.length) {
    lines.push(...workout.blocks.map(formatBlockLine));
  } else {
    lines.push('Hoy es día de descanso 🛌');
  }
  return lines.join('\n');
}

function buildAlertMessage({ todayStr, brokenRules, adjustedBlocks }) {
  const lines = [`⚠️ Buenos días — ${todayStr}. Algo en tus datos de Whoop pide atención:`, ''];
  lines.push(...brokenRules.map((r) => `• ${r.message}`));
  lines.push('');
  if (adjustedBlocks.length) {
    lines.push('Entrenamiento de hoy, ajustado a 80-90%:');
    lines.push(...adjustedBlocks.map((b) => `${formatBlockLine(b)}\n  → ${b.adjustedNote}`));
  } else {
    lines.push('Hoy no hay sesión programada.');
  }
  lines.push('');
  lines.push('¿Bajamos hoy la intensidad?');
  return lines.join('\n');
}

// Runs every weekday morning (cron, 5am Cartagena time): pulls fresh Whoop data, checks 4
// readiness rules (RHR, fatigue vs fitness, HRV, sleep) against recent history, and messages
// the athlete on Telegram either way -- "you're good, plan as-is" or an adjusted 80-90%
// version with Sí/No buttons. The athlete's tap is handled by telegram-webhook.js, which
// updates the readiness_pending row this creates.
export default async function handler(req, res) {
  if (!checkSyncAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    res.status(500).json({ ok: false, error: 'TELEGRAM_CHAT_ID not set' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();

    const whoopToken = await getValidWhoopToken(supabase);
    await syncWhoopWindow(supabase, whoopToken, { days: 3 });

    const recent = await fetchRecentRecovery(supabase, 8);
    const [today, yesterday, ...baseline] = recent;
    const lastSleepPerformance = await fetchLastSleepPerformance(supabase);

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
      lastSleepPerformance,
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const workout = getWorkoutForDate(todayStr);

    if (!brokenRules.length) {
      await sendTelegramMessage(chatId, buildOkMessage({ todayStr, workout }));
      res.status(200).json({ ok: true, alertSent: false, checked: { today, weeklyAvgRHR, weeklyAvgHRV, lastSleepPerformance, latestPmc } });
      return;
    }

    const adjustedBlocks = workout ? adjustBlocks(workout.blocks) : [];
    const text = buildAlertMessage({ todayStr, brokenRules, adjustedBlocks });

    const sent = await sendTelegramMessage(chatId, text, {
      buttons: [
        [
          { text: '✅ Sí, bajar a 80%', data: `readiness:accept:${todayStr}` },
          { text: '❌ No, sigo al 100%', data: `readiness:decline:${todayStr}` },
        ],
      ],
    });

    const { error: upsertErr } = await supabase.from('readiness_pending').upsert(
      {
        check_date: todayStr,
        chat_id: String(chatId),
        message_id: sent?.message_id ?? null,
        broken_rules: brokenRules,
        adjusted_blocks: adjustedBlocks,
        status: 'pending',
        decided_at: null,
      },
      { onConflict: 'check_date' }
    );
    if (upsertErr) throw upsertErr;

    res.status(200).json({ ok: true, alertSent: true, brokenRules, adjustedBlocks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
