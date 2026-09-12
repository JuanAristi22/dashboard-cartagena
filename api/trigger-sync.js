import { getSupabaseAdmin } from './_lib/supabase.js';
import { runFullSync } from './_lib/full-sync.js';

// Public, unauthenticated twin of /api/sync — this is what the dashboard's "Sync now"
// button calls, so APP_SECRET/CRON_SECRET never has to be embedded in client-side code.
export default async function handler(req, res) {
  const supabase = getSupabaseAdmin();
  const result = await runFullSync(supabase);
  res.status(result.errors.length ? 207 : 200).json(result);
}
