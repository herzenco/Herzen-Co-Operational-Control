alter table public.content_items
  add column if not exists caption text,
  add column if not exists creative_asset_path text;

comment on column public.content_items.caption is
  'Final platform-ready text that publishes with the content item.';

comment on column public.content_items.creative_asset_path is
  'Private object path in the content-creative-assets bucket for the pre-publication post image.';

create or replace function private.validate_bubbles_c3po_content()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_bubbles boolean;
  is_c3po boolean;
begin
  select exists (
    select 1
    from public.content_properties property
    where property.id = new.property_id
      and property.slug = 'bubbles-n-salt'
  ) into is_bubbles;

  select exists (
    select 1
    from public.agents agent
    where agent.id = new.owner_agent_id
      and lower(agent.code) = 'c-3po'
  ) into is_c3po;

  if is_bubbles and is_c3po then
    if new.caption is null or btrim(new.caption) = '' then
      raise exception 'Bubbles n Salt content owned by C-3PO requires a caption.';
    end if;
    if new.creative_asset_path is null or btrim(new.creative_asset_path) = '' then
      raise exception 'Bubbles n Salt content owned by C-3PO requires an uploaded post image.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_bubbles_c3po_content() from public;

create trigger content_items_validate_bubbles_c3po
before insert or update on public.content_items
for each row execute function private.validate_bubbles_c3po_content();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-creative-assets',
  'content-creative-assets',
  false,
  26214400,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "operators read content creative assets" on storage.objects
for select to authenticated
using (
  bucket_id = 'content-creative-assets'
  and exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
);

create policy "operators upload content creative assets" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'content-creative-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp')
  and exists (
    select 1 from public.operations_members member
    where member.user_id = (select auth.uid())
      and member.active
      and member.role in ('owner', 'operator')
  )
);
