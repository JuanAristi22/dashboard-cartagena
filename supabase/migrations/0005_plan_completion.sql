-- Tracks how each planned training-plan block (from WEEKS in training-plan.js) compares
-- against real Strava activities, recomputed by /api/sync every run.
-- status: 'green' (done, close to planned volume), 'yellow' (done but well short/substituted),
-- 'red' (not done). Only rows for dates that have already happened get a status.
create table if not exists plan_completion (
  id bigserial primary key,
  week_n integer not null,
  dow text not null,
  block_index integer not null,
  planned_date date not null,
  sport text,
  label text,
  planned_minutes numeric,
  actual_minutes numeric,
  status text not null,
  matched_activity_id bigint,
  updated_at timestamptz not null default now(),
  unique (week_n, dow, block_index)
);

create index if not exists plan_completion_date_idx on plan_completion (planned_date);

alter table plan_completion enable row level security;
create policy "public read" on plan_completion for select using (true);
