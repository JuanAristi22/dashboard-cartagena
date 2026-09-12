import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken } from './_lib/strava.js';
import { syncStravaWindow } from './_lib/strava-sync.js';
import { checkAppSecret } from './_lib/auth.js';

// Manual/testing entry point for the Strava sync (also used to drive the one-time full
// backfill by calling repeatedly with increasing `page`). The combined /api/sync endpoint
// uses syncStravaWindow directly instead of calling this over HTTP.
export default async function handler(req, res) {
  if (!checkAppSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const accessToken = await getValidAccessToken(supabase);

    const startPage = Math.max(Number(req.query.page) || 1, 1);
    const pageCount = Math.min(Number(req.query.pages) || 2, 5);

    const result = await syncStravaWindow(supabase, accessToken, { startPage, pageCount });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
