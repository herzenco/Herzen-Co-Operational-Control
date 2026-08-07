import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { approvedContentHash, buildWebsitePublicationSnapshot } from "../utils/content-automation/website-publication";

const approvedItem = {
  id: "3b0958e9-9d4c-4ad9-88fe-3e44448cba75",
  title: "Mutable draft title",
  body: "Mutable draft body",
  delivery_asset_id: "delivery-asset",
  audit_status: "passed",
  seo_score: 92,
  aeo_score: 91,
  qa_checklist: { package: true, audit: true, review: true },
  publish_at: "2026-09-03T14:00:00.000Z",
  tags: ["operations"],
  metadata: { content_role: "blog", categories: ["Operating systems"], author: "Herzen Co." },
};

const websiteChannel = {
  platform: "website",
  configuration: {
    supported_destinations: ["resource_library"],
    default_destination_by_content_type: { blog: "resource_library" },
    content_type_by_destination: { resource_library: "article" },
    canonical_path_templates: { resource_library: "/resources/{slug}/" },
  },
};

const assets = [{
  id: "delivery-asset",
  asset_role: "delivery",
  is_current: true,
  external_url: "https://operations.herzenco.co/api/v1/content-items/3b0958e9-9d4c-4ad9-88fe-3e44448cba75",
  mime_type: "application/json",
  metadata: { canonical_snapshot: { title: "Approved title", body: "Approved final body", slug: "approved-title", seo_title: "Approved SEO title", meta_description: "Approved SEO description" } },
}];

test("approval freezes the immutable delivery snapshot instead of the mutable content row", () => {
  const result = buildWebsitePublicationSnapshot({ item: approvedItem, channel: websiteChannel, assets, reviewer: "Tito", approvedAt: "2026-08-04T01:00:00.000Z" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.title, "Approved title");
  assert.equal(result.payload.body, "Approved final body");
  assert.equal(result.payload.destination, "resource_library");
  assert.equal(result.payload.canonical_path, "/resources/approved-title/");
  assert.equal(result.payload.approved_content_hash.length, 64);
});

test("an unselected or unsupported website destination blocks approval", () => {
  const result = buildWebsitePublicationSnapshot({ item: approvedItem, channel: { ...websiteChannel, configuration: {} }, assets, reviewer: "Tito", approvedAt: "2026-08-04T01:00:00.000Z" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.join(" "), /Select a website destination/);
});

test("approved content hashes are stable but change with the final body", () => {
  const first = approvedContentHash({ title: "A", body: "B", tags: ["one"] });
  assert.equal(first, approvedContentHash({ tags: ["one"], body: "B", title: "A" }));
  assert.notEqual(first, approvedContentHash({ title: "A", body: "changed", tags: ["one"] }));
});

test("the migration makes approval atomic and publication attempts append-only", () => {
  const migration = readFileSync(new URL("../supabase/migrations/20260804013216_approved_website_publication_contract.sql", import.meta.url), "utf8");
  assert.match(migration, /create table if not exists public\.content_publish_attempts/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /create or replace function public\.approve_content_publication/);
  assert.match(migration, /approved_payload = excluded\.approved_payload/);
});

test("the worker sends the approved payload and audits each provider attempt", () => {
  const publishing = readFileSync(new URL("../utils/content-automation/publishing.ts", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
  assert.match(publishing, /platform !== "website"/);
  assert.match(publishing, /const requestPayload = approvedPayload/);
  assert.doesNotMatch(publishing, /meta_description: item\.meta_description/);
  assert.match(runner, /content_publish_attempts/);
  assert.match(runner, /eq\("platform", "website"\)/);
  assert.match(runner, /Recovered a stale publishing lease/);
  assert.match(runner, /runDueSchedules[\s\S]*const published: Array<Record<string, unknown>> = \[\]/);
  assert.doesNotMatch(runner, /runDueSchedules[\s\S]*await runPublishQueue\(supabase, now\)/);
});
