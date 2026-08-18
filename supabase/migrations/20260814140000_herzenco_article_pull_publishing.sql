-- Durable, identifier-only website notifications for published Herzen Co. blogs.
create table if not exists public.website_publication_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null default gen_random_uuid() unique,
  event text not null check (event in ('content.published','content.updated','content.unpublished','content.archived')),
  property text not null check (property = 'herzenco'),
  -- Deliberately not a foreign key: an unpublish event must survive deletion of
  -- the source row long enough for the website to remove its generated page.
  content_id uuid not null,
  slug text not null,
  source text not null default 'content_trigger' check (source in ('content_trigger','manual_sync')),
  status text not null default 'queued' check (status in ('queued','sending','delivered','failed')),
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz default now(),
  last_attempt_at timestamptz,
  response_status integer,
  failure_details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists website_publication_events_dispatch_idx
  on public.website_publication_events(status, next_attempt_at, occurred_at)
  where status in ('queued','failed');

create unique index if not exists content_items_published_property_slug_unique
  on public.content_items(property_id, slug)
  where status = 'published' and publication_state = 'published' and slug is not null;

alter table public.website_publication_events enable row level security;
create policy "active members read website publication events" on public.website_publication_events
  for select to authenticated using (exists (
    select 1 from public.operations_members member where member.user_id = (select auth.uid()) and member.active
  ));
grant select on public.website_publication_events to authenticated;
grant all on public.website_publication_events to service_role;

create or replace function private.enqueue_herzenco_article_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_is_blog boolean;
  v_old_public boolean;
  v_new_public boolean;
  v_event text;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from public.content_properties p
      join public.content_channels c on c.id = old.channel_id and c.property_id = p.id
      left join public.content_types t on t.id = old.content_type_id
      where p.id = old.property_id and p.slug = 'herzen-co' and c.platform = 'website'
        and (coalesce(old.metadata->>'content_role', '') = 'blog' or t.slug in ('blog','website-article'))
    ) into v_is_blog;
    if v_is_blog and old.status = 'published' and old.publication_state = 'published' then
      insert into public.website_publication_events(event, property, content_id, slug)
      values ('content.unpublished', 'herzenco', old.id, old.slug);
    end if;
    return old;
  end if;

  select exists (
    select 1 from public.content_properties p
    join public.content_channels c on c.id = new.channel_id and c.property_id = p.id
    left join public.content_types t on t.id = new.content_type_id
    where p.id = new.property_id and p.slug = 'herzen-co' and c.platform = 'website'
      and (coalesce(new.metadata->>'content_role', '') = 'blog' or t.slug in ('blog','website-article'))
  ) into v_is_blog;
  if not v_is_blog then return new; end if;

  if new.status = 'published' and new.publication_state = 'published'
     and (new.slug is null or new.slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') then
    raise exception 'Published Herzen Co. blogs require a URL-safe slug.';
  end if;

  v_old_public := tg_op = 'UPDATE' and old.status = 'published' and old.publication_state = 'published';
  v_new_public := new.status = 'published' and new.publication_state = 'published';
  if not v_old_public and v_new_public then v_event := 'content.published';
  elsif v_old_public and not v_new_public then
    v_event := case when new.status = 'archived' then 'content.archived' else 'content.unpublished' end;
  elsif v_old_public and v_new_public and (
    old.title is distinct from new.title or old.brief is distinct from new.brief or
    old.body is distinct from new.body or old.slug is distinct from new.slug or
    old.seo_title is distinct from new.seo_title or old.meta_description is distinct from new.meta_description or
    old.final_url is distinct from new.final_url or old.published_at is distinct from new.published_at or
    (old.metadata->'excerpt') is distinct from (new.metadata->'excerpt') or
    (old.metadata->'author') is distinct from (new.metadata->'author') or
    (old.metadata->'category') is distinct from (new.metadata->'category') or
    (old.metadata->'categories') is distinct from (new.metadata->'categories')
  ) then v_event := 'content.updated';
  end if;
  if v_event is not null then
    insert into public.website_publication_events(event, property, content_id, slug)
    values (v_event, 'herzenco', new.id, coalesce(new.slug, old.slug));
  end if;
  return new;
end;
$$;

revoke all on function private.enqueue_herzenco_article_event() from public, anon, authenticated;

drop trigger if exists enqueue_herzenco_article_event on public.content_items;
create trigger enqueue_herzenco_article_event after insert or update or delete on public.content_items
for each row execute function private.enqueue_herzenco_article_event();

comment on table public.website_publication_events is
  'Identifier-only outbox and sanitized attempt audit for Herzenco website build notifications.';
