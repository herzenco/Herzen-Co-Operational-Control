-- Manual-only readiness lane for Herzen Co. Monthly Content Operations.
-- This migration creates no schedule and no publishing or delivery trigger.

alter table public.content_generation_runs
  drop constraint if exists content_generation_runs_property_id_month_start_key;

alter table public.content_generation_runs
  add column if not exists request_id text,
  add column if not exists idempotency_key text,
  add column if not exists run_kind text not null default 'legacy'
    check (run_kind in ('legacy', 'monthly_shadow')),
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists trace_id text;

create unique index if not exists content_generation_runs_idempotency_uidx
  on public.content_generation_runs(idempotency_key)
  where idempotency_key is not null;

alter table public.content_items
  drop constraint if exists content_items_audit_status_check;
alter table public.content_items
  add constraint content_items_audit_status_check
  check (audit_status in ('pending','running','passed','failed','check_in_required','blocked'));

alter table public.content_audits
  add column if not exists seo_explanation text,
  add column if not exists aeo_explanation text,
  add column if not exists model text,
  add column if not exists rubric_version text,
  add column if not exists trace_id text,
  add column if not exists evaluated_at timestamptz;

alter table public.agent_work_items
  add column if not exists request_id text,
  add column if not exists idempotency_key text;

create unique index if not exists agent_work_items_idempotency_uidx
  on public.agent_work_items(idempotency_key)
  where idempotency_key is not null;

alter table public.content_review_events
  add column if not exists idempotency_key text;

create unique index if not exists content_review_events_idempotency_uidx
  on public.content_review_events(idempotency_key)
  where idempotency_key is not null;

comment on column public.content_generation_runs.run_kind is
  'monthly_shadow identifies manual, unpublished Monthly Content Operations validation; it is never scheduler-owned.';
comment on column public.content_review_events.idempotency_key is
  'Allows Lupe to record operational observations safely on retry without creating duplicate events.';
