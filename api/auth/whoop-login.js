// Visit /api/auth/whoop-login?secret=YOUR_APP_SECRET to (re)connect your Whoop account.
export default function handler(req, res) {
  const { secret } = req.query;
  if (!process.env.APP_SECRET || secret !== process.env.APP_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `https://${host}/api/auth/whoop-callback`;

  const authorizeUrl = new URL('https://api.prod.whoop.com/oauth/oauth2/auth');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', process.env.WHOOP_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set(
    'scope',
    'read:recovery read:cycles read:sleep read:profile read:body_measurement offline'
  );
  authorizeUrl.searchParams.set('state', process.env.APP_SECRET);

  res.writeHead(302, { Location: authorizeUrl.toString() });
  res.end();
}
