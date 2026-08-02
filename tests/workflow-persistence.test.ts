import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { demoWorkflow } from "../lib/workflows/demo-workflow";
import { validateWorkflowPayload, workflowWritePayload } from "../utils/api/workflows";

test("workflow import validation preserves the original JSON losslessly", () => {
  const imported = structuredClone(demoWorkflow) as typeof demoWorkflow & { futureField: { enabled: boolean } };
  imported.futureField = { enabled: true };
  const result = validateWorkflowPayload({ definition: imported });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.definition, imported);
  assert.equal(JSON.stringify(result.definition), JSON.stringify(imported));
});

test("new workflow persistence normalizes non-UUID editor ids", () => {
  const payload = workflowWritePayload(demoWorkflow, "d550bf69-3af7-40da-a890-ff0138b17e62", true);
  assert.equal(typeof payload.id, "string");
  assert.match(payload.id as string, /^[0-9a-f-]{36}$/i);
  assert.equal(payload.definition.id, payload.id);
  assert.equal(payload.owner_id, "d550bf69-3af7-40da-a890-ff0138b17e62");
});

test("workflow migration enables RLS, immutable versions, and activity capture", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260731183050_workflow_definitions.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.workflows enable row level security/i);
  assert.match(sql, /alter table public\.workflow_versions enable row level security/i);
  assert.match(sql, /create trigger workflows_version after insert or update/i);
  assert.match(sql, /create trigger workflows_activity after insert or update or delete/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)[^;]*workflow_versions/i);
});

test("workflow API advertises collection, versions, and restore routes", async () => {
  const source = await readFile(new URL("../app/api/v1/route.ts", import.meta.url), "utf8");
  assert.match(source, /workflows: "\/api\/v1\/workflows"/);
  assert.match(source, /workflow_versions:/);
  assert.match(source, /restore_workflow_version:/);
});
