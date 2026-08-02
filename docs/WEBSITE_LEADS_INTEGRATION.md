# Website → Operations Command Center Leads Integration

## Purpose

Use this integration to send website inquiries into the Herzen Co. Operations
Command Center (OCC). Submitted inquiries appear in the **Leads** workspace,
where they can be assigned, prioritized, followed up, and moved through the
commercial pipeline.

## Endpoint

Production:

```text
POST https://operations.herzenco.co/api/v1/leads
```

Local development:

```text
POST http://localhost:2500/api/v1/leads
```

This is a private, authenticated endpoint. Call it only from trusted server
code. Never call it directly from browser JavaScript and never expose OCC
credentials or access tokens through `NEXT_PUBLIC_*`, client bundles, page
source, query strings, analytics, or logs.

## Prerequisites

Before production use:

1. Apply the OCC migration `supabase/migrations/20260731213000_leads.sql`.
2. Deploy the OCC version containing the `leads` API resource.
3. Confirm `https://operations.herzenco.co/api/v1/leads` is reachable.
4. Create or identify an active OCC `owner` or `operator` identity using an
   approved `@herzenco.co` email address for the integration.
5. Store that identity's credentials in the website host's encrypted secret
   manager.
6. Resolve and save the OCC property UUID for the website receiving inquiries.

## Website environment variables

Set these in the website's server environment:

```dotenv
OCC_API_URL=https://operations.herzenco.co/api/v1
OCC_INTEGRATION_EMAIL=<approved OCC operator email>
OCC_INTEGRATION_PASSWORD=<secret-manager value>
OCC_PROPERTY_ID=<content_properties UUID>
```

Do not prefix these variables with `NEXT_PUBLIC_`.

## Authentication

Request a short-lived Supabase access token from OCC:

```http
POST https://operations.herzenco.co/api/v1/auth/token
Content-Type: application/json

{
  "email": "<approved OCC operator email>",
  "password": "<secret-manager value>"
}
```

Use the returned access token as a bearer token:

```http
Authorization: Bearer <access_token>
```

Tokens are short-lived. The website server may cache a valid token in server
memory until shortly before its expiry. On an authentication failure, obtain a
new token and retry the lead submission once. Do not create an unbounded retry
loop.

## Lead request contract

Headers:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

Example request:

```json
{
  "property_id": "00000000-0000-0000-0000-000000000000",
  "contact_name": "Jane Smith",
  "company": "Example Studio",
  "email": "jane@example.com",
  "phone": "+1 212 555 0100",
  "source": "website",
  "subject": "Brand and website inquiry",
  "inquiry": "We would like to discuss a new brand and website project.",
  "status": "new",
  "priority": "medium",
  "metadata": {
    "form_name": "primary-contact",
    "page_path": "/contact",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "brand-search"
  }
}
```

### Required values

- `contact_name`: non-empty string
- `inquiry`: non-empty string
- At least one of `email` or `phone`

### Recommended values

- `property_id`: UUID from OCC `content_properties`
- `source`: use `website` for website contact forms
- `status`: use `new` for fresh inquiries
- `priority`: use `medium` unless the form has a documented qualification rule
- `subject`: concise description of the request
- `metadata`: non-sensitive attribution and form context

### Supported pipeline statuses

```text
new | contacted | qualified | proposal | won | lost | spam
```

### Supported priorities

```text
urgent | high | medium | low
```

Do not send passwords, payment data, authentication tokens, private documents,
or other secrets in `inquiry`, `notes`, or `metadata`.

## Next.js server implementation

The public website form should submit to a route owned by the website. That
route validates the public request and then calls OCC from the server.

```ts
// app/api/contact/route.ts
import { NextResponse } from "next/server";

const OCC_API_URL = process.env.OCC_API_URL!;
const OCC_EMAIL = process.env.OCC_INTEGRATION_EMAIL!;
const OCC_PASSWORD = process.env.OCC_INTEGRATION_PASSWORD!;
const OCC_PROPERTY_ID = process.env.OCC_PROPERTY_ID!;

type ContactRequest = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  pagePath?: string;
  utm?: Record<string, string>;
};

async function getOccAccessToken() {
  const response = await fetch(`${OCC_API_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: OCC_EMAIL, password: OCC_PASSWORD }),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok || !payload?.data?.access_token) {
    throw new Error("OCC authentication failed");
  }
  return payload.data.access_token as string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ContactRequest;
    const name = body.name?.trim();
    const email = body.email?.trim();
    const phone = body.phone?.trim();
    const message = body.message?.trim();

    if (!name || !message || (!email && !phone)) {
      return NextResponse.json(
        { error: "Name, message, and email or phone are required." },
        { status: 400 },
      );
    }

    const accessToken = await getOccAccessToken();
    const occResponse = await fetch(`${OCC_API_URL}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        property_id: OCC_PROPERTY_ID,
        contact_name: name,
        company: body.company?.trim() || null,
        email: email || null,
        phone: phone || null,
        source: "website",
        subject: body.subject?.trim() || "Website inquiry",
        inquiry: message,
        status: "new",
        priority: "medium",
        metadata: {
          form_name: "primary-contact",
          page_path: body.pagePath || null,
          ...(body.utm || {}),
        },
      }),
      cache: "no-store",
    });

    const occPayload = await occResponse.json();
    if (!occResponse.ok) {
      // Log only the status and OCC error code. Do not log form contents,
      // credentials, or tokens.
      console.error("OCC lead submission failed", {
        status: occResponse.status,
        code: occPayload?.error?.code,
      });
      return NextResponse.json(
        { error: "We could not submit your inquiry. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "We could not submit your inquiry. Please try again." },
      { status: 500 },
    );
  }
}
```

The OCC response helper places `access_token` under `data`, matching the example
above. Keep all token-handling code server-only.

## cURL smoke test

First obtain an access token, then run:

```bash
curl --request POST \
  'https://operations.herzenco.co/api/v1/leads' \
  --header 'Authorization: Bearer <access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "property_id": "<property_uuid>",
    "contact_name": "Website Test",
    "email": "test@example.com",
    "source": "website",
    "subject": "Integration smoke test",
    "inquiry": "Testing website lead delivery into OCC.",
    "status": "new",
    "priority": "low",
    "metadata": { "environment": "production-smoke-test" }
  }'
```

Delete or mark the test record as spam after verification.

## Response behavior

Successful creation returns HTTP `201` with the created record under `data`.

Expected failure categories:

- `400`: invalid JSON, missing/invalid fields, or database constraint failure
- `401`: missing, invalid, or expired access token
- `403`: authenticated identity is not an active owner/operator
- `409`: conflict or database write conflict
- `500`: OCC database or server error

The website should show visitors a short, neutral failure message. Detailed OCC
errors belong only in restricted server logs, with form contents and secrets
redacted.

## Spam and abuse protection

The OCC endpoint is authenticated but the website contact route is public. The
website project must protect its own route:

- Validate and cap every string length before forwarding.
- Add rate limiting by IP or trusted edge identifier.
- Add a honeypot field and reject submissions that populate it.
- Add CAPTCHA only if observed abuse warrants the added friction.
- Reject unexpected content types and oversized request bodies.
- Do not return raw OCC or Supabase error messages to visitors.

## Reliability guidance

- Submit once per visitor action and disable the form button while pending.
- Retry authentication once when a cached token has expired.
- Do not automatically retry ambiguous lead-creation failures because the
  current endpoint does not yet accept an idempotency key.
- If reliable delivery becomes business-critical, add an outbox or durable
  queue in the website project and add idempotency support to OCC.

## Production acceptance checklist

- [ ] Leads migration applied to the production Supabase project
- [ ] OCC deployment containing `/api/v1/leads` is live
- [ ] Integration identity is active and limited to the required environment
- [ ] All integration secrets are server-only
- [ ] Correct property UUID is configured
- [ ] Public website route validates input and limits request size
- [ ] Rate limiting or equivalent abuse control is enabled
- [ ] Successful form submission creates a `new` lead in OCC
- [ ] Property, source, contact details, and inquiry render correctly
- [ ] Failure responses do not expose OCC errors or secrets
- [ ] Test inquiry is removed or marked as spam after verification

## OCC source files

- API resource definition: `utils/api/resources.ts`
- Generic collection endpoint: `app/api/v1/[resource]/route.ts`
- Generic item endpoint: `app/api/v1/[resource]/[id]/route.ts`
- Leads database migration: `supabase/migrations/20260731213000_leads.sql`
- Leads interface: `app/command-center.tsx`
