import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasValidMetaSignature } from "../utils/integrations/meta-signature";

const migration = readFileSync(new URL("../supabase/migrations/20260807001722_whatsapp_delivery_receipts.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollbacks/20260807001722_whatsapp_delivery_receipts.rollback.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("../utils/content-automation/runner.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../utils/content-automation/delivery.ts", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../app/api/integrations/delivery/whatsapp/route.ts", import.meta.url), "utf8");
const receiptRoute = readFileSync(new URL("../app/api/integrations/delivery/whatsapp/status/route.ts", import.meta.url), "utf8");
const verificationRoute = readFileSync(new URL("../app/api/v1/content-automation/production-verification/route.ts", import.meta.url), "utf8");

test("Meta webhook signatures are HMAC-SHA256 verified over the raw body", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const secret = "test-only-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(hasValidMetaSignature(body, signature, secret), true);
  assert.equal(hasValidMetaSignature(`${body} `, signature, secret), false);
  assert.equal(hasValidMetaSignature(body, "sha256=invalid", secret), false);
  assert.equal(hasValidMetaSignature(body, signature, undefined), false);
});

test("provider acceptance remains nonterminal until a signed final receipt", () => {
  assert.match(adapter, /accepted: true/);
  assert.match(adapter, /delivered: false/);
  assert.match(delivery, /provider\.accepted !== true/);
  assert.match(runner, /accept_content_delivery_job/);
  assert.doesNotMatch(runner, /p_confirmed: true/);
  assert.match(migration, /provider_delivery_status = 'accepted'/);
  assert.match(migration, /status = case[\s\S]*'delivered','read'[\s\S]*then 'sent'/);
  assert.match(migration, /p_provider_status = 'failed' then 'recovery_required'/);
});

test("receipt endpoint requires a signature and stores only safe provider evidence", () => {
  assert.match(receiptRoute, /x-hub-signature-256/);
  assert.match(receiptRoute, /WHATSAPP_APP_SECRET/);
  assert.match(receiptRoute, /WHATSAPP_WEBHOOK_VERIFY_TOKEN/);
  assert.match(receiptRoute, /signature_verified: true/);
  assert.match(receiptRoute, /record_content_delivery_receipt/);
  assert.doesNotMatch(receiptRoute, /recipient_id/);
});

test("receipt migration is service-role only and has an executable rollback", () => {
  assert.match(migration, /revoke all on function public\.record_content_delivery_receipt[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.record_content_delivery_receipt[\s\S]*to service_role/);
  assert.match(rollback, /drop function if exists public\.record_content_delivery_receipt/);
  assert.match(rollback, /drop column if exists provider_delivery_status/);
});

test("production canaries use fixed identities and cannot publish or enable automation", () => {
  assert.match(verificationRoute, /occ-production-generation-canary-2026-08-07/);
  assert.match(verificationRoute, /occ-production-whatsapp-canary-2026-08-07/);
  assert.match(verificationRoute, /generation_only_canary: true/);
  assert.match(verificationRoute, /CONTENT_AUTOMATION_ENABLED === "true"/);
  assert.doesNotMatch(verificationRoute, /publishContent|runPublishQueue|content_publish_jobs/);
});
