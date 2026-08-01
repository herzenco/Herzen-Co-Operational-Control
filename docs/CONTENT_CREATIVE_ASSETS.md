# OCC Content Creative Assets

The Operations Command Center hosts pre-publication post images in a private Supabase Storage bucket named `content-creative-assets`. This bucket is intentionally separate from `content-publication-evidence`, which remains reserved for screenshots proving that a post was published.

## Content fields

- `caption`: the exact final text that publishes with the post.
- `creative_asset_path`: the private object path of the uploaded post image in `content-creative-assets`.
- `screenshot_path`: publication-proof screenshot in `content-publication-evidence`; it is not a post image.

The `/api/v1/content-items` collection and item endpoints accept `caption` and `creative_asset_path` on create and update. Every content-item response also includes the stable, derived attachment shape:

```json
{
  "creative_attachment": {
    "bucket": "content-creative-assets",
    "path": "<private object path>",
    "attached": true
  }
}
```

`creative_attachment` is `null` when no asset path is stored. It contains no public or permanent URL; authenticated clients create short-lived signed preview/download URLs from its bucket and path.

## Upload and access model

Creative files are JPEG, PNG, or WebP images up to 25 MB. The browser uploads with the current Supabase session to:

```text
content-creative-assets/{user_id}/{content_record_or_draft_id}/{asset_id}.{extension}
```

The bucket is private. Active OCC members with the `owner` or `operator` role can read assets. Owners and operators can upload only into a top-level folder matching their authenticated user ID. The UI creates temporary signed URLs for previews and original-file downloads.

## Bubbles n Salt rule

When a content record has:

- property slug `bubbles-n-salt`; and
- owner agent code `c-3po`

both `caption` and `creative_asset_path` are required. The content form checks this before uploading or saving, and the `private.validate_bubbles_c3po_content()` database trigger enforces the same rule for every API or database write.

This rule applies to new records and edits. A database path is only an attachment when an object exists at that exact path in the private bucket.

## August 2026 seeded-path repair

The original Bubbles n Salt August seed stored placeholder paths under `seeded/bubbles-n-salt/2026-08/` without uploading objects. Run the repeatable repair from the repo root:

```bash
node --env-file=.env.local scripts/backfill-bubbles-creatives.mjs
node --env-file=.env.local scripts/backfill-bubbles-creatives.mjs --apply
```

The first command is a dry run. `--apply` uploads all 31 manifest-selected originals to authenticated-user paths and updates the matching August records. It is safe to rerun because uploads use deterministic date-based names with upsert. Override `BUBBLES_MANIFEST_PATH` or `BUBBLES_AGENT_ROOT` when the operating-agent files live elsewhere. The script accepts either `OCC_INTEGRATION_EMAIL` / `OCC_INTEGRATION_PASSWORD` or the existing `LUPE_API_EMAIL` / `LUPE_API_PASSWORD` variables.

## Operator workflow

1. Open Content and create or edit the record.
2. Select Bubbles n Salt and assign C-3PO.
3. Enter the final Caption.
4. Select the Post image file.
5. Save. OCC uploads the creative first, then stores its private path on the content record.
6. Open the record to preview or download the original creative.
7. After publishing, attach the separate Publication screenshot as proof.
