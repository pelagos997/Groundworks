-- Groundwork phone operations data product.
-- Apply with `supabase db push` after linking the target project.

create table if not exists public.phone_webhook_events (
  provider_event_id text primary key,
  project_id text not null,
  provider text not null default 'agentphone',
  event_type text not null,
  channel text not null,
  agent_id text,
  number_id text,
  conversation_id text,
  call_id text,
  message_id text,
  from_number text,
  to_number text,
  direction text,
  occurred_at timestamptz not null,
  processing_status text not null default 'received',
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phone_calls (
  provider_call_id text primary key,
  project_id text not null,
  provider text not null default 'agentphone',
  agent_id text,
  number_id text,
  from_number text,
  to_number text,
  direction text,
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  summary text,
  disclosure_given boolean not null default false,
  transcription_consent boolean not null default false,
  procurement_request_id text,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phone_transcript_turns (
  provider_turn_id text primary key,
  project_id text not null,
  provider_call_id text not null references public.phone_calls(provider_call_id) on delete cascade,
  turn_index integer not null check (turn_index >= 0),
  speaker text,
  direction text,
  content text not null,
  occurred_at timestamptz,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  unique (provider_call_id, turn_index)
);

create table if not exists public.phone_messages (
  provider_message_id text primary key,
  project_id text not null,
  provider text not null default 'agentphone',
  agent_id text,
  number_id text,
  conversation_id text,
  from_number text,
  to_number text,
  direction text,
  channel text not null,
  status text,
  body text,
  sent_at timestamptz,
  delivered_at timestamptz,
  procurement_request_id text,
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phone_media (
  provider_media_id text primary key,
  project_id text not null,
  provider_message_id text references public.phone_messages(provider_message_id) on delete cascade,
  storage_key text,
  content_type text,
  bytes bigint check (bytes is null or bytes >= 0),
  sha256 text,
  visibility text not null default 'private' check (visibility = 'private'),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.phone_sync_runs (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  provider text not null default 'agentphone',
  status text not null,
  calls_seen integer not null default 0,
  messages_seen integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists phone_events_project_time_idx on public.phone_webhook_events(project_id, occurred_at desc);
create index if not exists phone_events_call_idx on public.phone_webhook_events(call_id, occurred_at);
create index if not exists phone_calls_project_time_idx on public.phone_calls(project_id, started_at desc);
create index if not exists phone_calls_status_idx on public.phone_calls(project_id, status, updated_at desc);
create index if not exists phone_turns_call_idx on public.phone_transcript_turns(provider_call_id, turn_index);
create index if not exists phone_messages_conversation_idx on public.phone_messages(conversation_id, sent_at);
create index if not exists phone_messages_project_time_idx on public.phone_messages(project_id, sent_at desc);
create index if not exists phone_media_message_idx on public.phone_media(provider_message_id);

create or replace function public.set_groundwork_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists phone_webhook_events_updated_at on public.phone_webhook_events;
create trigger phone_webhook_events_updated_at before update on public.phone_webhook_events
for each row execute function public.set_groundwork_updated_at();

drop trigger if exists phone_calls_updated_at on public.phone_calls;
create trigger phone_calls_updated_at before update on public.phone_calls
for each row execute function public.set_groundwork_updated_at();

drop trigger if exists phone_messages_updated_at on public.phone_messages;
create trigger phone_messages_updated_at before update on public.phone_messages
for each row execute function public.set_groundwork_updated_at();

alter table public.phone_webhook_events enable row level security;
alter table public.phone_calls enable row level security;
alter table public.phone_transcript_turns enable row level security;
alter table public.phone_messages enable row level security;
alter table public.phone_media enable row level security;
alter table public.phone_sync_runs enable row level security;

revoke all on table public.phone_webhook_events from anon, authenticated;
revoke all on table public.phone_calls from anon, authenticated;
revoke all on table public.phone_transcript_turns from anon, authenticated;
revoke all on table public.phone_messages from anon, authenticated;
revoke all on table public.phone_media from anon, authenticated;
revoke all on table public.phone_sync_runs from anon, authenticated;

grant select, insert, update, delete on table public.phone_webhook_events to service_role;
grant select, insert, update, delete on table public.phone_calls to service_role;
grant select, insert, update, delete on table public.phone_transcript_turns to service_role;
grant select, insert, update, delete on table public.phone_messages to service_role;
grant select, insert, update, delete on table public.phone_media to service_role;
grant select, insert, update, delete on table public.phone_sync_runs to service_role;

create or replace function public.purge_expired_groundwork_phone_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_events integer;
  deleted_calls integer;
  deleted_messages integer;
begin
  delete from public.phone_webhook_events where expires_at < now();
  get diagnostics deleted_events = row_count;
  delete from public.phone_calls where expires_at < now();
  get diagnostics deleted_calls = row_count;
  delete from public.phone_messages where expires_at < now();
  get diagnostics deleted_messages = row_count;
  return jsonb_build_object('events', deleted_events, 'calls', deleted_calls, 'messages', deleted_messages);
end;
$$;

revoke all on function public.purge_expired_groundwork_phone_data() from public, anon, authenticated;
grant execute on function public.purge_expired_groundwork_phone_data() to service_role;
