import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readyQaChecklist } from "../utils/content-automation/packages";
import { etDayStart } from "../utils/content-automation/schedule";

const migration = readFileSync(new URL("../supabase/migrations/20260803190000_canonical_content_packages.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
const reviewRoute = readFileSync(new URL("../app/api/review/content/route.ts", import.meta.url), "utf8");
const packages = readFileSync(new URL("../utils/content-automation/packages.ts", import.meta.url), "utf8");
const gateExecutionMigration = readFileSync(new URL("../supabase/migrations/20260803225500_fix_phase1_gate_execution.sql", import.meta.url), "utf8");
const canonicalResearchMigration = readFileSync(new URL("../supabase/migrations/20260803230500_accept_canonical_k2_research.sql", import.meta.url), "utf8");

test("Phase 1 ready state requires the complete canonical package", () => {
  for (const requirement of ["paired_content_item_id", "research_record_id", "source_asset_id", "delivery_asset_id", "posting_instructions", "approval_id", "review_url", "herzen_phase1_qa_passes"]) {
    assert.match(migration, new RegExp(requirement));
  }
  assert.equal(Object.values(readyQaChecklist()).every(Boolean), true);
});

test("the private package gate remains invoker-safe without private schema access", () => {
  assert.match(gateExecutionMigration, /create or replace function private\.validate_herzen_phase1_package\(\)/i);
  assert.doesNotMatch(gateExecutionMigration, /security definer/i);
  assert.match(gateExecutionMigration, /new\.qa_checklist ->> 'seo_aeo_gate_passed'/i);
  assert.match(gateExecutionMigration, /revoke all on function private\.validate_herzen_phase1_package\(\) from public/i);
});

test("every failed rewrite is persisted and pilot generation is capped", () => {
  assert.match(migration, /create table public\.content_rewrite_iterations/);
  assert.match(runner, /content_rewrite_iterations/);
  assert.match(runner, /pair_limit \|\| 1/);
});

test("a passing rewrite refreshes the canonical package manifest", () => {
  assert.match(runner, /package_manifest: packageManifest/);
  assert.match(runner, /caption: currentAsset\.caption \|\| currentAsset\.body/);
});

test("C-3PO readiness accepts a verified canonical K2 research record", () => {
  assert.match(canonicalResearchMigration, /research\.id = new\.research_record_id/);
  assert.match(canonicalResearchMigration, /research\.status = 'final'/);
  assert.match(canonicalResearchMigration, /and not has_final_canonical_research/);
});

test("automated queues are property scoped", () => {
  assert.match(runner, /eq\("property_id", property\.id\)/);
  assert.match(runner, /contains\("metadata", \{ automation_phase: 1 \}\)/);
});

test("review decisions synchronize the independent approval object", () => {
  assert.match(reviewRoute, /currentItem\?\.approval_id/);
  assert.match(reviewRoute, /from\("approvals"\)\.update/);
  assert.doesNotMatch(reviewRoute, /approval_state: action === "declined" \? "rejected"/);
});

test("canonical packages resolve normalized agent codes case-insensitively", () => {
  assert.match(packages, /\.ilike\("code", code\)/);
  assert.doesNotMatch(packages, /ilike\("code", code\)\.limit\(1\)\.single/);
});

test("ET calendar boundaries remain correct across daylight saving changes", () => {
  assert.equal(etDayStart(new Date("2026-08-03T16:00:00Z")).toISOString(), "2026-08-03T04:00:00.000Z");
  assert.equal(etDayStart(new Date("2026-12-03T16:00:00Z")).toISOString(), "2026-12-03T05:00:00.000Z");
});
