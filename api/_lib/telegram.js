function apiBase() {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

// No parse_mode: Telegram's Markdown treats _ and * as formatting markers and silently
// eats them from plain text (bit us with "TELEGRAM_CHAT_ID" showing as "TELEGRAMCHATID").
// Plain text is safer for messages built from variable names, data values, etc.
export async function sendTelegramMessage(chatId, text) {
  const res = await fetch(`${apiBase()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    console.error('Telegram sendMessage failed:', res.status, await res.text());
  }
}
