-- Holds the outcome of each morning readiness check (api/readiness-check.js) that needs a
-- yes/no from the athlete before the day's session is considered adjusted. One row per
-- check_date; the Telegram bot updates `status` when the athlete taps a button.
create table if not exists readiness_pending (
  id bigserial primary key,
  check_date date not null unique,
  chat_id text not null,
  message_id bigint,
  broken_rules jsonb not null,
  adjusted_blocks jsonb not null,
  status text not null default 'pending', -- pending | accepted | declined
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- RLS enabled with no policies: only the service_role key (Vercel functions) can access this.
alter table readiness_pending enable row level security;
