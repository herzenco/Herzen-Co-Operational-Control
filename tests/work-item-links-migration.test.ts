import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { serializeApiResource } from "../utils/content-assets";
import { workItemPath, workItemUrl } from "../utils/work-item-links";

const page = readFileSync("app/work-items/[id]/page.tsx", "utf8");
const machineRoute = readFileSync("app/api/v1/[resource]/[id]/route.ts", "utf8");
const dashboard = readFileSync("app/command-center.tsx", "utf8");

test("canonical work-item links use the authenticated browser route", () => {
  const id = "46a40266-cd0d-48d5-a71a-41b63d88f43d";
  assert.equal(workItemPath(id), `/work-items/${id}`);
  assert.equal(workItemUrl(id), `https://operations.herzenco.co/work-items/${id}`);
  assert.equal(workItemUrl(id, "http://localhost:3000"), `http://localhost:3000/work-items/${id}`);
});

test("agent work-item API responses tell agents which human URL to surface", () => {
  const record = serializeApiResource("agent-work-items", { id: "ticket-id", title: "Ticket" }) as Record<string, unknown>;
  assert.equal(record.human_url, "https://operations.herzenco.co/work-items/ticket-id");
  assert.doesNotMatch(String(record.human_url), /\/api\/v1\//);
});

test("human route uses the normal OCC session and RLS-backed member client", () => {
  assert.match(page, /supabase\.auth\.getUser\(\)/);
  assert.match(page, /operations_members/);
  assert.match(page, /\.eq\("active", true\)/);
  assert.match(page, /\.from\("agent_work_items"\)/);
  assert.doesNotMatch(page, /SUPABASE_SECRET_KEY|SERVICE_ROLE|Authorization.*Bearer|agent key/i);
});

test("work-item UI covers the human ticket contract", () => {
  for (const field of ["Status", "Owner", "Due date", "Requested action", "Approval state", "Blockers", "Linked deliverables"]) {
    assert.match(page, new RegExp(field, "i"));
  }
  assert.match(dashboard, /href=\{`\/work-items\/\$\{encodeURIComponent/);
});

test("machine API remains bearer-authenticated and unchanged in purpose", () => {
  assert.match(machineRoute, /requireMember\(request\)/);
  assert.match(machineRoute, /from\(resource\.table\)/);
  assert.doesNotMatch(machineRoute, /redirect\("\/login"\)/);
});
