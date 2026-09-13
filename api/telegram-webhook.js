import { getSupabaseAdmin } from './_lib/supabase.js';
import { sendTelegramMessage, editMessageText, answerCallbackQuery } from './_lib/telegram.js';
import { getWorkoutForDate, getCurrentWeek } from './_lib/training-plan.js';
import { runFullSync } from './_lib/full-sync.js';

const HELP_TEXT =
  'Comandos disponibles:\n' +
  '/hoy — tu entrenamiento de hoy\n' +
  '/manana — tu entrenamiento de mañana\n' +
  '/plan — toda la semana actual, día por día\n' +
  '/semana — cómo vas esta semana (verde/amarillo/rojo)\n' +
  '/fitness — Fitness/Fatiga/Forma actual\n' +
  '/recovery — tu último recovery, RHR, HRV y sueño de Whoop\n' +
  '/sync — sincroniza Strava/Whoop y recalcula todo ahora mismo';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Renders a block's full prescription: either a plain string, or a
// {warmup, main, cooldown} structure (same shape the dashboard renders).
function formatDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  const parts = [];
  if (detail.warmup) parts.push(`Warm up: ${detail.warmup}`);
  if (detail.main) parts.push(`Main: ${detail.main}`);
  if (detail.cooldown) parts.push(`Cool down: ${detail.cooldown}`);
  return parts.join('\n');
}

function formatBlock(b) {
  const header = `${b.sport.toUpperCase()} — ${b.label} (${b.time})${b.optional ? ' [opcional]' : ''}`;
  const detail = formatDetail(b.detail);
  const notes = b.notes ? `\nNota: ${b.notes}` : '';
  return [header, detail, notes].filter(Boolean).join('\n');
}

async function replyForDate(chatId, dateStr, label) {
  const result = getWorkoutForDate(dateStr);
  if (!result) {
    await sendTelegramMessage(chatId, `${label} está fuera del rango del plan (11 semanas, Sep 14 – Nov 29).`);
    return;
  }
  if (!result.blocks.length) {
    await sendTelegramMessage(chatId, `${label} (${result.dow}) es día de descanso 🛌`);
    return;
  }
  const sections = result.blocks.map(formatBlock);
  await sendTelegramMessage(
    chatId,
    `📅 ${label} (${result.dow}, semana ${result.week.n}):\n\n${sections.join('\n\n')}`
  );
}

async function replyPlan(supabase, chatId) {
  const week = getCurrentWeek(todayStr());
  if (!week) {
    await sendTelegramMessage(chatId, 'Hoy está fuera del rango del plan (11 semanas, Sep 14 – Nov 29).');
    return;
  }
  const dayOrder = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const sections = dayOrder.map((dow) => {
    const blocks = (week.days[dow] || []).filter((b) => b.sport !== 'Rest');
    if (!blocks.length) return `${dow}: descanso 🛌`;
    const items = blocks
      .map((b) => `${b.sport} — ${b.label} (${b.time})${b.optional ? ' [opcional]' : ''}`)
      .join('; ');
    return `${dow}: ${items}`;
  });
  await sendTelegramMessage(
    chatId,
    `🗓️ Semana ${week.n} (${week.dates}) — ${week.phase}\n\n${sections.join('\n')}`
  );
}

async function replySync(supabase, chatId) {
  await sendTelegramMessage(chatId, '🔄 Sincronizando Strava, Whoop y recalculando el plan...');
  const result = await runFullSync(supabase);

  const parts = [];
  if (result.strava) parts.push(`Strava: ${result.strava.upserted} actividades`);
  if (result.pmc?.latest) parts.push(`Fitness ${result.pmc.latest.ctl} · Forma ${result.pmc.latest.tsb}`);
  if (result.whoop) parts.push(`Whoop: ${result.whoop.recovery} recovery`);
  if (result.planCompletion) parts.push(`Plan: ${result.planCompletion.evaluated} sesiones evaluadas`);

  if (result.errors.length) {
    const failed = result.errors.map((e) => e.step).join(', ');
    await sendTelegramMessage(chatId, `⚠️ Sync parcial — falló: ${failed}\n\n${parts.join('\n')}`);
  } else {
    await sendTelegramMessage(chatId, `✅ Listo\n\n${parts.join('\n')}`);
  }
}

async function replyWeek(supabase, chatId) {
  const week = getCurrentWeek(todayStr());
  if (!week) {
    await sendTelegramMessage(chatId, 'Hoy está fuera del rango del plan (11 semanas, Sep 14 – Nov 29).');
    return;
  }

  const { data, error } = await supabase.from('plan_completion').select('status').eq('week_n', week.n);
  if (error) throw error;

  const counts = { green: 0, yellow: 0, red: 0 };
  for (const row of data) counts[row.status] = (counts[row.status] || 0) + 1;

  const dayOrder = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const totalBlocks = dayOrder.reduce(
    (acc, dow) => acc + (week.days[dow] || []).filter((b) => b.sport !== 'Rest').length,
    0
  );
  const pending = totalBlocks - counts.green - counts.yellow - counts.red;

  await sendTelegramMessage(
    chatId,
    `📆 Semana ${week.n} (${week.dates}) — ${week.phase}\n\n` +
      `✅ ${counts.green} verde\n` +
      `⚠️ ${counts.yellow} amarillo\n` +
      `❌ ${counts.red} rojo\n` +
      `⬜ ${pending} sin evaluar todavía`
  );
}

async function replyFitness(supabase, chatId) {
  const { data, error } = await supabase
    .from('pmc_daily')
    .select('date, ctl, atl, tsb')
    .order('date', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data.length) {
    await sendTelegramMessage(chatId, 'Todavía no hay datos de Fitness calculados.');
    return;
  }
  const row = data[0];
  await sendTelegramMessage(
    chatId,
    `📊 Al ${row.date}:\n\n` +
      `Fitness (CTL): ${row.ctl}\n` +
      `Fatiga (ATL): ${row.atl}\n` +
      `Forma (TSB): ${row.tsb > 0 ? '+' : ''}${row.tsb}`
  );
}

async function replyRecovery(supabase, chatId) {
  const { data: cycles, error: cyclesErr } = await supabase
    .from('whoop_cycles')
    .select('external_id, start_at, strain')
    .order('start_at', { ascending: false })
    .limit(1);
  if (cyclesErr) throw cyclesErr;

  const { data: sleep, error: sleepErr } = await supabase
    .from('whoop_sleep')
    .select('start_at, sleep_performance_percentage')
    .order('start_at', { ascending: false })
    .limit(1);
  if (sleepErr) throw sleepErr;

  if (!cycles.length) {
    await sendTelegramMessage(chatId, 'Todavía no hay datos de Whoop.');
    return;
  }

  const { data: recovery, error: recErr } = await supabase
    .from('whoop_recovery')
    .select('recovery_score, resting_heart_rate, hrv_rmssd_milli')
    .eq('cycle_id', cycles[0].external_id)
    .maybeSingle();
  if (recErr) throw recErr;

  const lines = [`💚 Al ${cycles[0].start_at.slice(0, 10)}:`, ''];
  if (recovery) {
    lines.push(`Recovery: ${Math.round(recovery.recovery_score)}%`);
    lines.push(`FC en reposo: ${Math.round(recovery.resting_heart_rate)} bpm`);
    lines.push(`HRV: ${Math.round(recovery.hrv_rmssd_milli)} ms`);
  }
  lines.push(`Strain: ${Number(cycles[0].strain).toFixed(1)}`);
  if (sleep.length) {
    lines.push(`Sueño: ${sleep[0].sleep_performance_percentage}% del objetivo (${sleep[0].start_at.slice(0, 10)})`);
  }
  await sendTelegramMessage(chatId, lines.join('\n'));
}

// Handles a tap on the Sí/No buttons sent by api/readiness-check.js. `data` looks like
// "readiness:accept:2026-09-16" / "readiness:decline:2026-09-16". Idempotent: a second tap
// on an already-decided row just gets a toast, the stored decision doesn't change.
async function handleCallbackQuery(supabase, cbq) {
  const chatId = cbq.message?.chat?.id;
  const authorizedChatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId || !authorizedChatId || String(chatId) !== String(authorizedChatId)) {
    await answerCallbackQuery(cbq.id);
    return;
  }

  const [ns, action, checkDate] = (cbq.data || '').split(':');
  if (ns !== 'readiness' || !checkDate) {
    await answerCallbackQuery(cbq.id);
    return;
  }

  const { data: pending, error } = await supabase
    .from('readiness_pending')
    .select('status')
    .eq('check_date', checkDate)
    .maybeSingle();
  if (error) throw error;

  if (!pending || pending.status !== 'pending') {
    await answerCallbackQuery(cbq.id, 'Ya habías respondido esto.');
    return;
  }

  const status = action === 'accept' ? 'accepted' : 'declined';
  const { error: updateErr } = await supabase
    .from('readiness_pending')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('check_date', checkDate);
  if (updateErr) throw updateErr;

  const confirmLine =
    status === 'accepted'
      ? '✅ Confirmado: hoy vamos al 80-90%. (El envío automático al reloj/ciclocomputador todavía no está armado.)'
      : '❌ Confirmado: seguimos al 100% como estaba.';
  const originalText = cbq.message?.text || '';
  if (cbq.message?.message_id) {
    await editMessageText(chatId, cbq.message.message_id, `${originalText}\n\n${confirmLine}`);
  }
  await answerCallbackQuery(cbq.id, status === 'accepted' ? 'Ajustado a 80-90%' : 'Sigues al 100%');
}

// Telegram webhook: receives every message and button tap sent to the bot. Replies only to
// the owner's chat (TELEGRAM_CHAT_ID) -- everyone else is silently ignored. If that env var
// isn't set yet, replies to whoever writes with their chat ID, so the owner can grab it and
// set it.
export default async function handler(req, res) {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      res.status(401).json({ ok: false });
      return;
    }
  }

  const callbackQuery = req.body?.callback_query;
  if (callbackQuery) {
    try {
      await handleCallbackQuery(getSupabaseAdmin(), callbackQuery);
    } catch (err) {
      console.error(err);
      await answerCallbackQuery(callbackQuery.id, 'Error: ' + err.message);
    }
    res.status(200).json({ ok: true });
    return;
  }

  const message = req.body?.message;
  if (!message?.text || !message.chat?.id) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const authorizedChatId = process.env.TELEGRAM_CHAT_ID;

  if (!authorizedChatId) {
    await sendTelegramMessage(
      chatId,
      `Bot no configurado todavía.\n\nTu chat ID es: ${chatId}\n\nPonlo en Vercel como la variable TELEGRAM_CHAT_ID y este bot solo te va a responder a ti.`
    );
    res.status(200).json({ ok: true });
    return;
  }

  if (String(chatId) !== String(authorizedChatId)) {
    res.status(200).json({ ok: true }); // ignore strangers silently
    return;
  }

  const text = message.text.trim().toLowerCase();
  const supabase = getSupabaseAdmin();

  try {
    if (text.startsWith('/hoy') || text.startsWith('/today')) {
      await replyForDate(chatId, todayStr(), 'Hoy');
    } else if (text.startsWith('/manana') || text.startsWith('/mañana') || text.startsWith('/tomorrow')) {
      await replyForDate(chatId, addDaysStr(todayStr(), 1), 'Mañana');
    } else if (text.startsWith('/plan')) {
      await replyPlan(supabase, chatId);
    } else if (text.startsWith('/semana') || text.startsWith('/week')) {
      await replyWeek(supabase, chatId);
    } else if (text.startsWith('/fitness')) {
      await replyFitness(supabase, chatId);
    } else if (text.startsWith('/recovery')) {
      await replyRecovery(supabase, chatId);
    } else if (text.startsWith('/sync')) {
      await replySync(supabase, chatId);
    } else {
      await sendTelegramMessage(chatId, HELP_TEXT);
    }
  } catch (err) {
    console.error(err);
    await sendTelegramMessage(chatId, '⚠️ Error: ' + err.message);
  }

  res.status(200).json({ ok: true });
}
