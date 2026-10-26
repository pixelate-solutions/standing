create table accounts (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  domain text,
  domain_token text not null,
  domain_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  account_id text not null references accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table api_keys (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  name text not null,
  mode text not null check (mode in ('test', 'live')),
  hint text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_account on api_keys (account_id);

-- An agent is either registered by an account (account_id set) or discovered
-- from a self-hosted key directory (directory_url set, no account).
create table agents (
  id text primary key,
  account_id text references accounts(id) on delete cascade,
  name text not null,
  directory_url text unique,
  test_standing text check (test_standing in ('good', 'poor', 'unknown')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index agents_account on agents (account_id);

create table agent_keys (
  kid text primary key,
  agent_id text not null references agents(id) on delete cascade,
  jwk jsonb not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index agent_keys_agent on agent_keys (agent_id);

create table checks (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  mode text not null check (mode in ('test', 'live')),
  agent_id text references agents(id) on delete set null,
  kid text,
  method text not null,
  authority text not null,
  path text not null,
  action text,
  decision text not null check (decision in ('allow', 'challenge', 'deny')),
  enforced boolean not null,
  reasons jsonb not null,
  standing jsonb,
  signature_valid boolean not null,
  -- True when an outcome reported on this check may affect the agent's standing.
  counts boolean not null,
  created_at timestamptz not null default now()
);

create index checks_account on checks (account_id, mode, created_at desc);
create index checks_agent on checks (agent_id, created_at desc);

create table outcomes (
  check_id text primary key references checks(id) on delete cascade,
  account_id text not null references accounts(id) on delete cascade,
  agent_id text not null references agents(id) on delete cascade,
  outcome text not null check (outcome in ('completed', 'disputed', 'fraud', 'abuse')),
  reference text,
  counts boolean not null,
  status text not null default 'active' check (status in ('active', 'disputed', 'confirmed', 'removed')),
  dispute_note text,
  disputed_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outcomes_agent on outcomes (agent_id);
create index outcomes_reporter on outcomes (account_id, status);

-- One row per signature seen. Lets the same business retry a check while
-- rejecting the same signature presented by a different business.
create table replays (
  replay_key text primary key,
  account_id text not null,
  check_id text not null,
  expires_at timestamptz not null
);

create table policies (
  account_id text primary key references accounts(id) on delete cascade,
  mode text not null default 'monitor' check (mode in ('monitor', 'enforce')),
  unknown_action text not null default 'allow' check (unknown_action in ('allow', 'challenge', 'deny')),
  poor_action text not null default 'challenge' check (poor_action in ('allow', 'challenge', 'deny')),
  updated_at timestamptz not null default now()
);
