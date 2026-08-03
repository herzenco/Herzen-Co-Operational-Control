-- Herzen Co. content automation Phase 1

alter table public.content_items
  add column if not exists paired_content_item_id uuid references public.content_items(id) on delete set null,
  add column if not exists generation_run_id uuid,
  add column if not exists target_audience text,
  add column if not exists conversion_goal text,
  add column if not exists slug text,
  add column if not exists seo_title text,
  add column if not exists meta_description text,
  add column if not exists reasoning_summary text,
  add column if not exists source_links jsonb not null default '[]'::jsonb,
  add column if not exists audit_status text not null default 'pending' check (audit_status in ('pending','running','passed','failed','check_in_required')),
  add column if not exists audit_iteration_count integer not null default 0 check (audit_iteration_count >= 0),
  add column if not exists seo_score integer check (seo_score between 0 and 100),
  add column if not exists aeo_score integer check (aeo_score between 0 and 100),
  add column if not exists audit_summary text,
  add column if not exists audit_blockers jsonb not null default '[]'::jsonb,
  add column if not exists review_ready_at timestamptz,
  add column if not exists review_url text,
  add column if not exists review_approved_at timestamptz,
  add column if not exists review_approved_by text;

create table public.content_generation_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.content_properties(id) on delete restrict,
  month_start date not null,
  status text not null default 'planning' check (status in ('planning','generating','auditing','ready','partial','failed','cancelled')),
  planned_topics jsonb not null default '[]'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, month_start)
);

alter table public.content_items
  add constraint content_items_generation_run_fk foreign key (generation_run_id) references public.content_generation_runs(id) on delete set null;

create table public.content_pairs (
  id uuid primary key default gen_random_uuid(),
  generation_run_id uuid not null references public.content_generation_runs(id) on delete cascade,
  blog_content_item_id uuid not null unique references public.content_items(id) on delete cascade,
  linkedin_content_item_id uuid not null unique references public.content_items(id) on delete cascade,
  topic_key text not null,
  created_at timestamptz not null default now(),
  check (blog_content_item_id <> linkedin_content_item_id),
  unique (generation_run_id, topic_key)
);

create table public.content_audits (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  iteration integer not null check (iteration > 0),
  provider text not null check (provider in ('manus','anthropic')),
  seo_score integer not null check (seo_score between 0 and 100),
  aeo_score integer not null check (aeo_score between 0 and 100),
  passed boolean generated always as (seo_score >= 80 and aeo_score >= 80) stored,
  summary text,
  blockers jsonb not null default '[]'::jsonb,
  rewrite_guidance text,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (content_item_id, iteration)
);

create table public.content_review_links (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null unique references public.content_items(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz
);

create table public.content_review_events (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  review_link_id uuid references public.content_review_links(id) on delete set null,
  event_type text not null check (event_type in ('approved','changes_requested','declined','commented','triaged')),
  comment text,
  reviewer_name text,
  reviewer_email text,
  triaged_by_agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.automation_schedules (
  id uuid primary key default gen_random_uuid(),
  job_type text not null unique check (job_type in ('monthly_generation','weekly_review_pack','publish_day_notice','weekly_k2_refresh','audit_retry')),
  timezone text not null default 'America/New_York',
  schedule_expression text not null,
  next_run_at timestamptz not null,
  enabled boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.automation_schedules(id) on delete set null,
  generation_run_id uuid references public.content_generation_runs(id) on delete set null,
  job_type text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','running','retrying','succeeded','failed','cancelled')),
  attempt integer not null default 0,
  max_attempts integer not null default 5,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (schedule_id, scheduled_for)
);

create table public.workflow_run_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.workflow_runs(id) on delete cascade,
  level text not null check (level in ('debug','info','warn','error')),
  event text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.content_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  delivery_type text not null check (delivery_type in ('weekly_review_pack','publish_day_notice','lupe_check_in')),
  scheduled_for timestamptz not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  provider_message_id text,
  failure_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.content_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  platform text not null check (platform in ('website','linkedin')),
  status text not null default 'queued' check (status in ('queued','publishing','published','failed','cancelled')),
  attempt integer not null default 0,
  external_job_id text,
  final_url text,
  failure_message text,
  scheduled_for timestamptz not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id)
);

create index content_items_generation_run_idx on public.content_items(generation_run_id);
create index content_items_audit_queue_idx on public.content_items(audit_status, audit_iteration_count) where audit_status in ('pending','failed');
create index content_audits_item_created_idx on public.content_audits(content_item_id, created_at desc);
create index content_review_events_item_created_idx on public.content_review_events(content_item_id, created_at desc);
create index workflow_runs_queue_idx on public.workflow_runs(status, retry_at, scheduled_for);
create index content_delivery_jobs_queue_idx on public.content_delivery_jobs(status, scheduled_for);
create index content_publish_jobs_queue_idx on public.content_publish_jobs(status, scheduled_for);

create or replace function private.enforce_content_audit_gate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('ready_for_lupe','awaiting_tito','approved','scheduled','publishing','published')
     and (new.audit_status <> 'passed' or coalesce(new.seo_score, 0) < 80 or coalesce(new.aeo_score, 0) < 80) then
    raise exception 'Content requires SEO and AEO scores of at least 80 before review.';
  end if;
  if new.channel_id is not null and exists (
    select 1 from public.content_channels c where c.id = new.channel_id and c.platform = 'linkedin'
  ) and new.status not in ('idea','research_ready','drafting','blocked','failed','cancelled')
     and (new.final_url is null and (new.metadata->>'website_url') is null) then
    raise exception 'LinkedIn content must link to the website before review.';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_content_audit_gate() from public;
create trigger content_items_audit_gate before insert or update on public.content_items
for each row execute function private.enforce_content_audit_gate();

create or replace function private.validate_content_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare selected_platform text;
begin
  select platform into selected_platform from public.content_channels where id = new.channel_id and property_id = new.property_id;
  if selected_platform is null then raise exception 'The selected channel does not belong to this property.'; end if;
  if new.status in ('approved','scheduled','publishing','published') and new.approval_required
     and ((new.approved_by is null or new.approved_at is null) and new.review_approved_at is null) then
    raise exception 'Content approval must be recorded before content can advance to %.', new.status;
  end if;
  if new.status = 'scheduled' and new.publish_at is null then raise exception 'Scheduled content requires a publish date.'; end if;
  if new.status = 'published' then
    if new.final_url is null or btrim(new.final_url) = '' then raise exception 'Published content requires its final URL.'; end if;
    if selected_platform = 'instagram' and (new.screenshot_path is null or btrim(new.screenshot_path) = '') then raise exception 'Published Instagram content requires screenshot evidence.'; end if;
    new.published_at = coalesce(new.published_at, now());
  end if;
  if new.status = 'failed' and (new.failure_message is null or btrim(new.failure_message) = '') then raise exception 'Failed publishing requires a failure message.'; end if;
  return new;
end;
$$;

alter table public.content_generation_runs enable row level security;
alter table public.content_pairs enable row level security;
alter table public.content_audits enable row level security;
alter table public.content_review_links enable row level security;
alter table public.content_review_events enable row level security;
alter table public.automation_schedules enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_logs enable row level security;
alter table public.content_delivery_jobs enable row level security;
alter table public.content_publish_jobs enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['content_generation_runs','content_pairs','content_audits','content_review_links','content_review_events','automation_schedules','workflow_runs','workflow_run_logs','content_delivery_jobs','content_publish_jobs']
  loop
    execute format('create policy "active members read %1$s" on public.%1$I for select to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active))', table_name);
    execute format('create policy "operators create %1$s" on public.%1$I for insert to authenticated with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in (''owner'',''operator'')))', table_name);
    execute format('create policy "operators update %1$s" on public.%1$I for update to authenticated using (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in (''owner'',''operator''))) with check (exists (select 1 from public.operations_members m where m.user_id = (select auth.uid()) and m.active and m.role in (''owner'',''operator'')))', table_name);
  end loop;
end $$;

grant select, insert, update on public.content_generation_runs, public.content_pairs, public.content_audits,
  public.content_review_links, public.content_review_events, public.automation_schedules, public.workflow_runs,
  public.workflow_run_logs, public.content_delivery_jobs, public.content_publish_jobs to authenticated;
grant usage, select on sequence public.workflow_run_logs_id_seq to authenticated;

insert into public.automation_schedules (job_type, schedule_expression, next_run_at, configuration) values
  ('monthly_generation','last Monday 09:00', '2026-08-31 13:00:00+00', '{"property_slug":"herzen-co"}'),
  ('weekly_review_pack','Monday 09:00', '2026-08-10 13:00:00+00', '{}'),
  ('publish_day_notice','daily 08:00', '2026-08-04 12:00:00+00', '{}'),
  ('weekly_k2_refresh','Monday 07:00', '2026-08-10 11:00:00+00', '{}'),
  ('audit_retry','every 15 minutes', '2026-08-03 14:45:00+00', '{"batch_size":10}')
on conflict (job_type) do nothing;
