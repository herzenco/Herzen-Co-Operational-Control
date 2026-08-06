-- Atomic scheduler claims and recoverable, idempotent delivery leases.
-- Existing `sending` rows are deliberately quarantined: they may already have
-- reached WhatsApp, so an operator must reconcile provider evidence first.

alter table public.workflow_runs
  add column if not exists run_key text,
  add column if not exists trigger_source text not null default 'scheduler',
  add column if not exists request_id text,
  add column if not exists responsible_agent text not null default 'occ-content-automation';

create unique index if not exists workflow_runs_run_key_uidx
  on public.workflow_runs(run_key) where run_key is not null;

alter table public.content_delivery_jobs
  add column if not exists idempotency_key text,
  add column if not exists run_id uuid references public.workflow_runs(id) on delete set null,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error text,
  add column if not exists provider_response jsonb not null default '{}'::jsonb,
  add column if not exists confirmed_at timestamptz;

alter table public.content_delivery_jobs drop constraint if exists content_delivery_jobs_status_check;
alter table public.content_delivery_jobs add constraint content_delivery_jobs_status_check
  check (status in ('queued','sending','sent','failed','recovery_required','cancelled'));
alter table public.content_delivery_jobs add constraint content_delivery_jobs_attempt_count_check
  check (attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts);

create unique index if not exists content_delivery_jobs_idempotency_uidx
  on public.content_delivery_jobs(idempotency_key) where idempotency_key is not null;
create index if not exists content_delivery_jobs_claim_idx
  on public.content_delivery_jobs(status, next_attempt_at, scheduled_for)
  where status in ('queued','failed');
create index if not exists content_delivery_jobs_lease_idx
  on public.content_delivery_jobs(lease_expires_at) where status = 'sending';

create table if not exists public.content_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.content_delivery_jobs(id) on delete cascade,
  attempt integer not null check (attempt > 0),
  lease_token uuid not null,
  request_payload jsonb not null,
  response_status integer,
  response_body jsonb not null default '{}'::jsonb,
  provider_message_id text,
  outcome text not null default 'started' check (outcome in ('started','confirmed','failed','lease_expired','reconciled')),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (delivery_job_id, attempt)
);

alter table public.content_delivery_attempts enable row level security;
create policy "active members read content_delivery_attempts" on public.content_delivery_attempts
  for select to authenticated using (exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid()) and member.active
  ));
grant select on public.content_delivery_attempts to authenticated;
grant all on public.content_delivery_attempts to service_role;

-- Never replay pre-lease jobs automatically. Provider logs must be checked and
-- each row explicitly marked sent or returned to queued by an operator.
update public.content_delivery_jobs
set status = 'recovery_required',
    last_error = coalesce(last_error, 'Legacy sending job quarantined during lease migration; reconcile WhatsApp provider evidence before retrying.'),
    failure_message = coalesce(failure_message, 'Legacy sending job quarantined during lease migration; reconcile WhatsApp provider evidence before retrying.'),
    lease_token = null,
    lease_expires_at = null
where status = 'sending' and lease_token is null;

create or replace function public.claim_content_delivery_job(
  p_job_id uuid,
  p_lease_seconds integer default 120
) returns table(job_id uuid, lease_token uuid, attempt integer, payload jsonb, delivery_type text)
language plpgsql security definer set search_path = '' as $$
declare v_job public.content_delivery_jobs%rowtype; v_token uuid := gen_random_uuid();
begin
  update public.content_delivery_jobs job
  set status = 'sending', lease_token = v_token,
      lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      attempt_count = job.attempt_count + 1, last_attempt_at = now(), last_error = null, failure_message = null
  where job.id = p_job_id
    and job.status in ('queued','failed')
    and job.attempt_count < job.max_attempts
    and coalesce(job.next_attempt_at, job.scheduled_for, now()) <= now()
  returning job.* into v_job;
  if not found then return; end if;
  insert into public.content_delivery_attempts(delivery_job_id, attempt, lease_token, request_payload)
  values (v_job.id, v_job.attempt_count, v_token, v_job.payload);
  return query select v_job.id, v_token, v_job.attempt_count, v_job.payload, v_job.delivery_type;
end $$;

create or replace function public.complete_content_delivery_job(
  p_job_id uuid, p_lease_token uuid, p_confirmed boolean,
  p_provider_message_id text default null, p_provider_response jsonb default '{}'::jsonb,
  p_error text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_job public.content_delivery_jobs%rowtype; v_now timestamptz := now();
begin
  select * into v_job from public.content_delivery_jobs
  where id = p_job_id and status = 'sending' and lease_token = p_lease_token for update;
  if not found then return false; end if;
  if p_confirmed and nullif(trim(p_provider_message_id), '') is null then
    raise exception 'provider_message_id_required_for_confirmation';
  end if;
  update public.content_delivery_attempts set
    outcome = case when p_confirmed then 'confirmed' else 'failed' end,
    provider_message_id = p_provider_message_id, response_body = coalesce(p_provider_response, '{}'::jsonb),
    error_message = p_error, completed_at = v_now
  where delivery_job_id = p_job_id and lease_token = p_lease_token;
  update public.content_delivery_jobs set
    status = case when p_confirmed then 'sent' else 'failed' end,
    sent_at = case when p_confirmed then v_now else null end,
    confirmed_at = case when p_confirmed then v_now else null end,
    provider_message_id = p_provider_message_id, provider_response = coalesce(p_provider_response, '{}'::jsonb),
    last_error = p_error, failure_message = p_error,
    next_attempt_at = case when p_confirmed or attempt_count >= max_attempts then null else v_now + make_interval(secs => least(3600, 60 * power(2, greatest(0, attempt_count - 1)))::integer) end,
    lease_token = null, lease_expires_at = null
  where id = p_job_id;
  return true;
end $$;

create or replace function public.expire_content_delivery_leases()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with expired as (
    update public.content_delivery_jobs set status = 'recovery_required',
      last_error = 'Delivery lease expired; reconcile provider evidence before retrying.',
      failure_message = 'Delivery lease expired; reconcile provider evidence before retrying.',
      lease_token = null, lease_expires_at = null
    where status = 'sending' and lease_expires_at < now()
    returning id, attempt_count
  ), attempts as (
    update public.content_delivery_attempts attempt set outcome = 'lease_expired',
      error_message = 'Delivery lease expired before confirmation.', completed_at = now()
    from expired where attempt.delivery_job_id = expired.id and attempt.attempt = expired.attempt_count
  ) select count(*) into v_count from expired;
  return v_count;
end $$;

revoke all on function public.claim_content_delivery_job(uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_content_delivery_job(uuid, uuid, boolean, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.expire_content_delivery_leases() from public, anon, authenticated;
grant execute on function public.claim_content_delivery_job(uuid, integer) to service_role;
grant execute on function public.complete_content_delivery_job(uuid, uuid, boolean, text, jsonb, text) to service_role;
grant execute on function public.expire_content_delivery_leases() to service_role;

-- Rollback (after draining active leases): drop the three functions and
-- content_delivery_attempts, then drop the added columns/indexes. Do not convert
-- recovery_required rows back to queued without provider reconciliation.
