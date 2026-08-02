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
