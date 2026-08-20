-- Allow the private trigger—not API clients—to append immutable creative audit rows.
create or replace function private.audit_paid_media_creative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.paid_media_creative_revisions
    (creative_id, version, changed_by, changed_by_agent_id, prior_state, new_state, before_data, after_data)
  values
    (new.id, new.version, new.last_changed_by, new.last_changed_by_agent_id,
     case when tg_op = 'UPDATE' then old.workflow_state else null end, new.workflow_state,
     case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end;
$$;

revoke all on function private.audit_paid_media_creative() from public, anon, authenticated;
