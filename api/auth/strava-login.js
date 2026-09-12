// Visit /api/auth/strava-login?secret=YOUR_APP_SECRET to (re)connect your Strava account.
// Requires APP_SECRET so a random visitor can't link their own Strava account to this dashboard.
export default function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.APP_SECRET || secret !== process.env.APP_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `https://${host}/api/auth/strava-callback`;

  const authorizeUrl = new URL('https://www.strava.com/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', process.env.STRAVA_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('approval_prompt', 'auto');
  authorizeUrl.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
  authorizeUrl.searchParams.set('state', process.env.APP_SECRET);

  res.writeHead(302, { Location: authorizeUrl.toString() });
  res.end();
}
