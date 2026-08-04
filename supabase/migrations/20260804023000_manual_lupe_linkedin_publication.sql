-- Manual, Lupe-triggered LinkedIn publication claims and result writeback.
-- OCC never calls LinkedIn from these functions. It only freezes the approved
-- input, prevents duplicate claims, and stores Lupe's result.

create or replace function public.claim_linkedin_publication(
  p_content_item_id uuid,
  p_approved_payload jsonb,
  p_approved_content_hash text,
  p_idempotency_key text
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
  v_now timestamptz := now();
begin
  if jsonb_typeof(p_approved_payload) <> 'object' then raise exception 'approved_payload_must_be_an_object'; end if;
  if p_approved_payload ->> 'content_id' is distinct from p_content_item_id::text then raise exception 'approved_payload_content_item_mismatch'; end if;
  if p_approved_payload ->> 'platform' is distinct from 'linkedin' then raise exception 'linkedin_platform_required'; end if;
  if p_approved_payload ->> 'approval_status' is distinct from 'approved' then raise exception 'approved_payload_required'; end if;
  if p_approved_payload #>> '{property,slug}' is distinct from 'herzen-co' then raise exception 'herzen_property_required'; end if;
  if nullif(trim(p_approved_content_hash), '') is null or nullif(trim(p_idempotency_key), '') is null then raise exception 'approved_content_identity_required'; end if;
  if p_idempotency_key is distinct from ('occ:linkedin:' || p_content_item_id::text) then raise exception 'content_item_idempotency_key_required'; end if;

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
    select 1 from jsonb_each(v_item.qa_checklist) check_entry where check_entry.value is distinct from 'true'::jsonb
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

  if found and (v_job.status = 'published' or v_item.publication_state = 'published') then
    return jsonb_build_object('state', 'already_published', 'job_id', v_job.id, 'final_url', coalesce(v_job.final_url, v_item.final_url));
  end if;
  if found and v_job.platform is distinct from 'linkedin' then raise exception 'content_item_has_non_linkedin_publication_job'; end if;
  if found and v_job.status = 'publishing' then
    return jsonb_build_object('state', 'in_progress', 'job_id', v_job.id, 'idempotency_key', v_job.idempotency_key);
  end if;

  if not found then
    insert into public.content_publish_jobs (
      content_item_id, platform, status, attempt, scheduled_for,
      approved_payload, approved_content_hash, idempotency_key, destination,
      validation_errors, provider_response, last_request_at, next_attempt_at,
      retryable
    ) values (
      p_content_item_id, 'linkedin', 'publishing', 1, v_item.publish_at,
      p_approved_payload, p_approved_content_hash, p_idempotency_key, 'linkedin',
      '[]'::jsonb, '{}'::jsonb, v_now, null, false
    ) returning * into v_job;
    v_attempt := 1;
  else
    v_attempt := v_job.attempt + 1;
    update public.content_publish_jobs
    set status = 'publishing', attempt = v_attempt, scheduled_for = v_item.publish_at,
        approved_payload = p_approved_payload, approved_content_hash = p_approved_content_hash,
        idempotency_key = p_idempotency_key, destination = 'linkedin',
        validation_errors = '[]'::jsonb, provider_response = '{}'::jsonb,
        external_job_id = null, final_url = null, failure_message = null,
        published_at = null, last_request_at = v_now, next_attempt_at = null,
        retryable = false, updated_at = v_now
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

  update public.content_items
  set status = 'publishing', publication_state = 'publishing', failure_message = null
  where id = p_content_item_id;

  return jsonb_build_object(
    'state', 'claimed', 'job_id', v_job.id, 'attempt_id', v_attempt_id,
    'attempt', v_attempt, 'idempotency_key', p_idempotency_key
  );
end;
$$;

create or replace function public.complete_linkedin_publication(
  p_content_item_id uuid,
  p_idempotency_key text,
  p_final_url text,
  p_external_id text,
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
  v_published_at timestamptz := coalesce(p_published_at, now());
begin
  if nullif(trim(p_final_url), '') is null or p_final_url !~ '^https://([^/]+\.)?linkedin\.com/' then raise exception 'valid_linkedin_final_url_required'; end if;
  select job.* into v_job from public.content_publish_jobs job
  where job.content_item_id = p_content_item_id for update;
  if not found or v_job.platform is distinct from 'linkedin' then raise exception 'linkedin_publication_claim_required'; end if;
  if v_job.idempotency_key is distinct from p_idempotency_key then raise exception 'idempotency_key_mismatch'; end if;
  if v_job.status = 'published' then
    return jsonb_build_object('state', 'already_published', 'job_id', v_job.id, 'final_url', v_job.final_url);
  end if;
  if v_job.status is distinct from 'publishing' then raise exception 'linkedin_publication_claim_required'; end if;

  update public.content_publish_attempts
  set outcome = 'published', response_status = 200,
      response_body = coalesce(p_provider_response, '{}'::jsonb), completed_at = now()
  where publish_job_id = v_job.id and attempt = v_job.attempt;
  update public.content_publish_jobs
  set status = 'published', final_url = p_final_url,
      external_job_id = nullif(trim(p_external_id), ''),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      failure_message = null, validation_errors = '[]'::jsonb,
      retryable = false, next_attempt_at = null, published_at = v_published_at,
      updated_at = now()
  where id = v_job.id;
  update public.content_items
  set status = 'published', publication_state = 'published', final_url = p_final_url,
      published_at = v_published_at, external_job_id = nullif(trim(p_external_id), ''),
      external_status = 'published', failure_message = null
  where id = p_content_item_id;
  return jsonb_build_object('state', 'published', 'job_id', v_job.id, 'final_url', p_final_url, 'published_at', v_published_at);
end;
$$;

create or replace function public.fail_linkedin_publication(
  p_content_item_id uuid,
  p_idempotency_key text,
  p_failure_message text,
  p_provider_response jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.content_publish_jobs%rowtype;
begin
  if nullif(trim(p_failure_message), '') is null then raise exception 'failure_message_required'; end if;
  select job.* into v_job from public.content_publish_jobs job
  where job.content_item_id = p_content_item_id for update;
  if not found or v_job.platform is distinct from 'linkedin' then raise exception 'linkedin_publication_claim_required'; end if;
  if v_job.idempotency_key is distinct from p_idempotency_key then raise exception 'idempotency_key_mismatch'; end if;
  if v_job.status = 'published' then
    return jsonb_build_object('state', 'already_published', 'job_id', v_job.id, 'final_url', v_job.final_url);
  end if;
  if v_job.status is distinct from 'publishing' then
    return jsonb_build_object('state', 'failed', 'job_id', v_job.id, 'failure_message', v_job.failure_message);
  end if;

  update public.content_publish_attempts
  set outcome = 'failed', response_body = coalesce(p_provider_response, '{}'::jsonb),
      error_message = p_failure_message, completed_at = now()
  where publish_job_id = v_job.id and attempt = v_job.attempt;
  update public.content_publish_jobs
  set status = 'failed', failure_message = p_failure_message,
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      retryable = false, next_attempt_at = null, updated_at = now()
  where id = v_job.id;
  update public.content_items
  set status = 'approved', publication_state = 'failed', failure_message = p_failure_message
  where id = p_content_item_id;
  return jsonb_build_object('state', 'failed', 'job_id', v_job.id, 'failure_message', p_failure_message);
end;
$$;

revoke all on function public.claim_linkedin_publication(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.complete_linkedin_publication(uuid, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_linkedin_publication(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_linkedin_publication(uuid, jsonb, text, text) to service_role;
grant execute on function public.complete_linkedin_publication(uuid, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_linkedin_publication(uuid, text, text, jsonb) to service_role;

comment on function public.claim_linkedin_publication(uuid, jsonb, text, text) is
  'Atomically claims one approved Herzen Co. LinkedIn item for manual Lupe publication without outbound OCC delivery.';
comment on function public.complete_linkedin_publication(uuid, text, text, text, jsonb, timestamptz) is
  'Idempotently records the final URL returned by Lupe after LinkedIn publication.';
