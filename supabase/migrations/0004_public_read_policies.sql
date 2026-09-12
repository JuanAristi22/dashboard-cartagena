-- Public read-only access for the dashboard (anon/publishable key, browser-side).
-- strava_auth and whoop_auth intentionally get no policy here -- they stay locked to
-- service_role only (used server-side in the Vercel functions).
create policy "public read" on activities for select using (true);
create policy "public read" on pmc_daily for select using (true);
create policy "public read" on whoop_cycles for select using (true);
create policy "public read" on whoop_recovery for select using (true);
create policy "public read" on whoop_sleep for select using (true);
