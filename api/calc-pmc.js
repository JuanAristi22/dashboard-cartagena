import { getSupabaseAdmin } from './_lib/supabase.js';
import { recomputePmc } from './_lib/pmc-calc.js';
import { checkAppSecret } from './_lib/auth.js';

// Manual/testing entry point. The combined /api/sync endpoint uses recomputePmc directly.
export default async function handler(req, res) {
  if (!checkAppSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const result = await recomputePmc(supabase);
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
