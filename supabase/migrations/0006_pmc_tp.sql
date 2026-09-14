-- Daily Fitness/Fatigue/Form (CTL/ATL/TSB) computed from TrainingPeaks TSS instead of
-- Strava suffer_score. Unlike pmc_daily, this is NOT refreshed by the cron -- TrainingPeaks
-- is only reachable through an MCP tool available inside a Claude conversation, not from the
-- Vercel backend. This table is a manual/periodic snapshot, recomputed by hand from TP history
-- when asked. See the "source" toggle on the dashboard.
create table if not exists pmc_tp_daily (
  date date primary key,
  daily_load numeric not null default 0,
  ctl numeric not null,
  atl numeric not null,
  tsb numeric not null,
  updated_at timestamptz not null default now()
);

alter table pmc_tp_daily enable row level security;
create policy "public read" on pmc_tp_daily for select using (true);
