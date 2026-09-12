-- Daily Fitness/Fatigue/Form (CTL/ATL/TSB), recomputed from the activities table by
-- /api/calc-pmc. One row per calendar day from the first stored activity to today.
create table if not exists pmc_daily (
  date date primary key,
  daily_load numeric not null default 0,
  ctl numeric not null,
  atl numeric not null,
  tsb numeric not null,
  updated_at timestamptz not null default now()
);

alter table pmc_daily enable row level security;
