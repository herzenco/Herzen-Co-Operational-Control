-- Retire the former Herzen Co. phase-1 content automation schedules in favor of
-- Monthly Content Operations. This keeps historical records intact while
-- preventing the legacy scheduler from competing with the replacement workflow.

update public.automation_schedules
set
  enabled = false,
  configuration = coalesce(configuration, '{}'::jsonb) || jsonb_build_object(
    'retired_on', '2026-08-07',
    'retired_request_id', 'REQ-20260807-083244-monthly-content-operations-replacement',
    'retired_reason', 'Superseded by Herzen Co. Monthly Content Operations pending activation.'
  )
where job_type in (
  'monthly_generation',
  'weekly_review_pack',
  'publish_day_notice',
  'weekly_k2_refresh',
  'audit_retry'
);

update public.workflow_runs
set
  status = 'cancelled',
  finished_at = coalesce(finished_at, timezone('utc', now())),
  last_error = coalesce(last_error, 'Retired by Monthly Content Operations replacement.')
where job_type in (
  'monthly_generation',
  'weekly_review_pack',
  'publish_day_notice',
  'weekly_k2_refresh',
  'audit_retry'
)
and status in ('running', 'retrying');
