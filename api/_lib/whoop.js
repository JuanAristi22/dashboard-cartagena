const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const API_BASE = 'https://api.prod.whoop.com/developer';

async function postForm(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) {
    throw new Error(`Whoop token request failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export function exchangeCodeForToken(code, redirectUri) {
  return postForm({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
  });
}

export function refreshAccessToken(refreshToken) {
  return postForm({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.WHOOP_CLIENT_ID,
    client_secret: process.env.WHOOP_CLIENT_SECRET,
    scope: 'offline',
  });
}

export async function fetchBasicProfile(accessToken) {
  const res = await fetch(`${API_BASE}/v2/user/profile/basic`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Whoop profile fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Returns a valid access token for the single stored user, refreshing it first if it
// expires within the next 5 minutes. Persists the refreshed token back to Supabase.
export async function getValidAccessToken(supabase) {
  const { data: auth, error } = await supabase
    .from('whoop_auth')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !auth) {
    throw new Error('No Whoop connection found. Visit /api/auth/whoop-login first.');
  }

  const nowPlusBuffer = Math.floor(Date.now() / 1000) + 300;
  if (auth.expires_at > nowPlusBuffer) {
    return auth.access_token;
  }

  const refreshed = await refreshAccessToken(auth.refresh_token);
  const expiresAt = Math.floor(Date.now() / 1000) + refreshed.expires_in;
  await supabase
    .from('whoop_auth')
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  return refreshed.access_token;
}

export { API_BASE };
