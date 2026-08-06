import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const boundary = readFileSync(new URL("../utils/preview-boundary.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

test("preview deployments reject all API mutations server-side", () => {
  assert.match(boundary, /process\.env\.VERCEL_ENV !== "preview"/);
  assert.match(boundary, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(boundary, /!safeMethods\.has/);
  assert.match(boundary, /status: 403/);
  assert.match(proxy, /enforcePreviewBoundary\(request\)/);
});

test("preview deployments block automation, delivery, and publishing routes even when invoked with GET", () => {
  assert.match(boundary, /\/api\/cron\/content-automation/);
  assert.match(boundary, /\/api\/integrations\//);
  assert.match(boundary, /\/content-automation\//);
  assert.match(boundary, /\/linkedin-publication/);
});
