// Vercel functions run in UTC. Cartagena (America/Bogota) is UTC-5 year-round, no DST --
// but for several hours each evening (roughly 7pm-midnight local), UTC has already rolled
// over to the next calendar day. Anything that means "today" for the athlete (which
// workout to show, which date counts as "past" for plan completion, etc.) must use this
// instead of `new Date().toISOString().slice(0, 10)`, or it reports tomorrow's date too early.
export function todayInCartagena() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
