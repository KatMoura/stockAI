-- Upgrade: adiciona colunas opcionais para produtos (categoria, unit, barcode, image_url)

alter table if exists products add column if not exists category text;
alter table if exists products add column if not exists unit text;
alter table if exists products add column if not exists barcode text;
alter table if exists products add column if not exists image_url text;

-- Recomenda-se executar no SQL Editor do Supabase ou via CLI
