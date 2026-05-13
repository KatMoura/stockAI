-- Upgrade: adiciona colunas opcionais e ajusta policies para o app cliente
alter table if exists produtos add column if not exists categoria text;
alter table if exists produtos add column if not exists unidade text;
alter table if exists produtos add column if not exists codigo text;
alter table if exists produtos add column if not exists image_url text;

drop policy if exists "Allow authenticated read usuarios" on usuarios;
drop policy if exists "Allow authenticated write usuarios" on usuarios;
drop policy if exists "Allow authenticated read produtos" on produtos;
drop policy if exists "Allow authenticated write produtos" on produtos;
drop policy if exists "Allow authenticated read logs access" on logs_acesso;
drop policy if exists "Allow authenticated write logs access" on logs_acesso;

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
