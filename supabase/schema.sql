create extension if not exists pgcrypto;

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text unique not null,
  senha text not null,
  role text not null check (role in ('admin', 'staff')),
  criado_as timestamptz not null default now(),
  ultimo_login_as timestamptz null
);

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text null,
  unidade text null,
  codigo text null,
  image_url text null,
  quantidade integer not null default 0,
  min_quantidade integer not null default 0,
  preco numeric(12,2) not null default 0,
  criado_por uuid not null references usuarios(id) on delete restrict,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists logs_acesso (
  id uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references usuarios(id) on delete cascade,
  nome_usuario text not null,
  acao text not null,
  timestamp timestamptz not null default now(),
  detalhes text null
);

create index if not exists idx_acesso_logs_timestamp on logs_acesso (timestamp desc);

alter table usuarios enable row level security;
alter table produtos enable row level security;
alter table logs_acesso enable row level security;

create policy "Allow public read usuarios"
  on usuarios for select
  to anon, authenticated
  using (true);

create policy "Allow public write usuarios"
  on usuarios for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "Allow public read produtos"
  on produtos for select
  to anon, authenticated
  using (true);

create policy "Allow public write produtos"
  on produtos for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "Allow public read logs access"
  on logs_acesso for select
  to anon, authenticated
  using (true);

create policy "Allow public write logs access"
  on logs_acesso for all
  to anon, authenticated
  using (true)
  with check (true);
