begin;

drop function if exists public.record_content_delivery_receipt(text, text, jsonb);
drop function if exists public.accept_content_delivery_job(uuid, uuid, text, jsonb);
drop index if exists public.content_delivery_jobs_provider_message_idx;

alter table public.content_delivery_attempts
  drop constraint if exists content_delivery_attempts_provider_status_check,
  drop column if exists provider_status;
alter table public.content_delivery_attempts
  drop constraint if exists content_delivery_attempts_outcome_check;
alter table public.content_delivery_attempts
  add constraint content_delivery_attempts_outcome_check
  check (outcome in ('started','confirmed','failed','lease_expired','reconciled'));

alter table public.content_delivery_jobs
  drop constraint if exists content_delivery_jobs_provider_delivery_status_check,
  drop column if exists provider_delivery_status,
  drop column if exists provider_accepted_at,
  drop column if exists provider_receipt_at;

commit;
