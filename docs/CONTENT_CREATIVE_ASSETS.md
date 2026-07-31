# OCC Content Creative Assets

The Operations Command Center hosts pre-publication post images in a private Supabase Storage bucket named `content-creative-assets`. This bucket is intentionally separate from `content-publication-evidence`, which remains reserved for screenshots proving that a post was published.

## Content fields

- `caption`: the exact final text that publishes with the post.
- `creative_asset_path`: the private object path of the uploaded post image in `content-creative-assets`.
- `screenshot_path`: publication-proof screenshot in `content-publication-evidence`; it is not a post image.

The `/api/v1/content-items` collection and item endpoints accept `caption` and `creative_asset_path` on create and update.

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

This rule applies to new records and edits. No legacy content is imported or backfilled.

## Operator workflow

1. Open Content and create or edit the record.
2. Select Bubbles n Salt and assign C-3PO.
3. Enter the final Caption.
4. Select the Post image file.
5. Save. OCC uploads the creative first, then stores its private path on the content record.
6. Open the record to preview or download the original creative.
7. After publishing, attach the separate Publication screenshot as proof.
