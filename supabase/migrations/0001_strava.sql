-- Strava OAuth token storage. Single row (id=1): this dashboard tracks one athlete.
create table if not exists strava_auth (
  id smallint primary key default 1,
  athlete_id bigint,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null, -- epoch seconds, as returned by Strava
  scope text,
  updated_at timestamptz not null default now(),
  constraint strava_auth_single_row check (id = 1)
);

-- Activities pulled from Strava (and, later, other sources).
create table if not exists activities (
  id bigserial primary key,
  source text not null default 'strava',
  external_id bigint not null,
  athlete_id bigint,
  name text,
  sport_type text,
  start_date timestamptz,
  moving_time_s integer,
  elapsed_time_s integer,
  distance_m numeric,
  total_elevation_gain_m numeric,
  average_heartrate numeric,
  max_heartrate numeric,
  average_watts numeric,
  weighted_average_watts numeric,
  kilojoules numeric,
  suffer_score numeric,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (source, external_id)
);

create index if not exists activities_start_date_idx on activities (start_date);

-- RLS enabled with no policies: only the service_role key (used server-side in the Vercel
-- functions) can read/write these tables. The anon/publishable key gets zero access.
alter table strava_auth enable row level security;
alter table activities enable row level security;
