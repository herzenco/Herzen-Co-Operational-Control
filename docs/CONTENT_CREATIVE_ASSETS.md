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

Metadata may carry either a valid `https://` image URL or a stable private reference shaped as `storage://content-creative-assets/<object path>`. OCC resolves the latter through the same signed-URL flow as `creative_asset_path`. Local filesystem values such as `Assets/...` are never browser-loadable and are rejected by the content API unless the write also supplies a canonical hosted `creative_asset_path`.

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

The repeatable repair uploads the manifest originals and converts local `Assets/...` metadata to canonical private Storage attachments:

```bash
node --env-file=.env.local scripts/backfill-bubbles-creatives.mjs
node --env-file=.env.local scripts/backfill-bubbles-creatives.mjs --apply
```

The first command is a dry run. `--apply` uploads missing manifest-selected originals to deterministic authenticated-user paths; existing Storage objects are reused without replacement. It copies captions into the first-class field, stores `creative_asset_path`, changes `metadata.image_url` to a `storage://` hosted reference, preserves the former local value as `metadata.source_image_path`, and assigns C-3PO/K2. Override `BUBBLES_MANIFEST_PATH` or `BUBBLES_AGENT_ROOT` when the operating-agent files live elsewhere. The script accepts either `OCC_INTEGRATION_EMAIL` / `OCC_INTEGRATION_PASSWORD` or the existing `LUPE_API_EMAIL` / `LUPE_API_PASSWORD` variables.

## Operator workflow

1. Open Content and create or edit the record.
2. Select Bubbles n Salt and assign C-3PO.
3. Enter the final Caption.
4. Select the Post image file.
5. Save. OCC uploads the creative first, then stores its private path on the content record.
6. Open the record to preview or download the original creative. Suggested Instagram posts also expose one-click **Copy caption** and **Download image** controls on the desktop mockup and directly on each mobile swipe card.
7. After publishing, attach the separate Publication screenshot as proof.

## Tito review in Content

Opening an Instagram post presents a post-style mockup with the final caption, creative, and direct review controls. **Approve & schedule** records the approval and, when `publish_at` exists, immediately moves the item to `scheduled` so it appears on the publishing calendar. **Reject** opens a required-reason dialog, moves the item to `revision_requested`, and retains the note in the Content page's Rejected section for Lupe and the content owner.

The Rejected section is institutional memory, not a transient notification. It is reconstructed from immutable `activity_log` snapshots of approval decisions, so approving a later revision cannot erase the prior rejection. Lupe and C-3PO should consult this history when revising a post and before assembling later approval packages. Mobile Content presents Instagram posts as horizontally swipeable, creative-and-caption cards with the same Approve and Reject controls available directly on every reviewable card. Copy and download tools remain available after approval so a manually published Instagram post can still be retrieved without reopening edit mode.
