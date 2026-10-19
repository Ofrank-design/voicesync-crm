-- VoiceSync CRM: tasks table. Business fields are separate from database-only metadata.

create table if not exists public.crm_tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  client_name     text not null check (length(client_name) between 1 and 200),
  location        text not null default '' check (length(location) <= 300),
  action_item     text not null check (length(action_item) between 1 and 1000),
  follow_up_date  date,
  priority        text not null default 'medium' check (priority in ('low','medium','high')),
  priority_rank   smallint generated always as (case priority when 'high' then 3 when 'medium' then 2 else 1 end) stored,
  status          text not null default 'todo' check (status in ('todo','in_progress','completed')),
  transcript      text,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists crm_tasks_user_idx       on public.crm_tasks (user_id);
create index if not exists crm_tasks_user_status    on public.crm_tasks (user_id, status);
create index if not exists crm_tasks_user_priority  on public.crm_tasks (user_id, priority_rank desc);
create index if not exists crm_tasks_user_followup  on public.crm_tasks (user_id, follow_up_date);
create unique index if not exists crm_tasks_idem    on public.crm_tasks (user_id, idempotency_key) where idempotency_key is not null;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists crm_tasks_updated_at on public.crm_tasks;
create trigger crm_tasks_updated_at before update on public.crm_tasks
  for each row execute function public.set_updated_at();

-- Row Level Security: users only see and change their own rows (defence in depth;
-- the Express API additionally scopes every query by user_id using the service-role key).
alter table public.crm_tasks enable row level security;
drop policy if exists "own tasks select" on public.crm_tasks;
drop policy if exists "own tasks insert" on public.crm_tasks;
drop policy if exists "own tasks update" on public.crm_tasks;
drop policy if exists "own tasks delete" on public.crm_tasks;
create policy "own tasks select" on public.crm_tasks for select using (auth.uid() = user_id);
create policy "own tasks insert" on public.crm_tasks for insert with check (auth.uid() = user_id);
create policy "own tasks update" on public.crm_tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own tasks delete" on public.crm_tasks for delete using (auth.uid() = user_id);
-- No anon policies: anonymous clients cannot read or write.

-- LOCAL DEV ONLY (AUTH_MODE=local): user_id is a fixed UUID with no auth.users row, so remove any FK if you add one.
