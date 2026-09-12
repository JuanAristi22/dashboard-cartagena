import { getSupabaseAdmin } from './_lib/supabase.js';
import { getValidAccessToken } from './_lib/whoop.js';
import { syncWhoopWindow } from './_lib/whoop-sync.js';
import { checkAppSecret } from './_lib/auth.js';

// Manual/testing entry point for the Whoop sync. The combined /api/sync endpoint uses
// syncWhoopWindow directly instead of calling this over HTTP.
export default async function handler(req, res) {
  if (!checkAppSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const accessToken = await getValidAccessToken(supabase);
    const days = Math.min(Number(req.query.days) || 30, 90);

    const result = await syncWhoopWindow(supabase, accessToken, { days });
    res.status(200).json({ ok: true, upserted: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
