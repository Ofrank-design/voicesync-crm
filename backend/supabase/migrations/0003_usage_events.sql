-- One row per call to an AI provider. No audio, transcripts or keys are stored here.
create table if not exists public.usage_events (
  id             bigint generated always as identity primary key,
  user_id        uuid not null,
  request_id     text,
  at             timestamptz not null default now(),
  step           text not null check (step in ('transcription','extraction')),
  provider       text not null,
  model          text,
  ok             boolean not null,
  error_code     text,
  audio_seconds  numeric,
  input_tokens   integer,
  output_tokens  integer,
  fallback       boolean not null default false,
  duration_ms    integer not null default 0
);
create index if not exists usage_events_at_idx      on public.usage_events (at);
create index if not exists usage_events_user_at_idx on public.usage_events (user_id, at);
-- Browsers cannot read or write this table. Only the API (service role) can.
alter table public.usage_events enable row level security;
