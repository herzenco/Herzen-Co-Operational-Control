# Herzen Co. Operations Control Center

Start with the project documentation:

- [`docs/LUPE_HANDOFF_AND_ROADMAP.md`](docs/LUPE_HANDOFF_AND_ROADMAP.md) — what
  is implemented, how Lupe should operate it, current boundaries, and what to
  build next.
- [`docs/LUPE_OPERATIONS_API.md`](docs/LUPE_OPERATIONS_API.md) — authentication,
  endpoints, resources, payloads, and API operating guidance.
- [`docs/OPERATIONS_COMMAND_CENTER_PRODUCT_SPEC.md`](docs/OPERATIONS_COMMAND_CENTER_PRODUCT_SPEC.md) —
  detailed product, workflow, interface, data, security, API, and delivery
  specification for the Command Center.
- [`Operations Control Center - Capabilities and Operating Guide.md`](Operations%20Control%20Center%20-%20Capabilities%20and%20Operating%20Guide.md) —
  original product capabilities and operating vision.

## Local development

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 4000
```

The authenticated application is available at `http://localhost:4000`.

## Content operations helper scripts

These scripts support Command Center content operations. The default direction
is OCC-native, blank-slate workflow design. The legacy bridge exists only for
cases where older records need to be reconciled into OCC.

- `node scripts/import-legacy-content-state.mjs`
  - Imports planned or scheduled items from
    `/Users/tito/.openclaw/workspace/memory/herzenco-content-automation-state.json`
    into OCC content records when legacy reconciliation is explicitly needed.
- `node scripts/tomorrow-content-review-pack.mjs`
  - Prints tomorrow's scheduled OCC content items in a review-pack format.

Required environment for both scripts:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Production API reality check

The protected API is live at `https://operations.herzenco.co/api/v1`.

- Unauthenticated `GET /api/v1` currently returns `401 unauthorized`.
- The live response message is:
  `Send a Supabase access token as Authorization: Bearer <token>.`
- `https://operations.herzenco.co/login` is publicly reachable.
- Protected API work still requires a live Supabase session from
  `POST /api/v1/auth/token` or `POST /api/v1/auth/refresh`.

## Runtime foundation

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
