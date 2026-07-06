-- L&D Energy Floor Plan Studio — initial schema
-- Written ahead of provisioning; applied when the Supabase project exists.
-- Multi-tenancy boundary: org membership. PowerSync sync rules follow the same boundary.

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  primary key (org_id, user_id)
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  address_line1 text not null,
  address_line2 text not null default '',
  postcode text not null default '',
  status text not null default 'draft' check (status in ('draft', 'ready', 'exported')),
  property_meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties (id) on delete cascade,
  name text not null default 'Floor plan',
  scale text not null default '1:50',
  unit_system text not null default 'metric' check (unit_system in ('metric', 'imperial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table floors (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  default_ceiling_height_m numeric(4, 2) not null default 2.40
);

-- The drawing itself: last-write-wins head + immutable revision history.
create table floor_documents (
  floor_id uuid primary key references floors (id) on delete cascade,
  doc jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table floor_revisions (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references floors (id) on delete cascade,
  doc jsonb not null,
  version bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create index floor_revisions_floor_idx on floor_revisions (floor_id, version desc);

create table subscriptions (
  org_id uuid primary key references orgs (id) on delete cascade,
  stripe_customer_id text,
  plan_tier text not null default 'free',
  status text not null default 'active',
  current_period_end timestamptz
);

-- Row-level security: every row is reachable only through org membership.
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table properties enable row level security;
alter table plans enable row level security;
alter table floors enable row level security;
alter table floor_documents enable row level security;
alter table floor_revisions enable row level security;
alter table subscriptions enable row level security;

create function is_org_member(check_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members where org_id = check_org and user_id = auth.uid()
  );
$$;

create policy org_read on orgs for select using (is_org_member(id));
create policy org_members_read on org_members for select using (is_org_member(org_id));

create policy properties_rw on properties for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

create policy plans_rw on plans for all
  using (is_org_member((select org_id from properties where id = property_id)))
  with check (is_org_member((select org_id from properties where id = property_id)));

create policy floors_rw on floors for all
  using (is_org_member((select p.org_id from plans pl join properties p on p.id = pl.property_id where pl.id = plan_id)))
  with check (is_org_member((select p.org_id from plans pl join properties p on p.id = pl.property_id where pl.id = plan_id)));

create policy floor_documents_rw on floor_documents for all
  using (is_org_member((select p.org_id from floors f join plans pl on pl.id = f.plan_id join properties p on p.id = pl.property_id where f.id = floor_id)))
  with check (is_org_member((select p.org_id from floors f join plans pl on pl.id = f.plan_id join properties p on p.id = pl.property_id where f.id = floor_id)));

create policy floor_revisions_rw on floor_revisions for all
  using (is_org_member((select p.org_id from floors f join plans pl on pl.id = f.plan_id join properties p on p.id = pl.property_id where f.id = floor_id)))
  with check (is_org_member((select p.org_id from floors f join plans pl on pl.id = f.plan_id join properties p on p.id = pl.property_id where f.id = floor_id)));

create policy subscriptions_read on subscriptions for select using (is_org_member(org_id));
