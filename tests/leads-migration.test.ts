import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/20260731213000_leads.sql", "utf8");

test("leads are audited, protected by RLS, and require a contact channel", () => {
  assert.match(sql, /alter table public\.leads enable row level security/i);
  assert.match(sql, /create trigger leads_activity/i);
  assert.match(sql, /email is not null or phone is not null/i);
  assert.match(sql, /role in \('owner', 'operator'\)/i);
  assert.match(sql, /revoke all on public\.leads from anon/i);
});

test("leads API exposes pipeline filters without unrestricted fields", async () => {
  const source = readFileSync("utils/api/resources.ts", "utf8");
  assert.match(source, /leads:\s*\{[\s\S]*table: "leads"/);
  assert.match(source, /filters: \["property_id", "assigned_agent_id", "source", "status", "priority"\]/);
});
