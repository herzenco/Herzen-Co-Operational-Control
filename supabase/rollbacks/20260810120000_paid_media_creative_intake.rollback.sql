-- Removes only objects introduced by 20260810120000_paid_media_creative_intake.
-- Run only if Creative Intake data is known to be disposable or has been exported.
drop policy if exists "operators upload paid media files" on storage.objects;
drop policy if exists "members read paid media files" on storage.objects;
delete from storage.objects where bucket_id = 'paid-media-creative-assets';
delete from storage.buckets where id = 'paid-media-creative-assets';
drop view if exists public.approved_paid_media_asset_bundle;
drop table if exists public.paid_media_creative_revisions;
drop table if exists public.paid_media_creative_files;
drop table if exists public.paid_media_creative_variants;
drop table if exists public.paid_media_creatives;
drop table if exists public.paid_media_campaigns;
drop function if exists private.audit_paid_media_creative();
drop function if exists private.prepare_paid_media_creative_revision();
