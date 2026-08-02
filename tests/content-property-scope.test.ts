import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveContentPropertyScope } from "../utils/api/content-property-scope";

const BUBBLES_ID = "28c377e7-0f86-4b69-909f-5b0e1f467fc2";
const OTHER_ID = "4a8e358d-97b5-4209-9e1a-cbfde98fa037";
const route = readFileSync("app/api/v1/[resource]/route.ts", "utf8");
const lookup = async (slug: string) => slug === "bubbles-n-salt" ? BUBBLES_ID : null;

test("legacy brand slug resolves to the exact Bubbles property id", async () => {
  const scope = await resolveContentPropertyScope(new URLSearchParams("brand=bubbles-n-salt"), lookup);
  assert.deepEqual(scope, { propertyId: BUBBLES_ID, error: null });
  const mixedRows = [
    { id: "bubbles", property_id: BUBBLES_ID, title: "Bubbles n Salt - 2026-08-03" },
    { id: "other", property_id: OTHER_ID, title: "August operating system article" },
  ];
  assert.deepEqual(mixedRows.filter((row) => row.property_id === scope.propertyId).map((row) => row.id), ["bubbles"]);
});

test("property slug and canonical property_id are safe selectors", async () => {
  assert.deepEqual(await resolveContentPropertyScope(new URLSearchParams("property=bubbles-n-salt"), lookup), { propertyId: BUBBLES_ID, error: null });
  assert.deepEqual(await resolveContentPropertyScope(new URLSearchParams(`property_id=${BUBBLES_ID}`), lookup), { propertyId: BUBBLES_ID, error: null });
});

test("unknown or conflicting selectors fail closed", async () => {
  assert.equal((await resolveContentPropertyScope(new URLSearchParams("brand=not-a-property"), lookup)).error?.code, "unknown_property");
  assert.equal((await resolveContentPropertyScope(new URLSearchParams(`brand=bubbles-n-salt&property_id=${OTHER_ID}`), lookup)).error?.code, "conflicting_property_scope");
});

test("content API applies the resolved property id on the backend", () => {
  assert.match(route, /resolveContentPropertyScope/);
  assert.match(route, /query = query\.eq\("property_id", scope\.propertyId\)/);
  assert.match(route, /filter === "property_id"\) continue/);
});
