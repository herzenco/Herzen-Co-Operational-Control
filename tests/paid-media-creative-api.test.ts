import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/v1/paid-media-creatives/route.ts", import.meta.url), "utf8");

test("ordinary creative creation omits an empty optional supersedes UUID", () => {
  assert.match(route, /key === "supersedes_id" && body\[key\] === ""/);
});
