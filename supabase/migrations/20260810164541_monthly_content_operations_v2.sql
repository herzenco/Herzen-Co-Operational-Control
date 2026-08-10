-- Executable Monthly Content Operations lifecycle. Legacy Phase 1 schedules
-- remain disabled; this migration does not enqueue publication or delivery.

alter table public.content_items
  drop constraint if exists content_items_status_check;

-- Existing records are mapped without deleting history or creating replacements.
update public.content_items set status = case status
  when 'idea' then 'planned'
  when 'awaiting_tito' then 'ready_for_tito'
  when 'revision_requested' then 'revision_required'
  when 'publishing' then 'scheduled'
  when 'failed' then 'recovery_required'
  else status end;

alter table public.content_items
  add constraint content_items_status_check check (status in (
    'planned','research_pending','research_ready','editorial_ready','drafting',
    'qa_in_progress','revision_required','ready_for_lupe','ready_for_tito',
    'approved','scheduled','published','performance_tracking','completed',
    'blocked','recovery_required','rejected','cancelled','archived','superseded'
  )),
  add column if not exists monthly_ops_request_id text,
  add column if not exists monthly_ops_version integer not null default 2,
  add column if not exists workflow_key text,
  add column if not exists stage_owner_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists next_action text,
  add column if not exists blocker text,
  add column if not exists blocker_owner_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists last_meaningful_activity_at timestamptz,
  add column if not exists recovery_count integer not null default 0 check (recovery_count >= 0),
  add column if not exists human_review_url text;

create unique index if not exists content_items_monthly_workflow_key_uidx
  on public.content_items(workflow_key) where workflow_key is not null;
create index if not exists content_items_monthly_watchdog_idx
  on public.content_items(status, last_meaningful_activity_at)
  where status in ('research_pending','research_ready','editorial_ready','drafting','qa_in_progress','revision_required','ready_for_lupe','ready_for_tito','blocked','recovery_required');
create unique index if not exists agent_work_items_monthly_lupe_uidx
  on public.agent_work_items(content_item_id, lane)
  where lane = 'monthly_content_lupe';

create table public.monthly_content_stage_jobs (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  request_id text not null,
  run_id uuid references public.workflow_runs(id) on delete set null,
  stage text not null,
  owner_agent_id uuid references public.agents(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','retrying','succeeded','failed','recovery_required','cancelled')),
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  idempotency_key text not null unique,
  lease_token uuid,
  lease_expires_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  failure_message text,
  retry_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.monthly_content_transition_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('agent','human','system','watchdog','migration')),
  actor_id text not null,
  reason text not null,
  run_id uuid references public.workflow_runs(id) on delete set null,
  job_id uuid references public.monthly_content_stage_jobs(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  retry_count integer not null default 0,
  next_action text,
  created_at timestamptz not null default now()
);

create table public.monthly_content_revisions (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  job_id uuid references public.monthly_content_stage_jobs(id) on delete set null,
  revision integer not null check (revision > 0),
  reason text not null,
  prior_snapshot jsonb not null,
  revised_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (content_item_id, revision)
);

create index monthly_content_stage_jobs_queue_idx on public.monthly_content_stage_jobs(status, retry_at, lease_expires_at);
create index monthly_content_transition_events_item_idx on public.monthly_content_transition_events(content_item_id, created_at desc);
create index monthly_content_revisions_item_idx on public.monthly_content_revisions(content_item_id, revision desc);

alter table public.monthly_content_stage_jobs enable row level security;
alter table public.monthly_content_transition_events enable row level security;
alter table public.monthly_content_revisions enable row level security;

create policy "members read monthly content jobs" on public.monthly_content_stage_jobs for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "operators manage monthly content jobs" on public.monthly_content_stage_jobs for all to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')))
with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in ('owner','operator')));
create policy "members read monthly content transitions" on public.monthly_content_transition_events for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));
create policy "members read monthly content revisions" on public.monthly_content_revisions for select to authenticated
using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active));

grant select, insert, update on public.monthly_content_stage_jobs to authenticated;
grant select on public.monthly_content_transition_events, public.monthly_content_revisions to authenticated;

create or replace function private.enforce_content_audit_gate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('ready_for_lupe','ready_for_tito','approved','scheduled','published','performance_tracking','completed')
     and (new.audit_status <> 'passed' or coalesce(new.seo_score, 0) < 80 or coalesce(new.aeo_score, 0) < 80) then
    raise exception 'Content requires SEO and AEO scores of at least 80 before review.';
  end if;
  if new.channel_id is not null and exists (select 1 from public.content_channels c where c.id = new.channel_id and c.platform = 'linkedin')
     and new.status not in ('planned','research_pending','research_ready','editorial_ready','drafting','qa_in_progress','revision_required','blocked','recovery_required','rejected','cancelled','archived','superseded')
     and (new.final_url is null and (new.metadata->>'website_url') is null) then
    raise exception 'LinkedIn content must link to the website before review.';
  end if;
  return new;
end; $$;

-- Recurrence remains intentionally disabled during controlled rollout.
alter table public.automation_schedules drop constraint if exists automation_schedules_job_type_check;
alter table public.automation_schedules add constraint automation_schedules_job_type_check check (job_type in (
  'monthly_generation','weekly_review_pack','publish_day_notice','weekly_k2_refresh','audit_retry',
  'monthly_content_item','monthly_content_watchdog'
));
insert into public.automation_schedules(job_type,schedule_expression,next_run_at,enabled,configuration)
values
  ('monthly_content_item','0 8 1 * *',timezone('utc',now()) + interval '30 days',false,'{"rollout":"shadow","publishing_enabled":false}'::jsonb),
  ('monthly_content_watchdog','*/15 * * * *',timezone('utc',now()) + interval '15 minutes',false,'{"rollout":"shadow","publishing_enabled":false}'::jsonb)
on conflict (job_type) do update set enabled=false, configuration=excluded.configuration;
