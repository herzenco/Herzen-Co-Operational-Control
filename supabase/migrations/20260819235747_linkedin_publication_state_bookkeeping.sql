-- Keep LinkedIn publication bookkeeping separate from the canonical content
-- lifecycle. OCC never calls LinkedIn: Lupe claims approved input, publishes
-- externally, and records the result here.

alter table public.content_publish_jobs
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists published_by text,
  add column if not exists failed_step text,
  add column if not exists failed_at timestamptz,
  add column if not exists last_recorded_by text;

alter table public.content_publish_jobs
  drop constraint if exists content_publish_jobs_status_check;
alter table public.content_publish_jobs
  add constraint content_publish_jobs_status_check
  check (status in ('awaiting_schedule','queued','publishing','published','failed','blocked','cancelled'));

-- `publication_state` is the publication lifecycle. `status` remains the
-- content lifecycle and is deliberately not broadened or rewritten here.
alter table public.content_items
  drop constraint if exists content_items_publication_state_check;
alter table public.content_items
  add constraint content_items_publication_state_check
  check (publication_state in ('unpublished','scheduled','publishing','published','failed','blocked'));

create index if not exists content_publish_jobs_linkedin_claim_expiry_idx
  on public.content_publish_jobs(claim_expires_at)
  where platform = 'linkedin' and status = 'publishing';

create table if not exists public.content_publication_events (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  publish_job_id uuid references public.content_publish_jobs(id) on delete cascade,
  platform text not null check (platform in ('website','linkedin')),
  event_type text not null check (event_type in (
    'claim_acquired','claim_reused','claim_conflict','claim_expired',
    'published','failed','blocked'
  )),
  actor text not null,
  failed_step text,
  message text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists content_publication_events_item_occurred_idx
  on public.content_publication_events(content_item_id, occurred_at desc);
create index if not exists content_publication_events_job_occurred_idx
  on public.content_publication_events(publish_job_id, occurred_at desc)
  where publish_job_id is not null;

alter table public.content_publication_events enable row level security;

drop policy if exists "active members read content publication events"
  on public.content_publication_events;
create policy "active members read content publication events"
  on public.content_publication_events
  for select
  to authenticated
  using (exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid()) and member.active
  ));

grant select on public.content_publication_events to authenticated;
grant all on public.content_publication_events to service_role;

-- A pre-migration LinkedIn `publishing` row has no owner or expiry and cannot
-- safely be replayed. Quarantine it for explicit reconciliation without
-- changing the content lifecycle status.
insert into public.content_publication_events (
  content_item_id, publish_job_id, platform, event_type, actor,
  failed_step, message, details
)
select
  job.content_item_id, job.id, 'linkedin', 'failed', 'migration',
  'legacy_claim_reconciliation',
  'Legacy LinkedIn publishing state had no claim owner or expiry and requires reconciliation.',
  jsonb_build_object('previous_status', job.status)
from public.content_publish_jobs job
where job.platform = 'linkedin'
  and job.status = 'publishing'
  and (job.claimed_by is null or job.claim_expires_at is null);

update public.content_items item
set publication_state = 'failed',
    external_status = 'failed',
    failure_message = coalesce(
      item.failure_message,
      'Legacy LinkedIn publishing state requires reconciliation.'
    )
where exists (
  select 1 from public.content_publish_jobs job
  where job.content_item_id = item.id
    and job.platform = 'linkedin'
    and job.status = 'publishing'
    and (job.claimed_by is null or job.claim_expires_at is null)
);

update public.content_publish_jobs job
set status = 'failed',
    failed_step = 'legacy_claim_reconciliation',
    failed_at = now(),
    failure_message = coalesce(
      job.failure_message,
      'Legacy LinkedIn publishing state requires reconciliation.'
    ),
    retryable = false,
    next_attempt_at = null,
    last_recorded_by = 'migration',
    updated_at = now()
where job.platform = 'linkedin'
  and job.status = 'publishing'
  and (job.claimed_by is null or job.claim_expires_at is null);

drop function if exists public.claim_linkedin_publication(uuid, jsonb, text, text);
drop function if exists public.complete_linkedin_publication(uuid, text, text, text, jsonb, timestamptz);
drop function if exists public.fail_linkedin_publication(uuid, text, text, jsonb);

create function public.claim_linkedin_publication(
  p_content_item_id uuid,
  p_approved_payload jsonb,
  p_approved_content_hash text,
  p_idempotency_key text,
  p_claim_owner text,
  p_claim_ttl_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.content_items%rowtype;
  v_job public.content_publish_jobs%rowtype;
  v_platform text;
  v_property_slug text;
  v_channel_status text;
  v_property_status text;
  v_attempt integer;
  v_attempt_id uuid;
  v_event_id uuid;
  v_has_job boolean := false;
  v_now timestamptz := now();
  v_claim_expires_at timestamptz;
begin
  if jsonb_typeof(p_approved_payload) <> 'object' then raise exception 'approved_payload_must_be_an_object'; end if;
  if p_approved_payload ->> 'content_id' is distinct from p_content_item_id::text then raise exception 'approved_payload_content_item_mismatch'; end if;
  if p_approved_payload ->> 'platform' is distinct from 'linkedin' then raise exception 'linkedin_platform_required'; end if;
  if p_approved_payload ->> 'approval_status' is distinct from 'approved' then raise exception 'approved_payload_required'; end if;
  if p_approved_payload #>> '{property,slug}' is distinct from 'herzen-co' then raise exception 'herzen_property_required'; end if;
  if nullif(trim(p_approved_content_hash), '') is null or nullif(trim(p_idempotency_key), '') is null then raise exception 'approved_content_identity_required'; end if;
  if nullif(trim(p_claim_owner), '') is null then raise exception 'linkedin_claim_owner_required'; end if;
  if p_idempotency_key is distinct from ('occ:linkedin:' || p_content_item_id::text) then raise exception 'content_item_idempotency_key_required'; end if;

  v_claim_expires_at := v_now + make_interval(secs => least(3600, greatest(60, coalesce(p_claim_ttl_seconds, 900))));

  select item.* into v_item
  from public.content_items item
  where item.id = p_content_item_id
  for update;
  if not found then raise exception 'content_item_not_found'; end if;

  select channel.platform, property.slug, channel.status, property.status
  into v_platform, v_property_slug, v_channel_status, v_property_status
  from public.content_channels channel
  join public.content_properties property on property.id = channel.property_id
  where channel.id = v_item.channel_id
    and channel.property_id = v_item.property_id;
  if v_platform is distinct from 'linkedin' then raise exception 'linkedin_channel_required'; end if;
  if v_property_slug is distinct from 'herzen-co' then raise exception 'herzen_property_required'; end if;
  if v_channel_status is distinct from 'active' or v_property_status is distinct from 'active' then raise exception 'active_linkedin_destination_required'; end if;
  if v_item.approval_state is distinct from 'approved' then raise exception 'content_item_not_approved'; end if;
  if v_item.approval_id is null or (v_item.review_approved_at is null and v_item.approved_at is null) then raise exception 'completed_occ_approval_required'; end if;
  if v_item.status not in ('approved', 'scheduled', 'publishing', 'published') then raise exception 'approved_publication_state_required'; end if;
  if v_item.audit_status is distinct from 'passed' or coalesce(v_item.seo_score, 0) < 80 or coalesce(v_item.aeo_score, 0) < 80 then raise exception 'seo_aeo_gate_required'; end if;
  if not exists (
    select 1 from public.content_assets asset
    where asset.id = v_item.source_asset_id and asset.content_item_id = v_item.id
      and asset.asset_role = 'source' and asset.is_current
  ) then raise exception 'canonical_source_asset_required'; end if;
  if not exists (
    select 1 from public.content_assets asset
    where asset.id = v_item.delivery_asset_id and asset.content_item_id = v_item.id
      and asset.asset_role = 'delivery' and asset.is_current
  ) then raise exception 'canonical_delivery_asset_required'; end if;
  if v_item.package_manifest ->> 'caption' is distinct from p_approved_payload ->> 'body' then raise exception 'approved_package_manifest_mismatch'; end if;
  if v_item.qa_checklist = '{}'::jsonb or exists (
    select 1 from jsonb_each(v_item.qa_checklist) check_entry
    where check_entry.value is distinct from 'true'::jsonb
  ) then raise exception 'qa_gate_required'; end if;
  if exists (
    select 1 from public.content_feedback feedback
    where feedback.content_item_id = v_item.id and feedback.required
      and feedback.status in ('received', 'blocked')
  ) then raise exception 'required_feedback_unresolved'; end if;

  select job.* into v_job
  from public.content_publish_jobs job
  where job.content_item_id = p_content_item_id
  for update;
  v_has_job := found;

  if v_has_job and v_job.platform is distinct from 'linkedin' then
    raise exception 'content_item_has_non_linkedin_publication_job';
  end if;
  if v_has_job and (v_job.status = 'published' or v_item.publication_state = 'published') then
    return jsonb_build_object(
      'state', 'already_published',
      'job_id', v_job.id,
      'posted_url', coalesce(v_job.final_url, v_item.final_url),
      'published_at', coalesce(v_job.published_at, v_item.published_at)
    );
  end if;

  if v_has_job and v_job.status = 'publishing'
     and (v_job.claim_expires_at is null or v_job.claim_expires_at > v_now) then
    if v_job.claimed_by is not distinct from p_claim_owner then
      insert into public.content_publication_events (
        content_item_id, publish_job_id, platform, event_type, actor, details
      ) values (
        p_content_item_id, v_job.id, 'linkedin', 'claim_reused', p_claim_owner,
        jsonb_build_object('attempt', v_job.attempt, 'claim_expires_at', v_job.claim_expires_at)
      ) returning id into v_event_id;
      return jsonb_build_object(
        'state', 'in_progress',
        'job_id', v_job.id,
        'attempt', v_job.attempt,
        'idempotency_key', v_job.idempotency_key,
        'claimed_by', v_job.claimed_by,
        'claim_expires_at', v_job.claim_expires_at,
        'same_owner', true,
        'event_id', v_event_id
      );
    end if;

    insert into public.content_publication_events (
      content_item_id, publish_job_id, platform, event_type, actor, message, details
    ) values (
      p_content_item_id, v_job.id, 'linkedin', 'claim_conflict', p_claim_owner,
      'LinkedIn publication is already claimed by another owner.',
      jsonb_build_object('claimed_by', v_job.claimed_by, 'claim_expires_at', v_job.claim_expires_at)
    ) returning id into v_event_id;
    return jsonb_build_object(
      'state', 'conflict',
      'job_id', v_job.id,
      'claimed_by', v_job.claimed_by,
      'claim_expires_at', v_job.claim_expires_at,
      'event_id', v_event_id
    );
  end if;

  if v_has_job and v_job.status = 'publishing' then
    update public.content_publish_attempts
    set outcome = 'failed',
        error_message = 'LinkedIn publication claim expired before reconciliation.',
        completed_at = v_now
    where publish_job_id = v_job.id
      and attempt = v_job.attempt
      and outcome = 'started';

    insert into public.content_publication_events (
      content_item_id, publish_job_id, platform, event_type, actor, message, details
    ) values (
      p_content_item_id, v_job.id, 'linkedin', 'claim_expired', p_claim_owner,
      'Expired LinkedIn publication claim requires provider reconciliation before another post.',
      jsonb_build_object('previous_claimed_by', v_job.claimed_by, 'previous_claim_expires_at', v_job.claim_expires_at)
    ) returning id into v_event_id;

    update public.content_publish_jobs
    set status = 'blocked',
        failure_message = 'Expired LinkedIn publication claim requires provider reconciliation before another post.',
        failed_step = 'claim_expired',
        failed_at = v_now,
        retryable = false,
        next_attempt_at = null,
        claim_expires_at = null,
        last_recorded_by = p_claim_owner,
        updated_at = v_now
    where id = v_job.id;

    update public.content_items
    set publication_state = 'blocked',
        external_status = 'blocked',
        failure_message = 'Expired LinkedIn publication claim requires provider reconciliation before another post.'
    where id = p_content_item_id;

    return jsonb_build_object(
      'state', 'stale_claim',
      'should_publish', false,
      'requires_reconciliation', true,
      'job_id', v_job.id,
      'previous_claimed_by', v_job.claimed_by,
      'event_id', v_event_id
    );
  end if;

  if not v_has_job then
    insert into public.content_publish_jobs (
      content_item_id, platform, status, attempt, scheduled_for,
      approved_payload, approved_content_hash, idempotency_key, destination,
      validation_errors, provider_response, last_request_at, next_attempt_at,
      retryable, claimed_by, claimed_at, claim_expires_at, last_recorded_by
    ) values (
      p_content_item_id, 'linkedin', 'publishing', 1, v_item.publish_at,
      p_approved_payload, p_approved_content_hash, p_idempotency_key, 'linkedin',
      '[]'::jsonb, '{}'::jsonb, v_now, null,
      false, p_claim_owner, v_now, v_claim_expires_at, p_claim_owner
    ) returning * into v_job;
    v_attempt := 1;
  else
    v_attempt := v_job.attempt + 1;
    update public.content_publish_jobs
    set status = 'publishing',
        attempt = v_attempt,
        scheduled_for = v_item.publish_at,
        approved_payload = p_approved_payload,
        approved_content_hash = p_approved_content_hash,
        idempotency_key = p_idempotency_key,
        destination = 'linkedin',
        validation_errors = '[]'::jsonb,
        provider_response = '{}'::jsonb,
        external_job_id = null,
        final_url = null,
        failure_message = null,
        published_at = null,
        published_by = null,
        failed_step = null,
        failed_at = null,
        last_request_at = v_now,
        next_attempt_at = null,
        retryable = false,
        claimed_by = p_claim_owner,
        claimed_at = v_now,
        claim_expires_at = v_claim_expires_at,
        last_recorded_by = p_claim_owner,
        updated_at = v_now
    where id = v_job.id
    returning * into v_job;
  end if;

  insert into public.content_publish_attempts (
    publish_job_id, content_item_id, attempt, approved_content_hash,
    idempotency_key, request_payload
  ) values (
    v_job.id, p_content_item_id, v_attempt, p_approved_content_hash,
    p_idempotency_key, p_approved_payload
  ) returning id into v_attempt_id;

  insert into public.content_publication_events (
    content_item_id, publish_job_id, platform, event_type, actor, details
  ) values (
    p_content_item_id, v_job.id, 'linkedin', 'claim_acquired', p_claim_owner,
    jsonb_build_object(
      'attempt', v_attempt,
      'attempt_id', v_attempt_id,
      'claim_expires_at', v_claim_expires_at
    )
  ) returning id into v_event_id;

  update public.content_items
  set publication_state = 'publishing',
      external_status = 'claimed',
      failure_message = null
  where id = p_content_item_id;

  return jsonb_build_object(
    'state', 'claimed',
    'job_id', v_job.id,
    'attempt_id', v_attempt_id,
    'attempt', v_attempt,
    'idempotency_key', p_idempotency_key,
    'claimed_by', p_claim_owner,
    'claimed_at', v_now,
    'claim_expires_at', v_claim_expires_at,
    'event_id', v_event_id
  );
end;
$$;

create function public.complete_linkedin_publication(
  p_content_item_id uuid,
  p_idempotency_key text,
  p_final_url text,
  p_external_id text,
  p_publishing_actor text,
  p_recorded_by text,
  p_provider_response jsonb,
  p_published_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.content_publish_jobs%rowtype;
  v_event_id uuid;
  v_published_at timestamptz := coalesce(p_published_at, now());
begin
  if nullif(trim(p_final_url), '') is null or p_final_url !~ '^https://([^/]+\.)?linkedin\.com/' then raise exception 'valid_linkedin_final_url_required'; end if;
  if nullif(trim(p_publishing_actor), '') is null then raise exception 'publishing_actor_required'; end if;
  if nullif(trim(p_recorded_by), '') is null then raise exception 'publication_recorder_required'; end if;

  select job.* into v_job
  from public.content_publish_jobs job
  where job.content_item_id = p_content_item_id
  for update;
  if not found or v_job.platform is distinct from 'linkedin' then raise exception 'linkedin_publication_claim_required'; end if;
  if v_job.idempotency_key is distinct from p_idempotency_key then raise exception 'idempotency_key_mismatch'; end if;
  if v_job.status = 'published' then
    return jsonb_build_object(
      'state', 'already_published',
      'job_id', v_job.id,
      'posted_url', v_job.final_url,
      'published_at', v_job.published_at,
      'publishing_actor', v_job.published_by
    );
  end if;
  if v_job.status is distinct from 'publishing' then raise exception 'linkedin_publication_claim_required'; end if;
  if v_job.claimed_by is distinct from p_recorded_by then raise exception 'linkedin_claim_owner_mismatch'; end if;

  update public.content_publish_attempts
  set outcome = 'published',
      response_status = 200,
      response_body = coalesce(p_provider_response, '{}'::jsonb),
      completed_at = now()
  where publish_job_id = v_job.id and attempt = v_job.attempt;

  update public.content_publish_jobs
  set status = 'published',
      final_url = p_final_url,
      external_job_id = nullif(trim(p_external_id), ''),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      failure_message = null,
      validation_errors = '[]'::jsonb,
      retryable = false,
      next_attempt_at = null,
      published_at = v_published_at,
      published_by = p_publishing_actor,
      failed_step = null,
      failed_at = null,
      claim_expires_at = null,
      last_recorded_by = p_recorded_by,
      updated_at = now()
  where id = v_job.id;

  insert into public.content_publication_events (
    content_item_id, publish_job_id, platform, event_type, actor, details, occurred_at
  ) values (
    p_content_item_id, v_job.id, 'linkedin', 'published', p_recorded_by,
    jsonb_build_object(
      'posted_url', p_final_url,
      'publishing_actor', p_publishing_actor,
      'external_id', nullif(trim(p_external_id), '')
    ),
    v_published_at
  ) returning id into v_event_id;

  update public.content_items
  set publication_state = 'published',
      final_url = p_final_url,
      published_at = v_published_at,
      external_job_id = nullif(trim(p_external_id), ''),
      external_status = 'published',
      failure_message = null
  where id = p_content_item_id;

  return jsonb_build_object(
    'state', 'published',
    'job_id', v_job.id,
    'posted_url', p_final_url,
    'published_at', v_published_at,
    'publishing_actor', p_publishing_actor,
    'event_id', v_event_id
  );
end;
$$;

create function public.fail_linkedin_publication(
  p_content_item_id uuid,
  p_idempotency_key text,
  p_failure_status text,
  p_failure_step text,
  p_failure_message text,
  p_recorded_by text,
  p_provider_response jsonb,
  p_failed_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.content_items%rowtype;
  v_job public.content_publish_jobs%rowtype;
  v_platform text;
  v_event_id uuid;
  v_has_job boolean := false;
  v_failed_at timestamptz := coalesce(p_failed_at, now());
  v_idempotency_key text := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'occ:linkedin:' || p_content_item_id::text
  );
begin
  if p_failure_status is null or p_failure_status not in ('failed', 'blocked') then raise exception 'invalid_linkedin_failure_status'; end if;
  if nullif(trim(p_failure_step), '') is null then raise exception 'failure_step_required'; end if;
  if nullif(trim(p_failure_message), '') is null then raise exception 'failure_message_required'; end if;
  if nullif(trim(p_recorded_by), '') is null then raise exception 'publication_recorder_required'; end if;
  if v_idempotency_key is distinct from ('occ:linkedin:' || p_content_item_id::text) then raise exception 'content_item_idempotency_key_required'; end if;

  select item.* into v_item
  from public.content_items item
  where item.id = p_content_item_id
  for update;
  if not found then raise exception 'content_item_not_found'; end if;

  select channel.platform into v_platform
  from public.content_channels channel
  where channel.id = v_item.channel_id
    and channel.property_id = v_item.property_id;
  if v_platform is distinct from 'linkedin' then raise exception 'linkedin_channel_required'; end if;

  select job.* into v_job
  from public.content_publish_jobs job
  where job.content_item_id = p_content_item_id
  for update;
  v_has_job := found;

  if v_has_job and v_job.platform is distinct from 'linkedin' then
    raise exception 'content_item_has_non_linkedin_publication_job';
  end if;

  if v_has_job and v_job.status = 'published' then
    insert into public.content_publication_events (
      content_item_id, publish_job_id, platform, event_type, actor,
      failed_step, message, details, occurred_at
    ) values (
      p_content_item_id, v_job.id, 'linkedin', p_failure_status, p_recorded_by,
      p_failure_step, p_failure_message,
      jsonb_build_object('ignored_because', 'already_published'),
      v_failed_at
    ) returning id into v_event_id;
    return jsonb_build_object(
      'state', 'already_published',
      'failure_recorded', true,
      'job_id', v_job.id,
      'posted_url', v_job.final_url,
      'event_id', v_event_id
    );
  end if;

  -- A failed competing claim is auditable but must not release another
  -- owner's active lock or permit a duplicate post.
  if v_has_job and v_job.status = 'publishing'
     and v_job.claimed_by is distinct from p_recorded_by
     and (v_job.claim_expires_at is null or v_job.claim_expires_at > v_failed_at) then
    insert into public.content_publication_events (
      content_item_id, publish_job_id, platform, event_type, actor,
      failed_step, message, details, occurred_at
    ) values (
      p_content_item_id, v_job.id, 'linkedin', p_failure_status, p_recorded_by,
      p_failure_step, p_failure_message,
      jsonb_build_object(
        'claim_preserved', true,
        'claimed_by', v_job.claimed_by,
        'claim_expires_at', v_job.claim_expires_at,
        'provider_response', coalesce(p_provider_response, '{}'::jsonb)
      ),
      v_failed_at
    ) returning id into v_event_id;
    return jsonb_build_object(
      'state', 'in_progress',
      'failure_recorded', true,
      'job_id', v_job.id,
      'claimed_by', v_job.claimed_by,
      'claim_expires_at', v_job.claim_expires_at,
      'event_id', v_event_id
    );
  end if;

  if not v_has_job then
    insert into public.content_publish_jobs (
      content_item_id, platform, status, attempt, scheduled_for,
      idempotency_key, destination, validation_errors, provider_response,
      failure_message, retryable, next_attempt_at, failed_step, failed_at,
      last_recorded_by
    ) values (
      p_content_item_id, 'linkedin', p_failure_status, 0, v_item.publish_at,
      v_idempotency_key, 'linkedin', '[]'::jsonb,
      coalesce(p_provider_response, '{}'::jsonb), p_failure_message,
      false, null, p_failure_step, v_failed_at, p_recorded_by
    ) returning * into v_job;
  else
    if v_job.status = 'publishing' then
      update public.content_publish_attempts
      set outcome = 'failed',
          response_body = coalesce(p_provider_response, '{}'::jsonb),
          error_message = p_failure_message,
          completed_at = v_failed_at
      where publish_job_id = v_job.id
        and attempt = v_job.attempt
        and outcome = 'started';
    end if;

    update public.content_publish_jobs
    set status = p_failure_status,
        idempotency_key = v_idempotency_key,
        failure_message = p_failure_message,
        provider_response = coalesce(p_provider_response, '{}'::jsonb),
        retryable = false,
        next_attempt_at = null,
        failed_step = p_failure_step,
        failed_at = v_failed_at,
        claim_expires_at = null,
        last_recorded_by = p_recorded_by,
        updated_at = now()
    where id = v_job.id
    returning * into v_job;
  end if;

  insert into public.content_publication_events (
    content_item_id, publish_job_id, platform, event_type, actor,
    failed_step, message, details, occurred_at
  ) values (
    p_content_item_id, v_job.id, 'linkedin', p_failure_status, p_recorded_by,
    p_failure_step, p_failure_message,
    jsonb_build_object('provider_response', coalesce(p_provider_response, '{}'::jsonb)),
    v_failed_at
  ) returning id into v_event_id;

  update public.content_items
  set publication_state = p_failure_status,
      external_status = p_failure_status,
      failure_message = p_failure_message
  where id = p_content_item_id;

  return jsonb_build_object(
    'state', p_failure_status,
    'failure_recorded', true,
    'job_id', v_job.id,
    'failed_step', p_failure_step,
    'failure_message', p_failure_message,
    'failed_at', v_failed_at,
    'event_id', v_event_id
  );
end;
$$;

revoke all on function public.claim_linkedin_publication(uuid, jsonb, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_linkedin_publication(uuid, text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_linkedin_publication(uuid, text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_linkedin_publication(uuid, jsonb, text, text, text, integer)
  to service_role;
grant execute on function public.complete_linkedin_publication(uuid, text, text, text, text, text, jsonb, timestamptz)
  to service_role;
grant execute on function public.fail_linkedin_publication(uuid, text, text, text, text, text, jsonb, timestamptz)
  to service_role;

comment on function public.claim_linkedin_publication(uuid, jsonb, text, text, text, integer) is
  'Atomically acquires an owner-scoped, expiring LinkedIn bookkeeping claim without changing content_items.status or calling LinkedIn.';
comment on function public.complete_linkedin_publication(uuid, text, text, text, text, text, jsonb, timestamptz) is
  'Records the verified LinkedIn URL, timestamp, and publishing actor without calling LinkedIn or changing content_items.status.';
comment on function public.fail_linkedin_publication(uuid, text, text, text, text, text, jsonb, timestamptz) is
  'Records failed or blocked LinkedIn publication state at any stage, including before a successful claim, without changing content_items.status.';
