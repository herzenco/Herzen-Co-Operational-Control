import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260803123949_agent_api_credentials.sql", "utf8");
const auth = readFileSync("utils/api/auth.ts", "utf8");
const collection = readFileSync("app/api/v1/[resource]/route.ts", "utf8");
const item = readFileSync("app/api/v1/[resource]/[id]/route.ts", "utf8");

test("agent credentials are hashed, revocable, server-only records", () => {
  assert.match(migration, /create table public\.agent_api_credentials/);
  assert.match(migration, /secret_hash text not null unique/);
  assert.match(migration, /revoked_at timestamptz/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.agent_api_credentials from anon, authenticated/);
});

test("agent keys use the server client and fail closed without server configuration", () => {
  assert.match(auth, /accessToken\.startsWith\("occ_agent_"\)/);
  assert.match(auth, /createHash\("sha256"\)/);
  assert.match(auth, /SUPABASE_SECRET_KEY \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(auth, /Agent authentication is not configured on this deployment/);
});

test("machine writes are scope-limited and cannot decide human approvals", () => {
  assert.match(auth, /options\.allowAgentWrite/);
  assert.match(auth, /content:write/);
  assert.match(collection, /machineWritableResources = new Set\(\[\s*"tasks"/);
  assert.match(collection, /allowAgentWrite: machineWritableResources\.has\(resourceName\)/);
  assert.match(item, /machineWritableResources = new Set\(\[\s*"tasks"/);
  assert.match(item, /allowAgentWrite: machineWritableResources\.has\(resourceName\)/);
  assert.match(item, /human_approval_required/);
  assert.match(collection, /agent_insert/);
  assert.match(item, /agent_update/);
});
