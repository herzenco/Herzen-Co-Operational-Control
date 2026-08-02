alter table public.content_items
  add column legacy_content_item_id text,
  add column legacy_review_url text,
  add column source_system text not null default 'operations_control_center'
    check (source_system in ('operations_control_center', 'legacy_content_engine'));

create unique index content_items_legacy_content_item_id_idx
  on public.content_items(legacy_content_item_id)
  where legacy_content_item_id is not null;

create index content_items_source_system_idx
  on public.content_items(source_system);
