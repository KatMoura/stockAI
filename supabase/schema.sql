create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password text not null,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  last_login_at timestamptz null
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique not null,
  category text null,
  unit text null,
  barcode text null,
  image_url text null,
  quantity integer not null default 0,
  min_quantity integer not null default 0,
  price numeric(12,2) not null default 0,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  user_name text not null,
  action text not null,
  timestamp timestamptz not null default now(),
  details text null
);

create index if not exists idx_products_sku on products (sku);
create index if not exists idx_access_logs_timestamp on access_logs (timestamp desc);

alter table users enable row level security;
alter table products enable row level security;
alter table access_logs enable row level security;

create policy "Allow authenticated read users"
  on users for select
  to authenticated
  using (true);

create policy "Allow authenticated write users"
  on users for all
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated read products"
  on products for select
  to authenticated
  using (true);

create policy "Allow authenticated write products"
  on products for all
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated read access logs"
  on access_logs for select
  to authenticated
  using (true);

create policy "Allow authenticated write access logs"
  on access_logs for all
  to authenticated
  using (true)
  with check (true);
