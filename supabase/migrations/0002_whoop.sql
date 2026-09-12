-- Whoop OAuth token storage. Single row (id=1): this dashboard tracks one user.
create table if not exists whoop_auth (
  id smallint primary key default 1,
  user_id bigint,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null, -- epoch seconds
  scope text,
  updated_at timestamptz not null default now(),
  constraint whoop_auth_single_row check (id = 1)
);

-- Physiological cycles (roughly one per day): strain + heart rate summary.
create table if not exists whoop_cycles (
  id bigserial primary key,
  external_id text not null unique, -- Whoop cycle id
  start_at timestamptz,
  end_at timestamptz,
  score_state text,
  strain numeric,
  kilojoule numeric,
  average_heartrate numeric,
  max_heartrate numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- Recovery: one per cycle.
create table if not exists whoop_recovery (
  id bigserial primary key,
  cycle_id text not null unique,
  sleep_id text,
  score_state text,
  recovery_score numeric,
  resting_heart_rate numeric,
  hrv_rmssd_milli numeric,
  spo2_percentage numeric,
  skin_temp_celsius numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);

-- Sleep sessions.
create table if not exists whoop_sleep (
  id bigserial primary key,
  external_id text not null unique, -- Whoop sleep id (uuid)
  cycle_id text,
  start_at timestamptz,
  end_at timestamptz,
  nap boolean default false,
  score_state text,
  sleep_performance_percentage numeric,
  sleep_consistency_percentage numeric,
  sleep_efficiency_percentage numeric,
  respiratory_rate numeric,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whoop_cycles_start_idx on whoop_cycles (start_at);
create index if not exists whoop_sleep_start_idx on whoop_sleep (start_at);

-- RLS enabled with no policies: only the service_role key (Vercel functions) can access these.
alter table whoop_auth enable row level security;
alter table whoop_cycles enable row level security;
alter table whoop_recovery enable row level security;
alter table whoop_sleep enable row level security;
