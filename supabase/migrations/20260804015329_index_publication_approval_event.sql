create index if not exists content_publish_jobs_approval_event_idx
  on public.content_publish_jobs(approval_event_id)
  where approval_event_id is not null;
