create table public.agent_api_credentials (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  name text not null,
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null default array['occ:read']::text[],
  active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, name)
);

create index agent_api_credentials_agent_active_idx
  on public.agent_api_credentials(agent_id, active)
  where active and revoked_at is null;

create trigger agent_api_credentials_updated_at
before update on public.agent_api_credentials
for each row execute function private.set_updated_at();

alter table public.agent_api_credentials enable row level security;

-- Machine credentials are server-only. No browser role may enumerate hashes.
revoke all on table public.agent_api_credentials from anon, authenticated;
grant all on table public.agent_api_credentials to service_role;

comment on table public.agent_api_credentials is
  'Hashed, revocable credentials for OCC machine agents. Plaintext keys are never stored.';
