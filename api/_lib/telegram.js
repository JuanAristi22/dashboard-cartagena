function apiBase() {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

async function callTelegram(method, body) {
  const res = await fetch(`${apiBase()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Telegram ${method} failed:`, res.status, await res.text());
    return null;
  }
  return res.json();
}

// No parse_mode: Telegram's Markdown treats _ and * as formatting markers and silently
// eats them from plain text (bit us with "TELEGRAM_CHAT_ID" showing as "TELEGRAMCHATID").
// Plain text is safer for messages built from variable names, data values, etc.
//
// `buttons`, when given, is an array of rows, each row an array of {text, data} — rendered
// as a Telegram inline keyboard, `data` coming back later as callback_query.data.
export async function sendTelegramMessage(chatId, text, { buttons } = {}) {
  const body = { chat_id: chatId, text };
  if (buttons) {
    body.reply_markup = {
      inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
    };
  }
  const result = await callTelegram('sendMessage', body);
  return result?.result ?? null; // the sent Message, so callers can capture message_id
}

// Replaces a message's text and drops its buttons (or swaps them for `buttons`) -- used
// after the athlete taps a Sí/No button, so the keyboard doesn't stay tappable twice.
export async function editMessageText(chatId, messageId, text, { buttons } = {}) {
  const body = { chat_id: chatId, message_id: messageId, text };
  if (buttons) {
    body.reply_markup = {
      inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
    };
  }
  await callTelegram('editMessageText', body);
}

// Telegram requires every callback_query to be answered, or the tapped button keeps
// spinning on the athlete's phone. `text`, if given, shows as a brief toast.
export async function answerCallbackQuery(callbackQueryId, text) {
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}
