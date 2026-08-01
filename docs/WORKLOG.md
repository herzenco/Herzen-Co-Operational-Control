# Operational Command Center Work Log

This file tracks meaningful work performed in the Operational Command Center repo.

## 2026-07-30

### Repository setup

- Moved the earlier local-only `Lupe_Assistant_office` work out of the way.
- Cloned the real `herzenco/Herzen-Co-Operational-Control` repository into the shared `Operational Command Center` folder.
- Preserved the earlier shared snapshot as `Operational Command Center Legacy Snapshot 2026-07-30`.

### Product changes

- Replaced the static mock command center UI with a live authenticated operations console.
- Wired the front end to the existing `/api/v1/*` CRUD routes using the current Supabase session bearer token.
- Added live resource management for:
  - `agents`
  - `projects`
  - `tasks`
  - `work-logs`
  - `daily-updates`
  - `approvals`
  - `activity` as a read-only audit view
- Added create, edit, delete, refresh, and inspect flows directly in the site UI.
- Added a signed-in guard on the home route so anonymous visitors are redirected to `/login`.

### Verification

- Installed repo dependencies with `npm install`.
- Verified typecheck with `./node_modules/.bin/tsc --noEmit`.
- Verified production build with `npm run build`.

### Project skill proposal

- Created pending skill proposal `operational-command-center-work-log-20260731-417ceff5d0`.
- Skill name: `operational-command-center-work-log`.
- Purpose: force future substantive work in this repo to update `docs/WORKLOG.md` before close-out.

### Remaining follow-up

- Add richer field-specific presentation for linked records if we want less raw JSON in the operator view.
- Deploy the updated repo once the preferred production flow is confirmed.

## 2026-07-31

### Content migration groundwork

- Created branch `Lupe` for rerouting Herzen Co. content operations into the Operations Control Center.
- Added migration `20260731101500_legacy_content_engine_bridge.sql` so OCC content items can store:
  - `legacy_content_item_id`
  - `legacy_review_url`
  - `source_system`
- Updated the OCC content API resource definitions to accept and filter on the legacy bridge fields.
- Updated `docs/LUPE_OPERATIONS_API.md` to document the legacy Content Engine bridge and the import pattern.
- Updated `docs/LUPE_HANDOFF_AND_ROADMAP.md` so the next-build sequence explicitly calls for replacing the old local content-state scripts with OCC-backed workflows.
- Added `scripts/import-legacy-content-state.mjs` to import legacy Herzen Co content schedule data from the local state file into OCC content items.
- Added `scripts/tomorrow-content-review-pack.mjs` to generate tomorrow's review pack directly from OCC content items.
- Updated `README.md` with the new content migration helper commands and required environment variables.

### Verification

- Not yet executed against live Supabase in this session because the reroute work depends on the active project credentials and target data state.

### Repo and API sync

- Synced the real `Herzen-Co-Operational-Control` repo and continued work on branch `Lupe`.
- Verified the production API surface at `https://operations.herzenco.co/api/v1`.
- Confirmed the live unauthenticated behavior matches the route guard:
  `401 unauthorized` with `Send a Supabase access token as Authorization: Bearer <token>.`
- Confirmed `https://operations.herzenco.co/login` is publicly reachable.
- Corrected API docs to use local port `4000` instead of stale `3000`.
- Updated the repo language so OCC is the default clean-slate workflow and the
  legacy Content Engine bridge is documented as optional reconciliation only.
- Added `SUPABASE_SERVICE_ROLE_KEY` to `.env.example` because the helper
  scripts require it but the example config did not include it.

### Bubbles n Salt creative attachment repair

- Traced content creative upload, API persistence, fetch, signed-URL resolution, preview, and download behavior.
- Confirmed the August seed stored `seeded/bubbles-n-salt/2026-08/day-*.webp` database paths without corresponding Storage objects.
- Added one canonical attachment contract shared by API serialization and the content UI.
- Added an explicit unavailable-file preview state so a stored path is no longer presented as if no attachment were assigned.
- Added a dry-run-by-default bulk backfill for the 31 August manifest images using deterministic authenticated-user Storage paths.
- Added save → fetch → preview contract coverage and manifest completeness coverage.
- Documented the stable API response shape and the August repair procedure.

### Content review redesign

- Moved Properties and channel/feed previews to the top of Content and removed the “Publishing desk” framing.
- Added direct post approval from the content preview; approved posts with a publish date move immediately to `scheduled` and appear on the calendar.
- Made written feedback mandatory when rejecting a post and added a durable Rejected section sourced from approval decision notes for Lupe.
- Added caption-first, horizontally swipeable mobile post cards using native scroll snapping.

### Bubbles n Salt ownership compatibility repair

- Diagnosed recreated August rows failing C-3PO assignment because the active validator reads first-class `caption` and `creative_asset_path` columns while the recreation populated the earlier `metadata.caption` and `metadata.image_url` contract.
- Added a forward-only validator migration that accepts either canonical fields or the compatible metadata fields without weakening the property-and-owner scope.
- Added a fail-closed August ownership backfill that proceeds only when exactly 31 target rows exist and all 31 are `ready_for_lupe` with caption and image metadata.
- Added post-update assertions for status, metadata, and C-3PO ownership.

### Local creative-path resolution

- Traced dark content placeholders to recreated records storing local `Assets/...` values in `metadata.image_url`; OCC preview intentionally resolves hosted Storage paths or valid HTTP URLs only.
- Extended the August repair to reuse/upload deterministic private Storage objects, populate canonical caption and creative path fields, preserve the original local path as provenance, and replace `metadata.image_url` with a stable `storage://` reference.
- Added API write normalization that copies metadata captions and rejects unresolved local image paths with an actionable 422 response.
- Preserved direct rendering for valid existing `http://` and `https://` image URLs and graceful placeholders for missing/broken values.
