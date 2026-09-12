import { getSupabaseAdmin } from '../_lib/supabase.js';
import { exchangeCodeForToken, fetchBasicProfile } from '../_lib/whoop.js';

// Whoop redirects here after the user approves the connection.
export default async function handler(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.status(400).send(`Whoop authorization was denied or failed: ${error}`);
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
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const redirectUri = `https://${host}/api/auth/whoop-callback`;
    const token = await exchangeCodeForToken(code, redirectUri);
    const profile = await fetchBasicProfile(token.access_token);

    const supabase = getSupabaseAdmin();
    const expiresAt = Math.floor(Date.now() / 1000) + token.expires_in;
    const { error: dbError } = await supabase.from('whoop_auth').upsert({
      id: 1,
      user_id: profile.user_id,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
      scope: 'read:recovery read:cycles read:sleep read:profile read:body_measurement offline',
      updated_at: new Date().toISOString(),
    });

    if (dbError) throw dbError;

    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
    res.status(200).send(
      `<html><body style="font-family:sans-serif;padding:40px">` +
        `<h2>Whoop conectado ✅</h2>` +
        `<p>Cuenta: ${name || profile.user_id || 'desconocida'}</p>` +
        `<p>Ya puedes cerrar esta pestaña.</p>` +
        `</body></html>`
    );
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error connecting to Whoop: ${err.message}`);
  }
}
