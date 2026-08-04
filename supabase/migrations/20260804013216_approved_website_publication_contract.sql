-- Freeze approved website content, publish it idempotently, and retain every attempt.

alter table public.content_publish_jobs
  add column if not exists approved_payload jsonb,
  add column if not exists approved_content_hash text,
  add column if not exists idempotency_key text,
  add column if not exists destination text,
  add column if not exists approval_event_id uuid references public.content_review_events(id) on delete set null,
  add column if not exists validation_errors jsonb not null default '[]'::jsonb,
  add column if not exists provider_response jsonb not null default '{}'::jsonb,
  add column if not exists last_request_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists retryable boolean not null default true;

alter table public.content_publish_jobs
  alter column scheduled_for drop not null;

alter table public.content_publish_jobs
  drop constraint if exists content_publish_jobs_status_check;
alter table public.content_publish_jobs
  add constraint content_publish_jobs_status_check
  check (status in ('awaiting_schedule','queued','publishing','published','failed','cancelled'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'content_publish_jobs_approved_payload_check'
      and conrelid = 'public.content_publish_jobs'::regclass
  ) then
    alter table public.content_publish_jobs
      add constraint content_publish_jobs_approved_payload_check
      check (approved_payload is null or jsonb_typeof(approved_payload) = 'object');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'content_publish_jobs_validation_errors_check'
      and conrelid = 'public.content_publish_jobs'::regclass
  ) then
    alter table public.content_publish_jobs
      add constraint content_publish_jobs_validation_errors_check
      check (jsonb_typeof(validation_errors) = 'array');
  end if;
end $$;

create index if not exists content_publish_jobs_retry_idx
  on public.content_publish_jobs(status, retryable, next_attempt_at)
  where status in ('queued','failed');

create index if not exists content_publish_jobs_approved_hash_idx
  on public.content_publish_jobs(approved_content_hash)
  where approved_content_hash is not null;

create table if not exists public.content_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  publish_job_id uuid not null references public.content_publish_jobs(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  approved_content_hash text not null,
  idempotency_key text not null,
  request_payload jsonb not null,
  response_status integer,
  response_body jsonb not null default '{}'::jsonb,
  outcome text not null default 'started' check (outcome in ('started','published','validation_failed','failed')),
  error_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (publish_job_id, attempt)
);

create index if not exists content_publish_attempts_item_created_idx
  on public.content_publish_attempts(content_item_id, requested_at desc);

alter table public.content_publish_attempts enable row level security;

drop policy if exists "active members read content_publish_attempts" on public.content_publish_attempts;
create policy "active members read content_publish_attempts"
  on public.content_publish_attempts
  for select
  to authenticated
  using (exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid()) and member.active
  ));

grant select on public.content_publish_attempts to authenticated;
grant all on public.content_publish_attempts to service_role;

update public.content_channels channel
set configuration = coalesce(channel.configuration, '{}'::jsonb) || jsonb_build_object(
  'supported_destinations', jsonb_build_array('resource_library'),
  'default_destination_by_content_type', jsonb_build_object(
    'website-article', 'resource_library',
    'blog', 'resource_library'
  ),
  'content_type_by_destination', jsonb_build_object(
    'resource_library', 'article'
  ),
  'canonical_path_templates', jsonb_build_object(
    'resource_library', '/resources/{slug}/'
  )
)
where channel.platform = 'website'
  and channel.property_id = (
    select property.id from public.content_properties property
    where property.slug = 'herzen-co'
    limit 1
  );

create or replace function public.approve_content_publication(
  p_content_item_id uuid,
  p_review_link_id uuid,
  p_reviewer_name text,
  p_reviewer_email text,
  p_approved_payload jsonb,
  p_approved_content_hash text,
  p_idempotency_key text,
  p_destination text,
  p_scheduled_for timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.content_items%rowtype;
  v_platform text;
  v_event_id uuid;
  v_job_id uuid;
  v_now timestamptz := now();
begin
  if jsonb_typeof(p_approved_payload) <> 'object' then
    raise exception 'approved_payload_must_be_an_object';
  end if;
  if nullif(trim(p_approved_content_hash), '') is null
     or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'approved_content_identity_required';
  end if;
  if p_approved_payload ->> 'content_item_id' is distinct from p_content_item_id::text then
    raise exception 'approved_payload_content_item_mismatch';
  end if;
  if p_approved_payload ->> 'destination' is distinct from p_destination then
    raise exception 'approved_payload_destination_mismatch';
  end if;

  select item.* into v_item
  from public.content_items item
  where item.id = p_content_item_id
  for update;
  if not found then raise exception 'content_item_not_found'; end if;

  select channel.platform into v_platform
  from public.content_channels channel
  where channel.id = v_item.channel_id
    and channel.property_id = v_item.property_id;
  if v_platform <> 'website' then raise exception 'website_channel_required'; end if;

  if p_review_link_id is not null and not exists (
    select 1 from public.content_review_links link
    where link.id = p_review_link_id
      and link.content_item_id = p_content_item_id
      and link.status = 'active'
      and (link.expires_at is null or link.expires_at > v_now)
  ) then
    raise exception 'active_review_link_required';
  end if;

  insert into public.content_review_events (
    content_item_id, review_link_id, event_type, reviewer_name, reviewer_email
  ) values (
    p_content_item_id, p_review_link_id, 'approved',
    nullif(trim(p_reviewer_name), ''), nullif(trim(p_reviewer_email), '')
  ) returning id into v_event_id;

  update public.content_items
  set status = case when p_scheduled_for is null then 'approved' else 'scheduled' end,
      approval_state = 'approved',
      review_approved_at = v_now,
      review_approved_by = coalesce(
        nullif(trim(p_reviewer_name), ''),
        nullif(trim(p_reviewer_email), ''),
        'Herzen reviewer'
      ),
      failure_message = null
  where id = p_content_item_id;

  if v_item.approval_id is not null then
    update public.approvals
    set status = 'approved', decision_note = null, decided_at = v_now
    where id = v_item.approval_id;
  end if;

  insert into public.content_publish_jobs (
    content_item_id, platform, status, attempt, scheduled_for,
    approved_payload, approved_content_hash, idempotency_key, destination,
    approval_event_id, validation_errors, provider_response, failure_message,
    next_attempt_at, retryable
  ) values (
    p_content_item_id, 'website',
    case when p_scheduled_for is null then 'awaiting_schedule' else 'queued' end,
    0, p_scheduled_for, p_approved_payload, p_approved_content_hash,
    p_idempotency_key, p_destination, v_event_id, '[]'::jsonb, '{}'::jsonb,
    null, null, true
  )
  on conflict (content_item_id) do update set
    platform = excluded.platform,
    status = excluded.status,
    attempt = 0,
    scheduled_for = excluded.scheduled_for,
    approved_payload = excluded.approved_payload,
    approved_content_hash = excluded.approved_content_hash,
    idempotency_key = excluded.idempotency_key,
    destination = excluded.destination,
    approval_event_id = excluded.approval_event_id,
    validation_errors = '[]'::jsonb,
    provider_response = '{}'::jsonb,
    external_job_id = null,
    final_url = null,
    failure_message = null,
    published_at = null,
    last_request_at = null,
    next_attempt_at = null,
    retryable = true,
    updated_at = v_now
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.approve_content_publication(uuid, uuid, text, text, jsonb, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.approve_content_publication(uuid, uuid, text, text, jsonb, text, text, text, timestamptz)
  to service_role;

comment on function public.approve_content_publication(uuid, uuid, text, text, jsonb, text, text, text, timestamptz) is
  'Atomically records approval and freezes the exact website payload used by the auditable publish job.';
