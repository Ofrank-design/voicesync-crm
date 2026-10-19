-- Provider choice saved from the settings screen. Holds provider IDs and model names only, never API keys.
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
-- Row level security on with no policies: browsers (anon or signed in) cannot read or write this table.
-- Only the API, using the service role key, can.
alter table public.app_settings enable row level security;
