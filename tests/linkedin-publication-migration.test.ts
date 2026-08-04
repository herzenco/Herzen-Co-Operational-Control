import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildLinkedInPublicationSnapshot } from "../utils/content-automation/linkedin-publication";

const contentId = "a36961bd-36e9-4284-a8c1-a1cbe4e4e658";
const deliveryAssetId = "9a64bf06-b248-471b-97d2-c8b9866889f4";
const item = {
  id: contentId,
  title: "Working title is internal",
  body: "Mutable working copy",
  caption: "Approved final LinkedIn copy",
  status: "approved",
  property_id: "28c377e7-0f86-4b69-909f-5b0e1f467fc2",
  approval_id: "69074129-65ba-460d-bfc7-d01377e00c4f",
  approval_state: "approved",
  review_approved_at: "2026-08-04T01:00:00.000Z",
  audit_status: "passed",
  seo_score: 91,
  aeo_score: 94,
  delivery_asset_id: deliveryAssetId,
  source_asset_id: "222b6399-0a74-46b1-816f-b7f24164bdb8",
  publish_at: "2026-08-04T13:00:00.000Z",
  package_manifest: { version: 1, caption: "Approved final LinkedIn copy" },
  qa_checklist: { package: true, audit: true, review: true },
  metadata: {},
};
const property = { id: item.property_id, name: "Herzen Co.", slug: "herzen-co", status: "active" };
const channel = { id: "e44445c9-dcd7-4035-8183-66c0c25792ea", property_id: item.property_id, platform: "linkedin", status: "active" };
const assets = [
  {
    id: item.source_asset_id,
    content_item_id: contentId,
    asset_role: "source",
    is_current: true,
    mime_type: "application/json",
    external_url: `https://operations.herzenco.co/api/v1/content-items/${contentId}`,
    metadata: { canonical_snapshot: { title: "Approved internal label", body: "Approved final LinkedIn copy" } },
  },
  {
    id: deliveryAssetId,
    content_item_id: contentId,
    asset_role: "delivery",
    is_current: true,
    mime_type: "application/json",
    external_url: `https://operations.herzenco.co/api/v1/content-items/${contentId}`,
    metadata: { canonical_snapshot: { title: "Approved internal label", body: "Approved final LinkedIn copy" } },
  },
  {
    id: "e9f60cb4-808e-4e4f-bb63-d9930171fa22",
    content_item_id: contentId,
    asset_role: "reference",
    is_current: true,
    mime_type: "image/jpeg",
    external_url: "https://cdn.example.com/approved-image.jpg",
    file_name: "approved-image.jpg",
    metadata: { alt_text: "Approved image" },
  },
];

test("manual LinkedIn input maps only the canonical approved OCC package", () => {
  const result = buildLinkedInPublicationSnapshot({ item, property, channel, assets, feedback: [] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.content_id, contentId);
  assert.equal(result.payload.internal_label, "Approved internal label");
  assert.equal(result.payload.body, "Approved final LinkedIn copy");
  assert.notEqual(result.payload.body, item.body);
  assert.equal(result.payload.platform, "linkedin");
  assert.equal(result.payload.property.slug, "herzen-co");
  assert.equal(result.payload.approval_status, "approved");
  assert.equal(result.payload.scheduled_at, item.publish_at);
  assert.equal(result.payload.idempotency_key, `occ:linkedin:${contentId}`);
  assert.deepEqual(result.payload.media.map((media) => media.url), ["https://cdn.example.com/approved-image.jpg"]);
  assert.equal("whatsapp" in result.payload, false);
});

test("property, platform, approval, audit, asset, and feedback guards block unsafe publication", () => {
  const result = buildLinkedInPublicationSnapshot({
    item: { ...item, approval_state: "pending", audit_status: "failed" },
    property: { ...property, slug: "bubbles-n-salt" },
    channel: { ...channel, platform: "instagram" },
    assets: [],
    feedback: [{ required: true, status: "received" }],
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const blockers = result.errors.join(" ");
  assert.match(blockers, /outside the approved Herzen Co\. property scope/);
  assert.match(blockers, /not LinkedIn/);
  assert.match(blockers, /not approved/);
  assert.match(blockers, /SEO and AEO/);
  assert.match(blockers, /canonical current delivery asset/);
  assert.match(blockers, /feedback is unresolved/);
});

test("the database claim is atomic, auditable, and returns no second publish command", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260804023000_manual_lupe_linkedin_publication.sql", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
  const reviewRoute = readFileSync(new URL("../app/api/review/content/route.ts", import.meta.url), "utf8");
  const legacyAdapter = readFileSync(new URL("../app/api/integrations/publishing/linkedin/route.ts", import.meta.url), "utf8");
  assert.match(migration, /for update/);
  assert.match(migration, /'already_published'/);
  assert.match(migration, /'in_progress'/);
  assert.match(migration, /content_publish_attempts/);
  assert.match(migration, /idempotency_key_mismatch/);
  assert.match(runner, /eq\("platform", "website"\)/);
  assert.doesNotMatch(reviewRoute, /content_publish_jobs/);
  assert.doesNotMatch(legacyAdapter, /api\.linkedin\.com/);
});
