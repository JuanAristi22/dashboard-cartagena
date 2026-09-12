import { getSupabaseAdmin } from '../_lib/supabase.js';
import { exchangeCodeForToken } from '../_lib/strava.js';

// Strava redirects here after the athlete approves the connection.
export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).send(`Strava authorization was denied or failed: ${error}`);
    return;
  }
  if (!process.env.APP_SECRET || state !== process.env.APP_SECRET) {
    res.status(401).send('Invalid state');
    return;
  }
  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }

  try {
    const token = await exchangeCodeForToken(code);

    const supabase = getSupabaseAdmin();
    const { error: dbError } = await supabase.from('strava_auth').upsert({
      id: 1,
      athlete_id: token.athlete?.id ?? null,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_at,
      scope: 'read,activity:read_all,profile:read_all',
      updated_at: new Date().toISOString(),
    });

    if (dbError) throw dbError;

    const name = [token.athlete?.firstname, token.athlete?.lastname].filter(Boolean).join(' ');
    res.status(200).send(
      `<html><body style="font-family:sans-serif;padding:40px">` +
        `<h2>Strava conectado ✅</h2>` +
        `<p>Cuenta: ${name || token.athlete?.id || 'desconocida'}</p>` +
        `<p>Ya puedes cerrar esta pestaña.</p>` +
        `</body></html>`
    );
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to Strava: ${err.message}`);
  }
}
