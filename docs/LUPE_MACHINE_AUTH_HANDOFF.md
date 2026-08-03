# Lupe OCC Machine Authentication Handoff

## Outcome

Lupe is an OCC agent, not a person. Lupe must call the production API with a dedicated machine key and must not use a saved browser session, email/password pair, or another operator's Supabase access token.

The API accepts machine keys with this shape:

```text
Authorization: Bearer occ_agent_<random-secret>
```

Only the SHA-256 hash is stored in `agent_api_credentials`. The plaintext key belongs in Lupe's secret manager and must never be committed, logged, placed in a URL, or pasted into OCC records.

## Production activation

1. Configure `SUPABASE_SECRET_KEY` in the Vercel Production environment. This is server-only and must never use a `NEXT_PUBLIC_` prefix.
2. Generate at least 32 random bytes and prefix the encoded value with `occ_agent_`.
3. SHA-256 hash the complete plaintext key.
4. Insert the hash into `public.agent_api_credentials` for the active `LUPE` agent with scopes `occ:read` and `content:write`.
5. Put the plaintext key in Lupe's secret manager as `OCC_API_KEY`.
6. Redeploy production after adding the Vercel server secret.
7. Verify `GET https://operations.herzenco.co/api/v1/content-items?property_id=28c377e7-0f86-4b69-909f-5b0e1f467fc2&limit=1` returns `200` with Lupe's machine key.

Do not store or transmit the plaintext key during database insertion. Compute the hash outside SQL and insert only the hash.

## Permission boundary

- `occ:read` permits authenticated API reads.
- `content:write` permits only resource routes explicitly enabled for agent writes.
- Agent credentials cannot decide approvals or use owner/operator-only write routes.
- Revoked, inactive, expired, unknown, or inactive-agent credentials return `401`.
- Missing server configuration returns `503` instead of silently falling back to anonymous access.

## Rotation and revocation

Create a second active credential, update Lupe's secret manager, verify it, then revoke the old row by setting `active = false`, `revoked_at = now()`. Never overwrite a stored hash in place. `last_used_at` provides a cutover signal.

## Lupe request pattern

```http
GET /api/v1/content-items?property_id=28c377e7-0f86-4b69-909f-5b0e1f467fc2&limit=100
Host: operations.herzenco.co
Authorization: Bearer <OCC_API_KEY from secret manager>
```

Lupe sends the same machine key on each request. There is no browser login, access-token refresh, or overnight session expiry.

## Audit behavior

Machine mutations create an additional `activity_log` entry with `agent_id` and `credential_id`. Those identifiers support investigation without recording the secret.

## Remaining operational owner actions

- Infrastructure owner: add `SUPABASE_SECRET_KEY` to Vercel Production.
- OCC owner: issue and register Lupe's first machine key.
- Lupe operator: store the plaintext key in Lupe's secret manager and remove reliance on `LUPE_API_EMAIL`, `LUPE_API_PASSWORD`, saved cookies, or cached Supabase tokens.
