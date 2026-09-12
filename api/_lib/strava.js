const TOKEN_URL = 'https://www.strava.com/oauth/token';

export async function exchangeCodeForToken(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Returns a valid access token for the single stored athlete, refreshing it first if it
// expires within the next 5 minutes. Persists the refreshed token back to Supabase.
export async function getValidAccessToken(supabase) {
  const { data: auth, error } = await supabase
    .from('strava_auth')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !auth) {
    throw new Error('No Strava connection found. Visit /api/auth/strava-login first.');
  }

  const nowPlusBuffer = Math.floor(Date.now() / 1000) + 300;
  if (auth.expires_at > nowPlusBuffer) {
    return auth.access_token;
  }

  const refreshed = await refreshAccessToken(auth.refresh_token);
  await supabase
    .from('strava_auth')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: refreshed.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  return refreshed.access_token;
}
