import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalReviewSnapshotMatches, findRevisionReviewAssetIds, revisionReviewAssetId } from "../utils/monthly-content/executor";

const executor = readFileSync(new URL("../utils/monthly-content/executor.ts", import.meta.url), "utf8");

const current = {
  title: "Current title",
  body: "Current body",
  caption: "Current caption",
  slug: "current-slug",
  seo_title: "Current SEO title",
  meta_description: "Current description",
  reasoning_summary: "Current reasoning",
};

test("canonical review snapshots must match every authored field", () => {
  assert.equal(canonicalReviewSnapshotMatches({ ...current }, current), true);
  assert.equal(canonicalReviewSnapshotMatches({ ...current, body: "Historical body" }, current), false);
  assert.equal(canonicalReviewSnapshotMatches({ ...current, caption: null }, current), false);
  assert.equal(canonicalReviewSnapshotMatches(null, current), false);
});

test("asset selection reuses only the exact durable revision", () => {
  const historical = [
    { id: "source-r1", asset_role: "source", metadata: { canonical_snapshot: { ...current }, monthly_content_revision_id: "revision-1", monthly_content_revision: 1 } },
    { id: "delivery-r1", asset_role: "delivery", metadata: { canonical_snapshot: { ...current }, monthly_content_revision_id: "revision-1", monthly_content_revision: 1 } },
  ];
  assert.deepEqual(findRevisionReviewAssetIds({ assets: historical, revisionId: "revision-2", revisionNumber: 2, snapshot: current }), {
    sourceId: undefined,
    deliveryId: undefined,
  });

  const revisionTwo = historical.concat([
    { id: "source-r2", asset_role: "source", metadata: { canonical_snapshot: { ...current }, monthly_content_revision_id: "revision-2", monthly_content_revision: 2 } },
    { id: "delivery-r2", asset_role: "delivery", metadata: { canonical_snapshot: { ...current }, monthly_content_revision_id: "revision-2", monthly_content_revision: 2 } },
  ]);
  assert.deepEqual(findRevisionReviewAssetIds({ assets: revisionTwo, revisionId: "revision-2", revisionNumber: 2, snapshot: current }), {
    sourceId: "source-r2",
    deliveryId: "delivery-r2",
  });
});

test("first-pass legacy assets remain reusable when their snapshots match revision 1", () => {
  const assets = [
    { id: "source-r1", asset_role: "source", metadata: { canonical_snapshot: { ...current } } },
    { id: "delivery-r1", asset_role: "delivery", metadata: { canonical_snapshot: { ...current } } },
  ];
  assert.deepEqual(findRevisionReviewAssetIds({
    assets,
    currentSourceId: "source-r1",
    currentDeliveryId: "delivery-r1",
    revisionId: "revision-1",
    revisionNumber: 1,
    snapshot: current,
  }), { sourceId: "source-r1", deliveryId: "delivery-r1" });
});

test("new revision assets have stable role-specific identities", () => {
  const source = revisionReviewAssetId("item-1", "revision-2", "source");
  const delivery = revisionReviewAssetId("item-1", "revision-2", "delivery");
  assert.equal(source, revisionReviewAssetId("item-1", "revision-2", "source"));
  assert.notEqual(source, delivery);
  assert.match(source, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("review packages use durable revision identity and append versioned assets", () => {
  assert.match(executor, /from\("monthly_content_revisions"\)[\s\S]*\.eq\("revision", revisionNumber\)/);
  assert.match(executor, /monthly_content_revision_id: revisionId/);
  assert.match(executor, /monthly_content_revision: revisionNumber/);
  assert.match(executor, /version: revisionNumber/);
  assert.match(executor, /revisionReviewAssetId\(String\(item\.id\), revisionId, role\)/);
  assert.match(executor, /upsert\(newAssets, \{ onConflict: "id", ignoreDuplicates: true \}\)/);
  assert.match(executor, /file_name: `\$\{snapshot\.slug\}\.r\$\{revisionNumber\}\.\$\{role\}\.json`/);
  assert.match(executor, /revision_id: revisionId/);
});

test("review package retries reuse matching assets and preserve historical snapshots", () => {
  assert.match(executor, /canonicalReviewSnapshotMatches\(metadata\.canonical_snapshot, input\.snapshot\)/);
  assert.match(executor, /findRevisionReviewAssetIds/);
  assert.match(executor, /update\(\{ is_current: false \}\)/);
  assert.doesNotMatch(executor, /update\(\{[^}]*canonical_snapshot/);
  assert.match(executor, /if \(item\.status === "ready_for_lupe"\) \{[\s\S]*await ensureReviewPackage[\s\S]*await ensureLupeWorkItem/);
});

test("Lupe work items identify the exact current review artifacts", () => {
  assert.match(executor, /revision_id: item\.package_manifest\?\.revision_id/);
  assert.match(executor, /source_asset_id: item\.source_asset_id/);
  assert.match(executor, /delivery_asset_id: item\.delivery_asset_id/);
});
