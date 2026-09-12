// Manual/testing auth: ?secret=... or x-app-secret header, checked against APP_SECRET.
export function checkAppSecret(req) {
  const provided = req.headers['x-app-secret'] || req.query.secret;
  return !!process.env.APP_SECRET && provided === process.env.APP_SECRET;
}

// Vercel's own cron invocations carry `Authorization: Bearer <CRON_SECRET>` automatically
// once CRON_SECRET is set as an env var — see https://vercel.com/docs/cron-jobs/manage-cron-jobs
export function checkCronSecret(req) {
  const authHeader = req.headers.authorization;
  return !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
}

// The combined /api/sync endpoint accepts either: a human hitting it manually (or the
// dashboard's button) with APP_SECRET, or Vercel's scheduler with CRON_SECRET.
export function checkSyncAuth(req) {
  return checkAppSecret(req) || checkCronSecret(req);
}
