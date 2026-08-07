-- Meta accepts a WhatsApp message before it emits a signed delivery receipt.
-- Keep accepted messages nonterminal so OCC cannot report `sent` prematurely.

alter table public.content_delivery_jobs
  add column if not exists provider_delivery_status text,
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists provider_receipt_at timestamptz;

alter table public.content_delivery_jobs
  drop constraint if exists content_delivery_jobs_provider_delivery_status_check;
alter table public.content_delivery_jobs
  add constraint content_delivery_jobs_provider_delivery_status_check
  check (provider_delivery_status is null or provider_delivery_status in ('accepted','sent','delivered','read','failed'));

alter table public.content_delivery_attempts
  add column if not exists provider_status text;
alter table public.content_delivery_attempts
  drop constraint if exists content_delivery_attempts_outcome_check;
alter table public.content_delivery_attempts
  add constraint content_delivery_attempts_outcome_check
  check (outcome in ('started','accepted','confirmed','failed','lease_expired','reconciled'));
alter table public.content_delivery_attempts
  drop constraint if exists content_delivery_attempts_provider_status_check;
alter table public.content_delivery_attempts
  add constraint content_delivery_attempts_provider_status_check
  check (provider_status is null or provider_status in ('accepted','sent','delivered','read','failed'));

create unique index if not exists content_delivery_jobs_provider_message_idx
  on public.content_delivery_jobs(provider_message_id)
  where provider_message_id is not null;

create or replace function public.accept_content_delivery_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_provider_message_id text,
  p_provider_response jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := now();
begin
  if nullif(trim(p_provider_message_id), '') is null then
    raise exception 'provider_message_id_required_for_acceptance';
  end if;

  perform 1 from public.content_delivery_jobs
  where id = p_job_id and status = 'sending' and lease_token = p_lease_token
  for update;
  if not found then return false; end if;

  update public.content_delivery_attempts set
    outcome = 'accepted', provider_status = 'accepted',
    provider_message_id = p_provider_message_id,
    response_body = coalesce(p_provider_response, '{}'::jsonb)
  where delivery_job_id = p_job_id and lease_token = p_lease_token;

  update public.content_delivery_jobs set
    provider_message_id = p_provider_message_id,
    provider_response = coalesce(p_provider_response, '{}'::jsonb),
    provider_delivery_status = 'accepted', provider_accepted_at = v_now,
    -- Webhook receipts are asynchronous. Hold the lease and fail into
    -- recovery_required if no signed evidence arrives within 24 hours.
    lease_expires_at = v_now + interval '24 hours'
  where id = p_job_id;
  return true;
end $$;

create or replace function public.record_content_delivery_receipt(
  p_provider_message_id text,
  p_provider_status text,
  p_provider_response jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.content_delivery_jobs%rowtype;
  v_now timestamptz := now();
begin
  if nullif(trim(p_provider_message_id), '') is null then
    raise exception 'provider_message_id_required_for_receipt';
  end if;
  if p_provider_status not in ('sent','delivered','read','failed') then
    raise exception 'unsupported_provider_delivery_status';
  end if;

  select * into v_job from public.content_delivery_jobs
  where provider_message_id = p_provider_message_id
  order by provider_accepted_at desc nulls last
  limit 1 for update;
  if not found then return null; end if;

  -- Once final delivery is proven, later out-of-order provider events cannot
  -- downgrade or reactivate the job.
  if v_job.status = 'sent' then
    if p_provider_status in ('delivered','read') then
      update public.content_delivery_attempts set
        provider_status = p_provider_status,
        response_body = coalesce(response_body, '{}'::jsonb)
          || jsonb_build_object('latest_receipt', coalesce(p_provider_response, '{}'::jsonb))
      where delivery_job_id = v_job.id and provider_message_id = p_provider_message_id;
      update public.content_delivery_jobs set
        provider_delivery_status = p_provider_status,
        provider_receipt_at = v_now,
        provider_response = coalesce(provider_response, '{}'::jsonb)
          || jsonb_build_object('latest_receipt', coalesce(p_provider_response, '{}'::jsonb))
      where id = v_job.id;
    end if;
    return v_job.id;
  end if;

  if v_job.status <> 'sending' then return v_job.id; end if;

  update public.content_delivery_attempts set
    provider_status = p_provider_status,
    response_body = coalesce(response_body, '{}'::jsonb)
      || jsonb_build_object('latest_receipt', coalesce(p_provider_response, '{}'::jsonb)),
    outcome = case
      when p_provider_status in ('delivered','read') then 'confirmed'
      when p_provider_status = 'failed' then 'failed'
      else outcome
    end,
    error_message = case when p_provider_status = 'failed' then 'Meta reported final delivery failure; manual reconciliation required.' else error_message end,
    completed_at = case when p_provider_status in ('delivered','read','failed') then v_now else completed_at end
  where delivery_job_id = v_job.id and lease_token = v_job.lease_token;

  update public.content_delivery_jobs set
    status = case
      when p_provider_status in ('delivered','read') then 'sent'
      when p_provider_status = 'failed' then 'recovery_required'
      else status
    end,
    provider_delivery_status = p_provider_status,
    provider_receipt_at = v_now,
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || jsonb_build_object('latest_receipt', coalesce(p_provider_response, '{}'::jsonb)),
    sent_at = case when p_provider_status in ('delivered','read') then v_now else sent_at end,
    confirmed_at = case when p_provider_status in ('delivered','read') then v_now else confirmed_at end,
    last_error = case when p_provider_status = 'failed' then 'Meta reported final delivery failure; manual reconciliation required.' else last_error end,
    failure_message = case when p_provider_status = 'failed' then 'Meta reported final delivery failure; manual reconciliation required.' else failure_message end,
    next_attempt_at = case when p_provider_status in ('delivered','read','failed') then null else next_attempt_at end,
    lease_token = case when p_provider_status in ('delivered','read','failed') then null else lease_token end,
    lease_expires_at = case when p_provider_status in ('delivered','read','failed') then null else lease_expires_at end
  where id = v_job.id;
  return v_job.id;
end $$;

revoke all on function public.accept_content_delivery_job(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_content_delivery_receipt(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.accept_content_delivery_job(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.record_content_delivery_receipt(text, text, jsonb) to service_role;
