import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
      redirect: "manual",
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("protects the Operations Control Center behind company login", async () => {
  const response = await render("/");
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/login");
});

test("protects human work-item pages with the same company login", async () => {
  const response = await render("/work-items/46a40266-cd0d-48d5-a71a-41b63d88f43d");
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/login");
});

test("server-renders the Herzen Co. company login", async () => {
  const response = await render("/login");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Sign in — Herzen Co\. Operations/);
  assert.match(html, /Sign in to operations/);
  assert.match(html, /Company email/);
  assert.match(html, /name@herzenco\.co/);
  assert.match(html, /Enter control center/);
  assert.match(html, /There is no public registration/);
  assert.doesNotMatch(html, /Continue with ChatGPT|Sign in with ChatGPT/i);
});

test("keeps the company-domain boundary explicit in source", async () => {
  const [loginPage, loginRoute, homePage] = await Promise.all([
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(loginPage, /@herzenco\.co/);
  assert.match(loginPage, /no\s+public registration/i);
  assert.match(loginRoute, /COMPANY_EMAIL_DOMAIN\s*=\s*"herzenco\.co"/);
  assert.match(loginRoute, /email\.endsWith\(`@\$\{COMPANY_EMAIL_DOMAIN\}`\)/);
  assert.match(homePage, /redirect\("\/login"\)/);
});

test("renders secure OCC recovery and password reset screens", async () => {
  const [recoverResponse, resetResponse] = await Promise.all([render("/recover"), render("/reset-password")]);
  assert.equal(recoverResponse.status, 200);
  assert.equal(resetResponse.status, 200);
  assert.match(await recoverResponse.text(), /Send recovery link/);
  assert.match(await resetResponse.text(), /Update password/);
});

test("recovery uses Supabase PKCE callback and requires active OCC membership", async () => {
  const [recoverRoute, callbackRoute, updateRoute] = await Promise.all([
    readFile(new URL("../app/api/auth/recover/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/update-password/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(recoverRoute, /resetPasswordForEmail/);
  assert.match(recoverRoute, /\/auth\/callback/);
  assert.match(recoverRoute, /x-forwarded-host/);
  assert.match(recoverRoute, /https:\/\/operations\.herzenco\.co/);
  assert.match(callbackRoute, /exchangeCodeForSession/);
  assert.match(updateRoute, /operations_members/);
  assert.match(updateRoute, /password\.length < 12/);
  assert.match(updateRoute, /signOut/);
});
