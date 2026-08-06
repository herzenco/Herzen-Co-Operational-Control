-- Run only with automation disabled and no active leases. This restores the
-- pre-lease delivery schema but deliberately leaves recovery_required rows
-- untouched; reconcile them before any later status change. Scheduler run-key
-- columns/indexes are retained because restoring the old (schedule_id,
-- scheduled_for) uniqueness rule would require deleting valid retry history.

drop function if exists public.claim_content_delivery_job(uuid, integer);
drop function if exists public.complete_content_delivery_job(uuid, uuid, boolean, text, jsonb, text);
drop function if exists public.expire_content_delivery_leases();

drop table if exists public.content_delivery_attempts;

drop index if exists public.content_delivery_jobs_lease_idx;
drop index if exists public.content_delivery_jobs_claim_idx;
drop index if exists public.content_delivery_jobs_idempotency_uidx;

alter table public.content_delivery_jobs drop constraint if exists content_delivery_jobs_attempt_count_check;
alter table public.content_delivery_jobs drop constraint if exists content_delivery_jobs_status_check;
alter table public.content_delivery_jobs add constraint content_delivery_jobs_status_check
  check (status in ('queued','sending','sent','failed','cancelled','recovery_required'));

alter table public.content_delivery_jobs
  drop column if exists confirmed_at,
  drop column if exists provider_response,
  drop column if exists last_error,
  drop column if exists lease_expires_at,
  drop column if exists lease_token,
  drop column if exists next_attempt_at,
  drop column if exists last_attempt_at,
  drop column if exists max_attempts,
  drop column if exists attempt_count,
  drop column if exists run_id,
  drop column if exists idempotency_key;
