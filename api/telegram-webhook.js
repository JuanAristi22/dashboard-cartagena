import { getSupabaseAdmin } from './_lib/supabase.js';
import { sendTelegramMessage } from './_lib/telegram.js';
import { getWorkoutForDate, getCurrentWeek } from './_lib/training-plan.js';

const HELP_TEXT =
  'Comandos disponibles:\n' +
  '/hoy — tu entrenamiento de hoy\n' +
  '/semana — cómo vas esta semana (verde/amarillo/rojo)\n' +
  '/fitness — Fitness/Fatiga/Forma actual\n' +
  '/recovery — tu último recovery, RHR, HRV y sueño de Whoop';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function replyToday(supabase, chatId) {
  const result = getWorkoutForDate(todayStr());
  if (!result) {
    await sendTelegramMessage(chatId, 'Hoy está fuera del rango del plan (11 semanas, Sep 14 – Nov 29).');
    return;
  }
  if (!result.blocks.length) {
    await sendTelegramMessage(chatId, `Hoy (${result.dow}) es día de descanso 🛌`);
    return;
  }
  const lines = result.blocks.map(
    (b) => `• *${b.sport}* — ${b.label} (${b.time})${b.optional ? ' _[opcional]_' : ''}`
  );
  await sendTelegramMessage(chatId, `📅 Hoy (${result.dow}, semana ${result.week.n}):\n\n${lines.join('\n')}`);
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
      `Fitness (CTL): *${row.ctl}*\n` +
      `Fatiga (ATL): *${row.atl}*\n` +
      `Forma (TSB): *${row.tsb > 0 ? '+' : ''}${row.tsb}*`
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
    lines.push(`Recovery: *${Math.round(recovery.recovery_score)}%*`);
    lines.push(`FC en reposo: *${Math.round(recovery.resting_heart_rate)} bpm*`);
    lines.push(`HRV: *${Math.round(recovery.hrv_rmssd_milli)} ms*`);
  }
  lines.push(`Strain: *${Number(cycles[0].strain).toFixed(1)}*`);
  if (sleep.length) {
    lines.push(`Sueño: *${sleep[0].sleep_performance_percentage}%* del objetivo (${sleep[0].start_at.slice(0, 10)})`);
  }
  await sendTelegramMessage(chatId, lines.join('\n'));
}

// Telegram webhook: receives every message sent to the bot. Replies only to the owner's
// chat (TELEGRAM_CHAT_ID) -- everyone else is silently ignored. If that env var isn't set
// yet, replies to whoever writes with their chat ID, so the owner can grab it and set it.
export default async function handler(req, res) {
  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      res.status(401).json({ ok: false });
      return;
    }
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
      `Bot no configurado todavía.\n\nTu chat ID es: \`${chatId}\`\n\nPonlo en Vercel como la variable TELEGRAM_CHAT_ID y este bot solo te va a responder a ti.`
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
      await replyToday(supabase, chatId);
    } else if (text.startsWith('/semana') || text.startsWith('/week')) {
      await replyWeek(supabase, chatId);
    } else if (text.startsWith('/fitness')) {
      await replyFitness(supabase, chatId);
    } else if (text.startsWith('/recovery')) {
      await replyRecovery(supabase, chatId);
    } else {
      await sendTelegramMessage(chatId, HELP_TEXT);
    }
  } catch (err) {
    console.error(err);
    await sendTelegramMessage(chatId, '⚠️ Error: ' + err.message);
  }

  res.status(200).json({ ok: true });
}
