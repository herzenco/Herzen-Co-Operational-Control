import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260802210034_add_human_task_assignees.sql", "utf8");
const policyMigration = readFileSync("supabase/migrations/20260802210352_optimize_human_profile_policies.sql", "utf8");
const resources = readFileSync("utils/api/resources.ts", "utf8");
const overview = readFileSync("app/api/v1/overview/route.ts", "utf8");
const commandCenter = readFileSync("app/command-center.tsx", "utf8");

test("human profiles are safe assignment records separate from authorization membership", () => {
  assert.match(migration, /create table public\.operations_profiles/);
  assert.match(migration, /references public\.operations_members\(user_id\)/);
  assert.match(migration, /alter table public\.operations_profiles enable row level security/);
  assert.match(migration, /active members read human profiles/);
  assert.match(policyMigration, /drop policy "operators manage human profiles"/);
  assert.doesNotMatch(policyMigration, /for all/);
});

test("tasks support exactly one human or agent assignee", () => {
  assert.match(migration, /assigned_user_id uuid references public\.operations_profiles\(user_id\)/);
  assert.match(migration, /num_nonnulls\(owner_agent_id, assigned_user_id\) <= 1/);
  assert.match(resources, /"assigned_user_id"/);
});

test("overview and Kanban expose human assignees", () => {
  assert.match(overview, /operations_profiles/);
  assert.match(commandCenter, /<optgroup label="People">/);
  assert.match(commandCenter, /taskAssigneeName/);
  assert.match(commandCenter, /human:/);
});
